from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header, Request, Body
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import json
import asyncio
import logging
import uuid
from html import escape
import calendar as pycalendar
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta, date
import httpx
from emergentintegrations.llm.chat import LlmChat, UserMessage
from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest
import secrets
from hashlib import sha256
from lodgify import (
    LODGIFY_STATUS_MAP, source_label, strip_html,
    LodgifyAdapter, map_lodgify_property,
)
from channex import (
    ChannexAdapter, map_channex_property, map_channex_room, map_channex_rate_plan,
)
from emailer import send_email, build_invite_email
from helpers import (
    now_utc, hash_password, verify_password, norm_email, hash_token,
    DEFAULT_STATUSES, DEFAULT_STATUS_COLORS, CORE_STATUS_KEYS,
    DEFAULT_COMMISSION_RATES, DEFAULT_PAYMENT_METHODS,
    _build_payment_methods, _build_commission_rates, _build_statuses,
    compute_display, recompute_payment, marker_color_for,
    _unfold_ical, _parse_ical_date, parse_ical, _BLOCK_SUMMARIES,
    _ics_date, _ics_escape, _build_ics,
)
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')
STRIPE_API_KEY = os.environ.get('STRIPE_API_KEY')
EMERGENT_AUTH_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
app = FastAPI()
api_router = APIRouter(prefix="/api")
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
class SessionRequest(BaseModel):
    session_id: str
class Season(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    start_date: str  # YYYY-MM-DD (month-day based recurring within a year)
    end_date: str
    price: float
class IcalLink(BaseModel):
    platform: str  # Airbnb / Booking.com / Vrbo / Autre
    url: str
class PropertyIn(BaseModel):
    name: str
    location: str = ""
    image_url: str = ""
    base_price: float = 0
    capacity: int = 2
    bedrooms: int = 1
    owner: str = ""
    surface: float = 0
    address: str = ""
    postal_code: str = ""
    city: str = ""
    address_complement: str = ""
    description: str = ""
    rooms: List[str] = []
    amenities: List[str] = []
    seasons: List[Season] = []
    ical_links: List[IcalLink] = []
    welcome_book_url: str = ""
    deposit_link: str = ""             # lien de paiement de la caution (montant prédéfini par logement)
    management_fee_pct: float = 0
    default_cleaning_fee: float = 0    # frais de ménage par défaut
    default_tourist_tax: float = 0     # taxe de séjour par défaut (montant fixe, hérité)
    tourist_tax_pct: float = 0         # taxe de séjour en % du prix des nuitées
    regional_tax_pct: float = 0        # taxe additionnelle régionale en % du prix des nuitées
    key_instructions: str = ""         # code boîte à clés / instructions de récupération
    key_photos: List[str] = []         # chemins des photos (boîte à clés, emplacement)
    photos: List[str] = []             # galerie photos du logement (jusqu'à 30)
    lodgify_id: Optional[str] = None
    owner_id: Optional[str] = None
    dynamic_pricing: Optional[dict] = None   # config tarification dynamique (par logement)
    published: bool = True                    # visible sur le site public de réservation
class ReservationIn(BaseModel):
    property_id: str
    guest_name: str
    guest_first_name: str = ""
    guest_last_name: str = ""
    guest_email: str = ""
    guest_phone: str = ""
    platform: str = "Direct"
    check_in: str  # YYYY-MM-DD
    check_out: str
    guests: int = 1
    nights_total: float = 0      # prix des nuitées
    cleaning_fee: float = 0      # frais de ménage
    tourist_tax: float = 0       # taxe de séjour
    total_price: float = 0
    status: str = "demande"  # demande|confirmee|arrivee|depart|annulee
    notes: str = ""
class InterventionIn(BaseModel):
    property_id: str
    kind: str = "menage"  # menage | intervention | remise_cles | caution
    date: str  # YYYY-MM-DD
    description: str = ""
    intervenant: str = ""
    intervenants: List[str] = []
    done: bool = False
    not_done_reason: str = ""
    caution_amount: float = 0
    caution_debited: bool = False
    photos: List[str] = []
    auto: bool = False
class GuestReplyRequest(BaseModel):
    guest_message: str
    tone: str = "chaleureux"
    property_id: Optional[str] = None
class PricingRequest(BaseModel):
    property_id: str
    period: str = ""
async def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = session.get("expires_at")
    if isinstance(expires_at, datetime):
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < now_utc():
            raise HTTPException(status_code=401, detail="Session expired")
    if session.get("kind") == "member":
        member = await db.members.find_one({"id": session.get("member_id")}, {"_id": 0})
        if not member or member.get("active") is False:
            raise HTTPException(status_code=401, detail="Member not found")
        name = f'{member.get("first_name", "")} {member.get("last_name", "")}'.strip()
        mrole = member.get("role", "member")
        # Un administrateur voit tout le compte parrain ; sinon accès limité aux logements attribués
        allowed = None if mrole == "admin" else (member.get("property_ids") or [])
        return {
            "user_id": member["user_id"],  # data owner (the account that owns the properties)
            "email": member.get("email", ""),
            "name": name or member.get("email", ""),
            "role": "member",
            "member_role": mrole,
            "member_id": member["id"],
            "permissions": member.get("permissions", []),
            "allowed_property_ids": allowed,
        }
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    user["role"] = "owner"
    user["allowed_property_ids"] = None  # None => all properties
    return user
def _prop_scope(user, field="id"):
    """Return a Mongo clause fragment restricting to the user's allowed properties.
    Owners (allowed_property_ids is None) get no restriction (empty dict)."""
    ids = user.get("allowed_property_ids")
    if ids is None:
        return {}
    return {field: {"$in": ids}}
def _can(user, perm: str) -> bool:
    """Owners can do everything; members are gated by their granted permissions."""
    if user.get("role") != "member":
        return True
    return perm in (user.get("permissions") or [])
_NO_INBOX_ROLES = {"cleaning", "intervenant", "owner"}
def _can_inbox(user) -> bool:
    if user.get("role") != "member":
        return True
    return user.get("member_role") not in _NO_INBOX_ROLES
import jwt as _jwt
from jwt import PyJWKClient as _PyJWKClient
APPLE_AUDIENCES = [a.strip() for a in os.environ.get("APPLE_AUDIENCES", "").split(",") if a.strip()]
_apple_jwk_client = _PyJWKClient("https://appleid.apple.com/auth/keys")
class AppleAuthIn(BaseModel):
    identity_token: str
    name: str = ""
    email: str = ""
async def status_color_map(uid: str):
    doc = await db.preferences.find_one({"user_id": uid}, {"_id": 0})
    m = {s["key"]: s["color"] for s in _build_statuses(doc)}
    for k, v in DEFAULT_STATUS_COLORS.items():
        m.setdefault(k, v)
    return m
async def ensure_cleaning(user_id: str, property_id: str, checkout_date: Optional[str], status: Optional[str]):
    """Auto-create a ménage intervention on the guest departure day (+ configurable offset)."""
    if not checkout_date or status == "annulee":
        return
    # Décalage configurable (J, J+1, J+2…) défini par l'utilisateur
    pref = await db.preferences.find_one({"user_id": user_id}, {"_id": 0, "cleaning_offset_days": 1})
    offset = max(0, min(14, int((pref or {}).get("cleaning_offset_days") or 0)))
    clean_date = checkout_date
    try:
        clean_date = (date.fromisoformat(checkout_date) + timedelta(days=offset)).isoformat()
    except Exception:
        pass
    # Do not create cleaning tasks for past dates
    try:
        if date.fromisoformat(clean_date) < date.today():
            return
    except Exception:
        pass
    exists = await db.interventions.find_one({
        "user_id": user_id,
        "property_id": property_id,
        "date": clean_date,
        "kind": "menage",
        "auto": True,
    })
    if exists:
        return
    desc = "Ménage après départ" if offset == 0 else f"Ménage (J+{offset} après départ)"
    await db.interventions.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "property_id": property_id,
        "kind": "menage",
        "date": clean_date,
        "description": desc,
        "intervenant": "",
        "done": False,
        "not_done_reason": "",
        "auto": True,
        "created_at": now_utc().isoformat(),
    })


async def regenerate_auto_cleanings(user_id: str):
    """Recrée les ménages automatiques (futurs) selon le décalage courant.
    Appelé quand l'utilisateur change le paramètre de décalage du ménage."""
    today_iso = date.today().isoformat()
    # Supprime les ménages auto non effectués à venir (les auto passés/faits ne bougent pas)
    await db.interventions.delete_many({
        "user_id": user_id, "kind": "menage", "auto": True,
        "done": {"$ne": True}, "date": {"$gte": today_iso},
    })
    reservations = await db.reservations.find(
        {"user_id": user_id, "status": {"$ne": "annulee"}, "check_out": {"$gte": today_iso}},
        {"_id": 0, "property_id": 1, "check_out": 1, "status": 1}).to_list(5000)
    for r in reservations:
        await ensure_cleaning(user_id, r.get("property_id"), r.get("check_out"), r.get("status"))
class CautionValidatedIn(BaseModel):
    validated: bool
    base_url: str = ""
def _build_keys_message(reservation: dict, prop: dict, base_url: str) -> str:
    guest = reservation.get("guest_name") or ""
    pname = reservation.get("property_name") or prop.get("name") or "votre logement"
    lines = [f"Bonjour {guest},".strip().rstrip(","),
             f"Votre caution est validée ✅. Voici les informations pour récupérer les clés de {pname} :"]
    instr = (prop.get("key_instructions") or "").strip()
    if instr:
        lines.append("")
        lines.append(instr)
    photos = prop.get("key_photos") or []
    if photos and base_url:
        b = base_url.rstrip("/")
        lines.append("")
        lines.append("Photos (accès aux clés) :")
        for p in photos:
            lines.append(f"{b}/api/kp/{p}")
    lines.append("")
    lines.append("Bon séjour !")
    return "\n".join(lines)
async def _send_key_instructions(uid: str, reservation: dict, prop: dict, base_url: str):
    """Envoie le code/instructions des clés (+ photos) au voyageur via Lodgify.
    Retourne (sent: bool, reason: str)."""
    if not (prop.get("key_instructions") or prop.get("key_photos")):
        return False, "no_key_info"
    if reservation.get("source") != "lodgify" or not reservation.get("thread_uid") or not reservation.get("lodgify_id"):
        return False, "no_messaging"
    settings = await db.channel_settings.find_one({"user_id": uid}, {"_id": 0})
    if not settings or not settings.get("api_key"):
        return False, "no_channel"
    adapter = LodgifyAdapter(settings["api_key"])
    body = _build_keys_message(reservation, prop, base_url)
    async with httpx.AsyncClient(timeout=30) as http:
        await adapter.send_message(http, reservation["lodgify_id"], body, "Récupération des clés")
    return True, "sent"
class SendKeysIn(BaseModel):
    base_url: str = ""
CHECKLIST_KEYS = ["caution", "keys", "welcome_book", "cleaning"]
class PublishIn(BaseModel):
    published: bool
class ChecklistIn(BaseModel):
    checklist: dict
class CheckoutIn(BaseModel):
    kind: str = "payment"          # "payment" (acompte/solde) | "deposit" (caution)
    amount: Optional[float] = None
    origin_url: str
def stripe_client() -> StripeCheckout:
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe non configuré")
    return StripeCheckout(api_key=STRIPE_API_KEY)
async def _send_booking_confirmation(uid: str, r: dict, tx: dict):
    """Email de confirmation au voyageur après paiement en ligne (récap + lien check-in)."""
    email = (r.get("guest_email") or "").strip()
    if not email:
        return
    prefs = await db.preferences.find_one({"user_id": uid}, {"_id": 0}) or {}
    company = _build_company(prefs)
    brand = company.get("name") or "Casanéo"
    logo_url = _logo_url_from_base(tx.get("origin", ""), company)
    m = _money
    fin = r.get("finance") or {}
    total = float(fin.get("total") or r.get("total_price") or 0)
    paid = round(float(tx.get("amount") or 0), 2)
    balance = round(float(tx.get("balance_due") or 0), 2)
    ci = r.get("check_in", ""); co = r.get("check_out", "")
    rows = (
        f"<tr><td style='padding:4px 0;color:#555'>Séjour</td><td style='padding:4px 0;text-align:right'>{ci} → {co}</td></tr>"
        f"<tr><td style='padding:4px 0;color:#555'>Voyageurs</td><td style='padding:4px 0;text-align:right'>{r.get('guests', 1)}</td></tr>"
        f"<tr><td style='padding:4px 0;color:#555'>Total séjour</td><td style='padding:4px 0;text-align:right'>{m(total)}</td></tr>"
        f"<tr><td style='padding:4px 0;color:#111;font-weight:700'>{'Acompte réglé' if tx.get('is_deposit') else 'Payé en ligne'}</td>"
        f"<td style='padding:4px 0;text-align:right;color:#2FB350;font-weight:700'>{m(paid)}</td></tr>"
    )
    if balance > 0:
        rows += (f"<tr><td style='padding:4px 0;color:#555'>Solde à régler</td>"
                 f"<td style='padding:4px 0;text-align:right'>{m(balance)}</td></tr>")

    checkin_block = ""
    oc = prefs.get("online_checkin") or {}
    slug = tx.get("slug") or (prefs.get("public_site") or {}).get("slug") or ""
    origin = (tx.get("origin") or "").rstrip("/")
    if oc.get("enabled") and origin and slug:
        link = f"{origin}/book/{slug}/checkin/{r.get('id')}"
        checkin_block = (
            "<div style='margin-top:20px;padding:16px;background:#EAF3FA;border-radius:12px'>"
            "<div style='font-weight:700;color:#111;margin-bottom:6px'>Enregistrement en ligne</div>"
            "<div style='color:#555;font-size:14px;margin-bottom:12px'>Merci de compléter votre formulaire d'arrivée avant votre séjour.</div>"
            f"<a href='{link}' style='display:inline-block;background:#2A6F9E;color:#fff;text-decoration:none;"
            "padding:10px 18px;border-radius:8px;font-weight:600'>Compléter mon enregistrement</a></div>"
        )

    html = (
        "<div style='font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:16px'>"
        f"{_company_header_html(company, logo_url)}"
        f"<h2 style='color:#111;margin:0 0 4px'>Réservation confirmée ✅</h2>"
        f"<p style='color:#555;margin:0 0 16px'>Bonjour {escape(r.get('guest_name') or '')}, votre réservation pour "
        f"<b>{escape(r.get('property_name') or 'votre logement')}</b> est confirmée. Merci !</p>"
        "<table style='width:100%;border-collapse:collapse;font-size:14px'>"
        f"{rows}</table>"
        f"{checkin_block}"
        f"<p style='color:#aaa;font-size:12px;margin-top:24px'>{escape(brand)}</p>"
        "</div>"
    )
    await send_email(to=email, subject=f"{brand} — Réservation confirmée", html=html)
async def _apply_stripe_payment(tx: dict):
    """Enregistre l'effet d'un paiement Stripe réussi sur la réservation (idempotent)."""
    if tx.get("processed"):
        return
    uid = tx["user_id"]
    rid = tx["reservation_id"]
    r = await db.reservations.find_one({"id": rid, "user_id": uid}, {"_id": 0})
    if not r:
        return
    if tx["kind"] == "public_balance":
        # Paiement du solde d'une réservation issue du site
        payments = r.get("payments") or []
        payments.append({
            "id": str(uuid.uuid4()), "amount": round(float(tx["amount"]), 2),
            "date": date.today().isoformat(), "note": "Solde payé en ligne (site)",
            "stripe_session": tx["session_id"],
        })
        r["payments"] = payments
        recompute_payment(r)
        markers = set(r.get("markers") or [])
        if float(r["finance"].get("due", 0)) <= 0.01:
            markers.add("paid")
        tmap = {t["marker_key"]: t for t in await get_templates(uid)}
        await db.reservations.update_one(
            {"id": rid, "user_id": uid},
            {"$set": {"payments": payments, "finance": r["finance"],
                      "markers": list(markers), "marker_color": marker_color_for(list(markers), tmap)}})
        await db.payment_transactions.update_one(
            {"session_id": tx["session_id"]},
            {"$set": {"processed": True, "payment_status": "paid", "status": "complete"}})
        return
    if tx["kind"] == "public_booking":
        # Réservation issue du site public : confirmer + payer + bloquer le calendrier
        payments = r.get("payments") or []
        payments.append({
            "id": str(uuid.uuid4()), "amount": round(float(tx["amount"]), 2),
            "date": date.today().isoformat(), "note": tx.get("label") or "Paiement en ligne (site)",
            "stripe_session": tx["session_id"],
        })
        r["payments"] = payments
        recompute_payment(r)
        markers = set(r.get("markers") or [])
        if not tx.get("is_deposit"):
            markers.add("paid")
        tmap = {t["marker_key"]: t for t in await get_templates(uid)}
        await db.reservations.update_one(
            {"id": rid, "user_id": uid},
            {"$set": {"status": "confirmee", "payments": payments, "finance": r["finance"],
                      "markers": list(markers), "marker_color": marker_color_for(list(markers), tmap),
                      "pending_payment": False}})
        await _set_property_rooms_availability(uid, r["property_id"], r.get("check_in"), r.get("check_out"), True)
        await db.payment_transactions.update_one(
            {"session_id": tx["session_id"]},
            {"$set": {"processed": True, "payment_status": "paid", "status": "complete"}})
        try:
            r2 = await db.reservations.find_one({"id": rid, "user_id": uid}, {"_id": 0})
            await _send_booking_confirmation(uid, r2, tx)
        except Exception as e:
            logger.warning("email confirmation client échoué: %s", e)
        return
    if tx["kind"] == "deposit":
        fin = dict(r.get("finance") or {})
        fin["deposit_collected"] = True
        fin["deposit_amount"] = tx["amount"]
        await db.reservations.update_one({"id": rid, "user_id": uid}, {"$set": {"finance": fin}})
    else:
        payments = r.get("payments") or []
        payments.append({
            "id": str(uuid.uuid4()),
            "amount": round(float(tx["amount"]), 2),
            "date": date.today().isoformat(),
            "note": "Paiement Stripe",
            "stripe_session": tx["session_id"],
        })
        r["payments"] = payments
        fully = recompute_payment(r)
        markers = set(r.get("markers") or [])
        if fully or r.get("paid_manual"):
            markers.add("paid")
        tmap = {t["marker_key"]: t for t in await get_templates(uid)}
        await db.reservations.update_one(
            {"id": rid, "user_id": uid},
            {"$set": {"payments": payments, "finance": r["finance"], "markers": list(markers),
                      "marker_color": marker_color_for(list(markers), tmap)}})
    await db.payment_transactions.update_one(
        {"session_id": tx["session_id"]},
        {"$set": {"processed": True, "payment_status": "paid", "status": "complete"}})
async def _resolve_public_site(slug: str):
    prefs = await db.preferences.find_one(
        {"public_site.slug": slug, "public_site.enabled": True}, {"_id": 0})
    if not prefs:
        raise HTTPException(status_code=404, detail="Site introuvable")
    return prefs["user_id"], prefs
def _public_prop_card(p: dict) -> dict:
    return {
        "id": p["id"], "name": p.get("name", ""), "city": p.get("city") or p.get("location") or "",
        "description": p.get("description", ""), "photos": p.get("photos") or [],
        "image_url": p.get("image_url", ""), "capacity": p.get("capacity", 0),
        "bedrooms": p.get("bedrooms", 0), "surface": p.get("surface", 0),
        "amenities": p.get("amenities") or [], "base_price": p.get("base_price", 0),
    }
async def _booked_dates(uid: str, property_id: str, frm: str, to: str):
    """Ensembles de dates indisponibles (réservations non annulées) sur [frm,to]."""
    res = await db.reservations.find(
        {"user_id": uid, "property_id": property_id, "status": {"$nin": ["annulee"]},
         "check_in": {"$lt": to}, "check_out": {"$gt": frm}}, {"_id": 0}).to_list(2000)
    dates = set()
    for r in res:
        try:
            cur = date.fromisoformat(r["check_in"]); end = date.fromisoformat(r["check_out"])
        except Exception:
            continue
        while cur < end:
            dates.add(cur.isoformat()); cur += timedelta(days=1)
    return dates
def _match_promo(promos: list, code: str, property_id: str, check_in: str) -> Optional[dict]:
    code = (code or "").strip().upper()
    for p in promos:
        if not p.get("enabled", True):
            continue
        if p.get("require_code"):
            if not code or (p.get("code") or "").strip().upper() != code:
                continue
        pids = p.get("property_ids") or []
        if pids and property_id not in pids:
            continue
        if p.get("period_enabled"):
            if p.get("start_date") and check_in < p["start_date"]:
                continue
            if p.get("end_date") and check_in > p["end_date"]:
                continue
        return p
    return None
async def _public_quote(uid: str, property_id: str, check_in: str, check_out: str,
                        guests: int, promo_code: str = ""):
    prop = await db.properties.find_one({"id": property_id, "user_id": uid}, {"_id": 0})
    if not prop or prop.get("published") is False:
        raise HTTPException(status_code=404, detail="Logement indisponible")
    try:
        ci = date.fromisoformat(check_in); co = date.fromisoformat(check_out)
    except Exception:
        raise HTTPException(status_code=400, detail="Dates invalides")
    nights = (co - ci).days
    if nights < 1 or nights > 90:
        raise HTTPException(status_code=400, detail="Durée de séjour invalide")
    if guests and prop.get("capacity") and int(guests) > int(prop["capacity"]):
        raise HTTPException(status_code=400, detail="Nombre de voyageurs supérieur à la capacité")
    # Disponibilité
    booked = await _booked_dates(uid, property_id, check_in, check_out)
    cur = ci
    while cur < co:
        if cur.isoformat() in booked:
            raise HTTPException(status_code=409, detail="Dates indisponibles")
        cur += timedelta(days=1)
    # Prix des nuitées (tarif par jour)
    nights_total = 0.0
    cur = ci
    while cur < co:
        nights_total += _price_for_day(prop, cur.isoformat())
        cur += timedelta(days=1)
    nights_total = round(nights_total, 2)
    cleaning = round(float(prop.get("default_cleaning_fee") or 0), 2)
    tax = round(nights_total * float(prop.get("tourist_tax_pct") or 0) / 100.0, 2)
    tax += round(float(prop.get("default_tourist_tax") or 0) * int(guests or 1) * nights, 2) if prop.get("default_tourist_tax") else 0
    tax = round(tax, 2)
    # Promotion
    promos = await db.promotions.find({"user_id": uid}, {"_id": 0}).to_list(200)
    promo = _match_promo(promos, promo_code, property_id, check_in)
    discount = 0.0
    promo_label = ""
    if promo:
        if promo.get("calc_type") == "percentage":
            discount = round(nights_total * float(promo.get("amount") or 0) / 100.0, 2)
        elif promo.get("calc_type") == "fixed":
            discount = round(float(promo.get("amount") or 0), 2)
        discount = min(discount, nights_total)
        promo_label = promo.get("name") or promo.get("code") or "Promotion"
    total = round(max(0.0, nights_total + cleaning + tax - discount), 2)
    # Acompte selon la politique de réservation choisie pour le site
    deposit_amount = total
    balance_due = 0.0
    deposit_label = ""
    prefs = await db.preferences.find_one({"user_id": uid}, {"_id": 0}) or {}
    pol_id = ((prefs.get("public_site") or {}).get("deposit_policy_id") or "")
    if pol_id:
        pol = await db.booking_policies.find_one({"id": pol_id, "user_id": uid}, {"_id": 0})
        if pol and int(pol.get("payment_count", 1)) > 1:
            pays = pol.get("payments") or []
            pct = round(float((pays[0] or {}).get("percent", 0)), 2) if pays else 0
            if 0 < pct < 100:
                deposit_amount = round(total * pct / 100.0, 2)
                balance_due = round(total - deposit_amount, 2)
                deposit_label = f"Acompte {pct:g}%"
    return {
        "property_id": property_id, "property_name": prop.get("name", ""),
        "check_in": check_in, "check_out": check_out, "guests": int(guests or 1),
        "nights": nights, "nights_total": nights_total, "cleaning_fee": cleaning,
        "tourist_tax": tax, "discount": discount, "promo_label": promo_label,
        "total": total, "currency": "EUR",
        "deposit_amount": deposit_amount, "balance_due": balance_due, "deposit_label": deposit_label,
    }
class PublicQuoteIn(BaseModel):
    property_id: str
    check_in: str
    check_out: str
    guests: int = 1
    promo_code: str = ""
class PublicBookingIn(BaseModel):
    property_id: str
    check_in: str
    check_out: str
    guests: int = 1
    promo_code: str = ""
    guest_name: str
    guest_email: str
    guest_phone: str = ""
    notes: str = ""
    origin_url: str = ""
async def _create_public_reservation(uid: str, q: dict, payload: PublicBookingIn, status: str, slug: str = ""):
    rid = str(uuid.uuid4())
    doc = {
        "id": rid, "user_id": uid, "property_id": q["property_id"],
        "property_name": q.get("property_name", ""),
        "guest_name": payload.guest_name.strip(), "guest_email": payload.guest_email.strip(),
        "guest_phone": payload.guest_phone.strip(), "platform": "Site direct", "source": "site",
        "public_slug": slug, "public_origin": (payload.origin_url or "").rstrip("/"),
        "check_in": q["check_in"], "check_out": q["check_out"], "guests": q["guests"],
        "nights_total": q["nights_total"], "cleaning_fee": q["cleaning_fee"],
        "tourist_tax": q["tourist_tax"], "total_price": q["total"],
        "status": status, "notes": payload.notes.strip(),
        "created_at": now_utc().isoformat(),
        "finance": {"total": q["total"], "paid": 0.0, "due": q["total"], "currency": "EUR",
                    "stay": q["nights_total"], "fees": q["cleaning_fee"], "taxes": q["tourist_tax"]},
        "payments": [], "pending_payment": status != "confirmee",
    }
    await db.reservations.insert_one(doc)
    return rid
async def _send_request_ack(uid: str, r: dict, slug: str, origin: str):
    """Accusé de réception d'une demande de réservation (sans paiement)."""
    email = (r.get("guest_email") or "").strip()
    if not email:
        return
    try:
        prefs = await db.preferences.find_one({"user_id": uid}, {"_id": 0}) or {}
        company = _build_company(prefs)
        brand = company.get("name") or "Casanéo"
        logo_url = _logo_url_from_base(origin, company)
        html = (
            "<div style='font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:16px'>"
            f"{_company_header_html(company, logo_url)}"
            "<h2 style='color:#111;margin:0 0 4px'>Demande bien reçue ✅</h2>"
            f"<p style='color:#555;line-height:22px'>Bonjour {escape(r.get('guest_name') or '')}, nous avons bien reçu votre "
            f"demande de réservation pour <b>{escape(r.get('property_name') or 'votre logement')}</b> "
            f"du <b>{r.get('check_in')}</b> au <b>{r.get('check_out')}</b> ({r.get('guests', 1)} voyageur(s)).</p>"
            "<p style='color:#555;line-height:22px'>Nous revenons vers vous très rapidement pour confirmer la disponibilité. "
            "Merci de votre confiance !</p>"
            f"<p style='color:#aaa;font-size:12px;margin-top:24px'>{escape(brand)}</p></div>"
        )
        await send_email(to=email, subject=f"{brand} — Demande de réservation reçue", html=html)
    except Exception as e:
        logger.warning("email accusé demande échoué: %s", e)
CHECKIN_QUESTION_LABELS = {
    "guests_count": "Combien d'invités séjourneront ?",
    "phone_email": "Votre numéro de téléphone et votre email",
    "arrival_info": "Informations pouvant faciliter votre arrivée",
    "arrival_time": "À quelle heure pensez-vous arriver ?",
    "holder_id": "Nom complet et numéro de pièce d'identité du titulaire",
    "other_guests_id": "Noms et pièces d'identité des autres invités",
    "upload_id": "Copies des pièces d'identité",
}
class CheckinSubmissionIn(BaseModel):
    answers: dict
async def run_ical_sync(user_id: str, property_id: str):
    """Coeur de la synchro iCal (import). Persiste le statut par lien sur le logement.
    Renvoie un récap ou None si le logement est introuvable."""
    prop = await db.properties.find_one({"id": property_id, "user_id": user_id}, {"_id": 0})
    if not prop:
        return None
    links = prop.get("ical_links") or []
    if not links:
        return {"imported": 0, "updated": 0, "errors": ["Aucun lien iCal configuré"], "details": []}

    imported = 0
    updated = 0
    errors = []
    details = []
    updated_links = []
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15",
        "Accept": "text/calendar, text/plain, */*",
    }
    now_iso = now_utc().isoformat()
    async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers=headers) as http:
        for link in links:
            platform = link.get("platform", "iCal")
            url = link.get("url", "").strip()
            meta = {"platform": platform, "url": link.get("url", ""), "last_synced_at": now_iso,
                    "last_imported": 0, "last_updated": 0, "last_count": 0, "last_error": ""}
            fetch_url = url
            if fetch_url.startswith("webcal://"):
                fetch_url = "https://" + fetch_url[len("webcal://"):]
            link_imported = 0
            link_updated = 0
            try:
                resp = await http.get(fetch_url)
                body = resp.text
                looks_ical = "BEGIN:VCALENDAR" in body or "BEGIN:VEVENT" in body
                if resp.status_code != 200:
                    msg = f"{platform}: lien inaccessible (HTTP {resp.status_code})"
                    errors.append(msg); details.append(msg)
                    meta["last_error"] = f"HTTP {resp.status_code}"
                    updated_links.append(meta); continue
                if not looks_ical:
                    msg = f"{platform}: le lien ne renvoie pas un calendrier iCal (vérifiez l'URL d'export .ics)"
                    errors.append(msg); details.append(msg)
                    meta["last_error"] = "Pas un calendrier iCal"
                    updated_links.append(meta); continue
                events = parse_ical(body)
                valid_events = [e for e in events if e.get("start") and e.get("end")]
                feed_uids = []
                for ev in valid_events:
                    uid = ev.get("uid") or f"{platform}-{ev['start']}-{ev['end']}"
                    feed_uids.append(uid)
                    await ensure_cleaning(user_id, property_id, ev.get("end"), "confirmee")
                    summary = (ev.get("summary") or "").strip()
                    description = (ev.get("description") or "").strip()
                    if summary and summary.lower() not in _BLOCK_SUMMARIES:
                        guest = summary
                    else:
                        guest = f"Réservation {platform}"
                    note = f"Importé depuis {platform}"
                    if description:
                        note += f"\n{description}"
                    q = {"user_id": user_id, "property_id": property_id, "ical_uid": uid}
                    existing = await db.reservations.find_one(q)
                    if existing:
                        await db.reservations.update_one(q, {"$set": {
                            "check_in": ev["start"], "check_out": ev["end"],
                            "guest_name": guest, "platform": platform, "notes": note,
                        }})
                        updated += 1; link_updated += 1
                    else:
                        await db.reservations.insert_one({
                            "id": str(uuid.uuid4()), "user_id": user_id, "property_id": property_id,
                            "guest_name": guest, "guest_email": "", "platform": platform,
                            "check_in": ev["start"], "check_out": ev["end"], "guests": 1,
                            "total_price": 0, "status": "confirmee", "notes": note,
                            "source": "ical", "ical_uid": uid, "created_at": now_utc().isoformat(),
                        })
                        imported += 1; link_imported += 1
                await db.reservations.delete_many({
                    "user_id": user_id, "property_id": property_id, "source": "ical",
                    "platform": platform, "ical_uid": {"$nin": feed_uids},
                })
                meta["last_imported"] = link_imported
                meta["last_updated"] = link_updated
                meta["last_count"] = len(valid_events)
                if len(valid_events) == 0:
                    details.append(f"{platform}: aucune réservation dans le calendrier")
                else:
                    details.append(f"{platform}: {link_imported} importée(s), {link_updated} mise(s) à jour ({len(valid_events)} évènement(s))")
            except Exception as e:
                logger.exception("iCal sync error for %s", platform)
                msg = f"{platform}: erreur ({str(e)[:80]})"
                errors.append(msg); details.append(msg)
                meta["last_error"] = str(e)[:120]
            updated_links.append(meta)

    await db.properties.update_one(
        {"id": property_id, "user_id": user_id},
        {"$set": {"ical_links": updated_links, "ical_last_sync": now_iso}})
    return {"imported": imported, "updated": updated, "errors": errors, "details": details,
            "last_sync": now_iso, "ical_links": updated_links}
class IcalFrequencyIn(BaseModel):
    frequency: str = "daily"  # hourly | 6h | daily
_FREQ_SECONDS = {"hourly": 3300, "6h": 21300, "daily": 23 * 3600}
class IcalLinksIn(BaseModel):
    links: List[IcalLink] = []
class DoneIn(BaseModel):
    done: bool = True
class CautionActionIn(BaseModel):
    debited: bool
    done: bool = True
DEFAULT_DYNAMIC_PRICING = {
    "enabled": False,
    "weekend_pct": 15,        # majoration vendredi/samedi
    "high_season_pct": 20,    # majoration si la date tombe dans une saison "haute"
    "lead_long_days": 45,     # au-delà → anticipation longue
    "lead_long_pct": 8,       # majoration anticipation longue
    "lead_last_days": 7,      # en deçà → dernière minute
    "lead_last_pct": -10,     # remise dernière minute
    "occ_high_pct": 12,       # majoration si occupation forte
    "occ_low_pct": -10,       # remise si occupation faible
    "market_weight": 40,      # % de poids du marché (comparables) vs prix de base
    "min_price": 0,
    "max_price": 0,
}
def _price_for_day(prop: dict, day_str: str):
    for s in (prop.get("seasons") or []):
        if s.get("start_date") and s.get("end_date") and s["start_date"] <= day_str <= s["end_date"]:
            return float(s.get("price") or 0)
    return float(prop.get("base_price") or 0)
def _is_high_season(prop: dict, day_str: str) -> bool:
    base = float(prop.get("base_price") or 0)
    for s in (prop.get("seasons") or []):
        if s.get("start_date") and s.get("end_date") and s["start_date"] <= day_str <= s["end_date"]:
            return float(s.get("price") or 0) > base
    return False
def make_chat(system_message: str, session_id: str) -> LlmChat:
    return LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=system_message,
    ).with_model("anthropic", "claude-sonnet-4-6")
def _parse_pricing_json(raw: str):
    """Extrait advice + liste de saisons d'une réponse LLM (tolère les fences ```json)."""
    txt = (raw or "").strip()
    if txt.startswith("```"):
        txt = re.sub(r"^```(?:json)?\s*", "", txt)
        txt = re.sub(r"\s*```$", "", txt).strip()
    try:
        data = json.loads(txt)
    except Exception:
        return raw, []
    advice = data.get("advice") or ""
    raw_seasons = data.get("seasons")
    if raw_seasons is None and data.get("season"):
        raw_seasons = [data["season"]]
    out = []
    for s in (raw_seasons or []):
        try:
            if s and s.get("start_date") and s.get("end_date"):
                out.append({
                    "name": str(s.get("name") or "Saison recommandée"),
                    "start_date": str(s.get("start_date")),
                    "end_date": str(s.get("end_date")),
                    "price": round(float(s.get("price") or 0), 2),
                })
        except Exception:
            continue
    return advice, out
DEFAULT_COMPANY = {
    "name": "", "address": "", "postal_code": "", "city": "",
    "phone": "", "email": "", "website": "", "siret": "", "vat": "",
    "logo_path": "",
}
_COMPANY_KEYS = list(DEFAULT_COMPANY.keys())
def _build_company(doc: Optional[dict]) -> dict:
    c = (doc or {}).get("company") or {}
    return {k: str(c.get(k) or "") for k in _COMPANY_KEYS}
CHECKIN_PREDEFINED_KEYS = [
    "guests_count", "phone_email", "arrival_info", "arrival_time",
    "holder_id", "other_guests_id", "upload_id",
]
DEFAULT_CHECKIN = {
    "enabled": False,
    "require_before_arrival": False,
    "auto_reminders": True,
    "predefined": {
        "guests_count": True,      # obligatoire
        "phone_email": True,
        "arrival_info": True,
        "arrival_time": True,
        "holder_id": False,
        "other_guests_id": False,
        "upload_id": False,
    },
    "custom_questions": [],
}
def _slugify(text: str) -> str:
    import re
    s = (text or "").strip().lower()
    s = re.sub(r"[àâä]", "a", s); s = re.sub(r"[éèêë]", "e", s)
    s = re.sub(r"[îï]", "i", s); s = re.sub(r"[ôö]", "o", s); s = re.sub(r"[ûü]", "u", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "site"
def _build_public_site(doc: Optional[dict]) -> dict:
    c = (doc or {}).get("public_site") or {}
    sc = c.get("showcase") or {}
    return {
        "enabled": bool(c.get("enabled", False)),
        "slug": str(c.get("slug") or ""),
        "deposit_policy_id": str(c.get("deposit_policy_id") or ""),
        "balance_auto": bool(c.get("balance_auto", True)),
        "balance_days": int(c.get("balance_days", 7)),
        "showcase": {
            "enabled": bool(sc.get("enabled", False)),
            "title": str(sc.get("title") or ""),
            "intro": str(sc.get("intro") or ""),
            "hero_photo": str(sc.get("hero_photo") or ""),
        },
    }
def _build_checkin(doc: Optional[dict]) -> dict:
    c = (doc or {}).get("online_checkin") or {}
    pre_in = c.get("predefined") or {}
    predefined = {k: bool(pre_in.get(k, DEFAULT_CHECKIN["predefined"][k])) for k in CHECKIN_PREDEFINED_KEYS}
    predefined["guests_count"] = True  # toujours obligatoire
    custom = []
    for q in (c.get("custom_questions") or [])[:5]:
        label = str((q or {}).get("label") or "").strip()
        if label:
            custom.append({"id": str((q or {}).get("id") or uuid.uuid4().hex[:8]), "label": label})
    return {
        "enabled": bool(c.get("enabled", DEFAULT_CHECKIN["enabled"])),
        "require_before_arrival": bool(c.get("require_before_arrival", DEFAULT_CHECKIN["require_before_arrival"])),
        "auto_reminders": bool(c.get("auto_reminders", DEFAULT_CHECKIN["auto_reminders"])),
        "predefined": predefined,
        "custom_questions": custom,
    }
class PreferencesIn(BaseModel):
    status_colors: Optional[dict] = None
    statuses: Optional[list] = None
    commission_rates: Optional[dict] = None
    payment_methods: Optional[dict] = None
    ai_auto_draft: Optional[bool] = None
    company: Optional[dict] = None
    online_checkin: Optional[dict] = None
    monthly_report_enabled: Optional[bool] = None
    review_request_enabled: Optional[bool] = None
    review_request_days: Optional[int] = None
    cleaning_offset_days: Optional[int] = None
    public_site: Optional[dict] = None
async def _ai_auto_draft_enabled(uid: str) -> bool:
    doc = await db.preferences.find_one({"user_id": uid}, {"_id": 0})
    return bool((doc or {}).get("ai_auto_draft", True))
async def get_channel_adapter(user_id: str):
    doc = await db.channel_settings.find_one({"user_id": user_id}, {"_id": 0})
    if not doc or not doc.get("api_key"):
        return None, None
    return LodgifyAdapter(doc["api_key"]), doc
async def _sync_log(user_id: str, kind: str, status: str, message: str = "", provider: str = "channex"):
    """Persist a synchronization log entry (SyncLog data-model)."""
    await db.sync_logs.insert_one({
        "id": str(uuid.uuid4()), "user_id": user_id, "provider": provider,
        "type": kind, "status": status, "message": message[:1000],
        "date": now_utc().isoformat(),
    })
async def get_channex_adapter(user_id: str):
    doc = await db.channex_settings.find_one({"user_id": user_id}, {"_id": 0})
    if not doc or not doc.get("api_key"):
        return None, None
    return ChannexAdapter(doc["api_key"], doc.get("environment", "staging")), doc


def _date_ranges(start, end, value_fn, build_fn):
    """Regroupe les jours consécutifs de même valeur en plages (payload ARI compact)."""
    out = []
    cur = start
    run_start = None
    run_val = None
    while cur <= end:
        v = value_fn(cur)
        if run_val is None:
            run_start, run_val = cur, v
        elif v != run_val:
            e = build_fn(run_val)
            e["date_from"] = run_start.isoformat()
            e["date_to"] = (cur - timedelta(days=1)).isoformat()
            out.append(e)
            run_start, run_val = cur, v
        cur += timedelta(days=1)
    if run_val is not None:
        e = build_fn(run_val)
        e["date_from"] = run_start.isoformat()
        e["date_to"] = end.isoformat()
        out.append(e)
    return out


async def _channex_linked_prop(uid: str, property_id: str):
    """Retourne le logement si l'utilisateur est connecté à Channex ET le logement est lié."""
    s = await db.channex_settings.find_one({"user_id": uid}, {"_id": 0})
    if not s or not s.get("api_key"):
        return None
    return await db.properties.find_one(
        {"id": property_id, "user_id": uid, "channex_id": {"$nin": [None, ""]}}, {"_id": 0})


async def enqueue_channex_availability(uid: str, property_id: str, date_from: str, date_to: str):
    prop = await _channex_linked_prop(uid, property_id)
    if not prop:
        return
    rooms = await db.rooms.find(
        {"user_id": uid, "property_id": property_id, "channex_room_type_id": {"$nin": [None, ""]}},
        {"_id": 0}).to_list(100)
    if not rooms:
        return
    try:
        d0 = date.fromisoformat(date_from); d1 = date.fromisoformat(date_to)
    except Exception:
        return
    if d1 < d0:
        d0, d1 = d1, d0
    booked = await _booked_dates(uid, property_id, d0.isoformat(), (d1 + timedelta(days=1)).isoformat())
    cx_pid = prop["channex_id"]
    values = []
    for room in rooms:
        cap = int(room.get("count_of_rooms") or 1)
        cx_rt = room["channex_room_type_id"]
        closed_docs = await db.availability.find(
            {"user_id": uid, "room_id": room["id"], "closed": True,
             "date": {"$gte": d0.isoformat(), "$lte": d1.isoformat()}}, {"_id": 0, "date": 1}).to_list(1000)
        closed_dates = {c["date"] for c in closed_docs}
        values += _date_ranges(
            d0, d1,
            lambda d, cd=closed_dates, c=cap: max(0, c - (1 if (d.isoformat() in booked or d.isoformat() in cd) else 0)),
            lambda v, rt=cx_rt: {"property_id": cx_pid, "room_type_id": rt, "availability": v},
        )
    if values:
        await db.channex_outbox.insert_one({
            "id": str(uuid.uuid4()), "user_id": uid, "property_id": property_id,
            "kind": "availability", "values": values, "status": "pending",
            "attempts": 0, "created_at": now_utc().isoformat()})


async def enqueue_channex_rates(uid: str, property_id: str, date_from: str, date_to: str):
    prop = await _channex_linked_prop(uid, property_id)
    if not prop:
        return
    rate_plans = await db.rate_plans.find(
        {"user_id": uid, "property_id": property_id, "channex_rate_plan_id": {"$nin": [None, ""]}},
        {"_id": 0}).to_list(100)
    if not rate_plans:
        return
    try:
        d0 = date.fromisoformat(date_from); d1 = date.fromisoformat(date_to)
    except Exception:
        return
    if d1 < d0:
        d0, d1 = d1, d0
    cx_pid = prop["channex_id"]
    values = []
    for rpn in rate_plans:
        cx_rp = rpn["channex_rate_plan_id"]
        ms = int(rpn.get("min_stay") or 1)
        values += _date_ranges(
            d0, d1,
            lambda d: f"{_price_for_day(prop, d.isoformat()):.2f}",
            lambda v, rp=cx_rp, m=ms: {"property_id": cx_pid, "rate_plan_id": rp, "rate": v,
                                       "min_stay_arrival": m, "min_stay_through": m},
        )
    if values:
        await db.channex_outbox.insert_one({
            "id": str(uuid.uuid4()), "user_id": uid, "property_id": property_id,
            "kind": "restrictions", "values": values, "status": "pending",
            "attempts": 0, "created_at": now_utc().isoformat()})


async def enqueue_channex_ari(uid: str, property_id: str, date_from: str, date_to: str,
                              rates: bool = True, avail: bool = True):
    """Met un changement ARI en file vers Channex (jamais bloquant pour l'action utilisateur)."""
    try:
        if avail:
            await enqueue_channex_availability(uid, property_id, date_from, date_to)
        if rates:
            await enqueue_channex_rates(uid, property_id, date_from, date_to)
    except Exception:
        logger.exception("enqueue_channex_ari failed")


CHANNEX_BOOKING_STATUS = {
    "new": "confirmee", "modified": "confirmee", "modification": "confirmee",
    "cancellation": "annulee", "cancelled": "annulee", "canceled": "annulee",
}


def _rev_guests(a: dict) -> int:
    occ = a.get("occupancy") or {}
    if isinstance(occ, dict) and occ:
        return max(1, int(occ.get("adults", 0) or 0) + int(occ.get("children", 0) or 0))
    tot = 0
    for r in (a.get("rooms") or []):
        o = (r or {}).get("occupancy") or {}
        tot += int(o.get("adults", 0) or 0) + int(o.get("children", 0) or 0)
    return max(1, tot)


async def process_channex_bookings(uid: str) -> dict:
    """Récupère le feed des réservations Channex, crée/màj/annule dans Casanéo, puis acquitte.
    Source primaire (feed) + point d'entrée du webhook. N'entraîne PAS de re-push ARI (pas de boucle)."""
    adapter, _ = await get_channex_adapter(uid)
    if not adapter:
        return {"processed": 0}
    async with httpx.AsyncClient(timeout=60) as http:
        try:
            revisions = await adapter.booking_feed(http)
        except Exception:
            logger.exception("channex booking feed error")
            return {"processed": 0}
        if not revisions:
            return {"processed": 0}
        props = await db.properties.find(
            {"user_id": uid, "channex_id": {"$nin": [None, ""]}}, {"_id": 0}).to_list(500)
        by_cx = {p["channex_id"]: p for p in props}
        processed = 0
        for rev in revisions:
            a = rev.get("attributes") or {}
            prop = by_cx.get(a.get("property_id"))
            if not prop:
                continue  # logement non importé chez nous → on laisse (non acquitté)
            rev_id = rev.get("id")
            booking_id = str(a.get("booking_id") or a.get("unique_id") or rev_id)
            status = CHANNEX_BOOKING_STATUS.get((a.get("status") or "new").lower(), "confirmee")
            ci = a.get("arrival_date") or a.get("arrival") or ""
            co = a.get("departure_date") or a.get("departure") or ""
            cust = a.get("customer") or {}
            gname = " ".join(x for x in [cust.get("name"), cust.get("surname")] if x).strip() \
                or (a.get("ota_name") or "Voyageur")
            gemail = cust.get("mail") or cust.get("email") or ""
            ota = a.get("ota_name") or a.get("channel") or "Channex"
            try:
                amount = float(a.get("amount") or 0)
            except Exception:
                amount = 0.0
            currency = a.get("currency") or "EUR"
            q = {"user_id": uid, "channex_booking_id": booking_id}
            existing = await db.reservations.find_one(q)
            base_doc = {
                "user_id": uid, "property_id": prop["id"], "property_name": prop.get("name", ""),
                "guest_name": gname, "guest_email": gemail, "platform": ota, "source": "channex",
                "channex_booking_id": booking_id, "channex_revision_id": rev_id,
                "check_in": ci, "check_out": co, "guests": _rev_guests(a),
                "total_price": amount, "status": status,
                "finance": {"total": amount, "paid": 0.0, "due": amount, "currency": currency,
                            "stay": amount, "fees": 0.0, "taxes": 0.0},
            }
            if existing:
                await db.reservations.update_one(q, {"$set": base_doc})
            else:
                base_doc["id"] = str(uuid.uuid4())
                base_doc["created_at"] = now_utc().isoformat()
                base_doc["payments"] = []
                await db.reservations.insert_one(base_doc)
            await _set_property_rooms_availability(uid, prop["id"], ci, co, status != "annulee")
            await ensure_cleaning(uid, prop["id"], co, status)
            try:
                await adapter.ack_revision(http, rev_id)
            except Exception:
                logger.exception("channex ack failed for %s", rev_id)
            await _sync_log(uid, "booking_received", "success",
                            f"{ota} · {gname} · {ci}→{co} ({status})")
            processed += 1
    return {"processed": processed}



async def _drain_channex_outbox() -> int:
    """Vide la file ARI→Channex (FIFO), 1 appel par entrée, espacé (limite 20/min)."""
    pending = await db.channex_outbox.find(
        {"status": "pending"}, {"_id": 0}).sort("created_at", 1).to_list(40)
    if not pending:
        return 0
    sent = 0
    for doc in pending:
        adapter, _ = await get_channex_adapter(doc["user_id"])
        if not adapter:
            await db.channex_outbox.update_one({"id": doc["id"]}, {"$set": {"status": "skipped"}})
            continue
        try:
            async with httpx.AsyncClient(timeout=60) as http:
                if doc["kind"] == "availability":
                    tasks = await adapter.push_availability(http, doc["values"])
                else:
                    tasks = await adapter.push_restrictions(http, doc["values"])
            await db.channex_outbox.update_one(
                {"id": doc["id"]},
                {"$set": {"status": "done", "task_ids": tasks, "sent_at": now_utc().isoformat()}})
            await _sync_log(doc["user_id"], "delta_push", "success",
                            f"{doc['kind']} {len(doc['values'])} plage(s) — tasks={tasks}")
            sent += 1
        except Exception as e:
            attempts = int(doc.get("attempts", 0)) + 1
            status = "error" if attempts >= 5 else "pending"
            await db.channex_outbox.update_one(
                {"id": doc["id"]}, {"$set": {"attempts": attempts, "status": status, "last_error": str(e)[:200]}})
            if status == "error":
                await _sync_log(doc["user_id"], "delta_push", "error", str(e)[:200])
        await asyncio.sleep(3)  # ~20 appels/min max
    return sent


class ChannexConnectIn(BaseModel):
    api_key: str
    environment: str = "staging"  # staging | production
class BookingPolicyIn(BaseModel):
    name: str
    payment_count: int = 1                     # 1 | 2 | 3
    payments: list = []                        # [{percent: number}]
    cancellation: str = "non_refundable"       # non_refundable | fully_refundable | partially_refundable
    deposit_required: bool = False
    deposit_method: str = "card_auth"          # card_auth | manual
    deposit_amount_type: str = "percentage"    # percentage | flat
    deposit_amount: float = 0
    quote_expiration_hours: int = 48
def _clean_policy(p: BookingPolicyIn) -> dict:
    cnt = p.payment_count if p.payment_count in (1, 2, 3) else 1
    pays = []
    for i in range(cnt):
        try:
            pct = round(float((p.payments[i] or {}).get("percent", 0)), 2)
        except Exception:
            pct = 0.0
        pays.append({"percent": pct})
    if cnt == 1:
        pays = [{"percent": 100.0}]
    return {
        "name": (p.name or "").strip() or "Politique",
        "payment_count": cnt,
        "payments": pays,
        "cancellation": p.cancellation if p.cancellation in ("non_refundable", "fully_refundable", "partially_refundable") else "non_refundable",
        "deposit_required": bool(p.deposit_required),
        "deposit_method": p.deposit_method if p.deposit_method in ("card_auth", "manual") else "card_auth",
        "deposit_amount_type": p.deposit_amount_type if p.deposit_amount_type in ("percentage", "flat") else "percentage",
        "deposit_amount": round(float(p.deposit_amount or 0), 2),
        "quote_expiration_hours": max(1, min(int(p.quote_expiration_hours or 48), 720)),
    }
PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")
_push_client = httpx.AsyncClient(base_url=PUSH_BASE_URL, headers={"X-Push-Key": PUSH_KEY}, timeout=10.0)
class RegisterPushBody(BaseModel):
    user_id: str
    platform: str
    device_token: str
async def send_push(recipients: list, data: dict, idempotency_key: str = None):
    if not recipients:
        return
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    payload = {"recipients": recipients[:100], "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key
    resp = await _push_client.post("/api/v1/push/trigger", json=payload)
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(502, "Push provider unavailable")
    resp.raise_for_status()
async def _set_property_rooms_availability(uid: str, property_id: str, check_in: str, check_out: str, closed: bool):
    """Bloque (closed=True) ou libère (closed=False) toutes les chambres d'un logement
    sur [check_in, check_out) (check_out exclusif). No-op si le logement n'a pas de chambre."""
    if not check_in or not check_out:
        return
    rooms = await db.rooms.find({"user_id": uid, "property_id": property_id}, {"_id": 0, "id": 1}).to_list(200)
    if not rooms:
        return
    try:
        d = datetime.fromisoformat(check_in).date()
        end = datetime.fromisoformat(check_out).date()  # exclusif (jour de depart libre)
    except Exception:
        return
    room_ids = [r["id"] for r in rooms]
    n = 0
    while d < end and n < 800:
        ds = d.isoformat()
        for rid in room_ids:
            await db.availability.update_one(
                {"user_id": uid, "room_id": rid, "date": ds},
                {"$set": {"user_id": uid, "room_id": rid, "date": ds,
                          "is_available": not closed, "closed": closed,
                          "auto_booking": closed or None}},
                upsert=True)
        d += timedelta(days=1); n += 1
class RoomIn(BaseModel):
    name: str
    max_guests: int = 2
    count_of_rooms: int = 1
    channex_room_type_id: Optional[str] = None
class RatePlanIn(BaseModel):
    name: str
    room_id: Optional[str] = None
    base_price: float = 0
    min_stay: int = 1
    closed: bool = False
    channex_rate_plan_id: Optional[str] = None
async def _assert_property(uid, property_id):
    prop = await db.properties.find_one({"id": property_id, "user_id": uid}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Logement introuvable")
    return prop
class AvailabilitySetIn(BaseModel):
    date_from: str
    date_to: str            # inclus
    is_available: bool = True
    min_stay: Optional[int] = None
    closed: bool = False
class ChannelConnectIn(BaseModel):
    api_key: str
    provider: str = "lodgify"
class SyncIntervalIn(BaseModel):
    minutes: int
class ReminderDaysIn(BaseModel):
    days: int
async def run_channel_sync(uid: str):
    adapter, _ = await get_channel_adapter(uid)
    if not adapter:
        raise HTTPException(status_code=400, detail="Channel manager non connecté")
    props = await db.properties.find(
        {"user_id": uid, "lodgify_id": {"$nin": [None, ""]}}, {"_id": 0}).to_list(2000)
    prop_by_lodgify = {p["lodgify_id"]: p for p in props}
    if not prop_by_lodgify:
        raise HTTPException(status_code=400, detail="Aucun logement lié. Importez d'abord vos logements Lodgify.")

    tmap = {t["marker_key"]: t for t in await get_templates(uid)}
    async with httpx.AsyncClient(timeout=90) as http:
        bookings = await adapter.list_bookings(http, "All")

    imported = updated = unmapped = conversations = 0
    unread_candidates = []
    seen_ids = set()
    today = date.today()
    for b in bookings:
        lp_id = str(b.get("property_id"))
        prop = prop_by_lodgify.get(lp_id)
        if not prop:
            unmapped += 1
            continue
        src = source_label(b.get("source"))
        status = LODGIFY_STATUS_MAP.get(b.get("status"), "demande")
        if b.get("canceled_at") or b.get("is_deleted"):
            status = "annulee"
        guest_obj = b.get("guest") or {}
        gname = (guest_obj.get("name") or "").strip()
        if not gname or gname.upper().startswith("N/A"):
            # Lodgify masks the name on some Airbnb/direct bookings: try the message thread
            real = ""
            tuid0 = b.get("thread_uid")
            if tuid0:
                try:
                    async with httpx.AsyncClient(timeout=15) as h0:
                        th0 = await adapter.get_thread(h0, tuid0)
                    real = (th0.get("guest_name") or "").strip()
                    if real.upper().startswith("N/A"):
                        real = ""
                except Exception:
                    real = ""
            gname = real or f"Voyageur {src}"
        gemail = (guest_obj.get("email") or "").strip()
        if gemail.upper().startswith("N/A"):
            gemail = ""
        guests = 0
        for room in (b.get("rooms") or []):
            gb = room.get("guest_breakdown") or {}
            guests += int(gb.get("adults", 0) or 0) + int(gb.get("children", 0) or 0)
        guests = guests or 1
        check_in = b.get("arrival")
        check_out = b.get("departure")
        lodgify_key = str(b.get("id"))
        seen_ids.add(lodgify_key)
        thread_uid = b.get("thread_uid")
        notes = strip_html(b.get("notes") or "")
        subt = b.get("subtotals") or {}
        quote = b.get("quote") or {}
        policy = quote.get("policy") or {}
        conf_code = ""
        try:
            st = json.loads(b.get("source_text") or "{}")
            conf_code = st.get("confirmationCode") or ""
        except Exception:
            conf_code = ""
        ci_obj = b.get("check_in") or {}
        co_obj = b.get("check_out") or {}
        finance = {
            "currency": b.get("currency_code") or "EUR",
            "total": float(b.get("total_amount") or 0),
            "paid": float(b.get("amount_paid") or 0),
            "_lodgify_paid": float(b.get("amount_paid") or 0),
            "due": float(b.get("amount_due") or 0),
            "stay": float(subt.get("stay") or 0),
            "fees": float(subt.get("fees") or 0),
            "taxes": float(subt.get("taxes") or 0),
            "addons": float(subt.get("addons") or 0),
            "promotions": float(subt.get("promotions") or 0),
            "commission": float(subt.get("commission") or b.get("total_commission") or b.get("commission") or 0),
            "vat": float(subt.get("vat") or 0),
            "quote_status": quote.get("status") or "",
            "policy_payments": policy.get("payments") or "",
            "policy_cancellation": policy.get("cancellation") or "",
            "damage_deposit": policy.get("damage_deposit") or "",
        }
        payload = {
            "user_id": uid,
            "property_id": prop["id"],
            "guest_name": gname,
            "guest_email": gemail,
            "guest_phone": (guest_obj.get("phone") or "").replace("N/A from Airbnb", "").strip(),
            "language": b.get("language") or "",
            "confirmation_code": conf_code,
            "platform": src,
            "check_in": check_in,
            "check_out": check_out,
            "checkin_time": ci_obj.get("time") or "",
            "checkout_time": co_obj.get("time") or "",
            "lodgify_created_at": b.get("created_at") or "",
            "guests": guests,
            "total_price": float(b.get("total_amount") or 0),
            "finance": finance,
            "status": status,
            "notes": notes,
            "source": "lodgify",
            "lodgify_id": lodgify_key,
            "thread_uid": thread_uid,
        }
        q = {"user_id": uid, "lodgify_id": lodgify_key}
        existing = await db.reservations.find_one(q)
        # Préserver une commission saisie manuellement d'une synchro à l'autre
        prev_fin = (existing or {}).get("finance") or {}
        if not finance.get("commission") and prev_fin.get("commission"):
            finance["commission"] = prev_fin["commission"]
        # Markers + payment state: preserve manual payments/acomptes across syncs
        markers = set((existing or {}).get("markers") or [])
        markers.discard("paid")
        payload["paid_manual"] = bool((existing or {}).get("paid_manual"))
        payload["payments"] = (existing or {}).get("payments") or []
        fully = recompute_payment(payload)
        if fully and status != "annulee":
            markers.add("paid")
        payload["markers"] = list(markers)
        payload["marker_color"] = marker_color_for(list(markers), tmap)
        if existing:
            await db.reservations.update_one(q, {"$set": payload})
            updated += 1
        else:
            payload["id"] = str(uuid.uuid4())
            payload["created_at"] = now_utc().isoformat()
            await db.reservations.insert_one(payload)
            imported += 1
        if status != "annulee":
            await ensure_cleaning(uid, prop["id"], check_out, status)
        if thread_uid:
            await db.conversations.update_one(
                {"user_id": uid, "thread_uid": thread_uid},
                {"$set": {
                    "user_id": uid,
                    "thread_uid": thread_uid,
                    "guest_name": gname,
                    "property_id": prop["id"],
                    "property_name": prop.get("name", "Logement"),
                    "source": src,
                    "arrival": check_in,
                    "departure": check_out,
                    "status": status,
                    "last_activity": check_in or "",
                },
                 "$setOnInsert": {"unread": False}},
                upsert=True,
            )
            conversations += 1
            if status != "annulee":
                try:
                    ci_d = date.fromisoformat(check_in) if check_in else None
                except Exception:
                    ci_d = None
                if ci_d and (today - timedelta(days=21)) <= ci_d <= (today + timedelta(days=180)):
                    unread_candidates.append((check_in, thread_uid))

    # Determine unread status for recent/upcoming conversations from Lodgify (is_read)
    unread_count = 0
    if unread_candidates:
        unread_candidates.sort(key=lambda x: x[0], reverse=True)
        subset = [t for _, t in unread_candidates[:60]]
        sem = asyncio.Semaphore(8)

        async def check_unread(http, tuid):
            async with sem:
                try:
                    thread = await adapter.get_thread(http, tuid)
                    is_read = bool(thread.get("is_read", True))
                    upd = {"unread": not is_read}
                    lmd = thread.get("last_message_date")
                    if lmd:
                        upd["last_activity"] = lmd
                    await db.conversations.update_one(
                        {"user_id": uid, "thread_uid": tuid}, {"$set": upd})
                    return 0 if is_read else 1
                except Exception:
                    return 0

        async with httpx.AsyncClient(timeout=30) as http:
            results = await asyncio.gather(*[check_unread(http, t) for t in subset])
        unread_count = sum(results)

    await db.channel_settings.update_one(
        {"user_id": uid}, {"$set": {"last_sync": now_utc().isoformat()}})

    # Nettoyage : supprimer les DEMANDES synchronisées de Lodgify qui n'y existent plus
    # (enquêtes expirées/refusées). On ne touche jamais aux réservations manuelles ni confirmées.
    removed = 0
    if bookings:
        stale = await db.reservations.find(
            {"user_id": uid, "source": "lodgify", "status": "demande"},
            {"_id": 0, "id": 1, "lodgify_id": 1}).to_list(5000)
        for s in stale:
            if str(s.get("lodgify_id")) not in seen_ids:
                await db.reservations.delete_one({"user_id": uid, "id": s["id"]})
                removed += 1
    return {
        "imported": imported, "updated": updated, "unmapped": unmapped,
        "conversations": conversations, "total": len(bookings), "unread": unread_count,
        "removed": removed,
    }
def _normalize_msgs(thread: dict) -> list:
    """Convert a Lodgify thread into a sorted list of normalized messages."""
    msgs = []
    for m in (thread.get("messages") or []):
        msgs.append({
            "id": m.get("message_id") or str(m.get("id")),
            "text": strip_html(m.get("message", "")),
            "type": m.get("type"),
            "date": m.get("date_created"),
            "mine": m.get("type") == "Owner",
        })
    msgs.sort(key=lambda x: x["date"] or "")
    return msgs
_TONE_LABELS = {
    "chaleureux": "chaleureux et convivial",
    "professionnel": "professionnel et posé",
    "concis": "concis et direct",
}
async def _make_guest_draft(uid: str, thread_uid: str, last_guest_text: str,
                            prop: Optional[dict], tone: str = "chaleureux") -> str:
    """Génère un BROUILLON de réponse au voyageur (Claude Sonnet 4.6), à valider par l'hôte."""
    ctx = ""
    if prop:
        ctx = (f"Logement: {prop.get('name')} à {prop.get('location', '')}, "
               f"{prop.get('bedrooms', 0)} chambres, capacité {prop.get('capacity', 0)} personnes.")
    tone_txt = _TONE_LABELS.get(tone, _TONE_LABELS["chaleureux"])
    system = (
        "Tu es l'assistant d'un hôte de location saisonnière. "
        f"Tu rédiges un BROUILLON de réponse au voyageur, court, sur un ton {tone_txt}. "
        "Rédige le brouillon dans la MÊME langue que le dernier message du voyageur "
        "(par défaut sa langue). "
        "Le brouillon sera relu et validé par l'hôte avant envoi. "
        "Réponds uniquement avec le message prêt à valider, sans préambule."
    )
    chat = make_chat(system, f"draft_{uid}_{thread_uid}")
    prompt = f"{ctx}\nMessage du voyageur : \"{last_guest_text}\"\nRédige un brouillon de réponse."
    return (await chat.send_message(UserMessage(text=prompt))).strip()
async def _store_draft(uid: str, thread_uid: str, msg_id: str, draft: str):
    await db.conversations.update_one(
        {"user_id": uid, "thread_uid": thread_uid},
        {"$set": {"ai_draft": draft, "ai_draft_at": now_utc().isoformat(),
                  "ai_draft_msg_id": msg_id, "ai_draft_validated": False}})
async def _translate_to_fr(uid: str, thread_uid: str, texts: list) -> list:
    """Traduit en français une liste de messages voyageurs (1 appel LLM, sortie JSON)."""
    clean = [t for t in texts if (t or "").strip()]
    if not clean:
        return []
    system = (
        "Tu es un traducteur professionnel. On te donne un tableau JSON de messages de voyageurs. "
        "Réponds STRICTEMENT par un tableau JSON de la MÊME longueur : chaque élément est la "
        "traduction FRANÇAISE du message correspondant. Si un message est déjà en français, "
        "renvoie-le inchangé. Aucun texte hors du tableau JSON."
    )
    chat = make_chat(system, f"trans_{uid}_{thread_uid}")
    raw = await chat.send_message(UserMessage(text=json.dumps(texts, ensure_ascii=False)))
    txt = (raw or "").strip()
    if txt.startswith("```"):
        txt = re.sub(r"^```(?:json)?\s*", "", txt)
        txt = re.sub(r"\s*```$", "", txt).strip()
    try:
        arr = json.loads(txt)
        if isinstance(arr, list) and len(arr) == len(texts):
            return [str(x) for x in arr]
    except Exception:
        pass
    return []
class ReplyIn(BaseModel):
    message: str
    subject: str = ""
async def _generate_drafts_for_user(uid: str) -> int:
    """Pré-génère les brouillons IA pour les conversations non lues (notifications)."""
    if not await _ai_auto_draft_enabled(uid):
        return 0
    adapter, _ = await get_channel_adapter(uid)
    if not adapter:
        return 0
    convs = await db.conversations.find(
        {"user_id": uid, "unread": True}, {"_id": 0}).sort("last_activity", -1).to_list(30)
    count = 0
    async with httpx.AsyncClient(timeout=30) as http:
        for conv in convs[:15]:
            try:
                thread = await adapter.get_thread(http, conv["thread_uid"])
            except Exception:
                continue
            msgs = _normalize_msgs(thread)
            if not msgs or msgs[-1].get("mine"):
                continue
            last = msgs[-1]
            if conv.get("ai_draft") and conv.get("ai_draft_msg_id") == last["id"]:
                continue
            prop = await db.properties.find_one(
                {"id": conv.get("property_id"), "user_id": uid}, {"_id": 0})
            try:
                draft = await _make_guest_draft(uid, conv["thread_uid"], last["text"], prop)
            except Exception:
                continue
            await _store_draft(uid, conv["thread_uid"], last["id"], draft)
            count += 1
    return count
class StaffIn(BaseModel):
    name: str
    role: str = ""
    phone: str = ""
    email: str = ""
class MemberIn(BaseModel):
    first_name: str = ""
    last_name: str = ""
    email: str = ""
    phone: str = ""
    language: str = "fr"
    role: str = "member"
    permissions: List[str] = []
    property_ids: List[str] = []
    active: bool = True
class InviteIn(BaseModel):
    origin_url: str
class AcceptInviteIn(BaseModel):
    token: str
    password: str
class LoginIn(BaseModel):
    email: str
    password: str
async def _create_member_session(member: dict) -> dict:
    token = secrets.token_urlsafe(32)
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": member["user_id"],
        "kind": "member",
        "member_id": member["id"],
        "created_at": now_utc(),
        "expires_at": now_utc() + timedelta(days=30),
    })
    name = f'{member.get("first_name", "")} {member.get("last_name", "")}'.strip()
    return {
        "session_token": token,
        "user": {
            "user_id": member["user_id"],
            "email": member.get("email", ""),
            "name": name or member.get("email", ""),
            "role": "member",
        },
    }
class OwnerIn(BaseModel):
    name: str
    email: str = ""
    phone: str = ""
    notes: str = ""
class ExpenseIn(BaseModel):
    property_id: str
    month: str            # YYYY-MM
    label: str
    amount: float = 0
    charge_to: str = "owner"   # owner | concierge
def _res_amounts(r: dict) -> dict:
    """Ventilation d'une réservation : nuitées / ménage / taxe / commission plateforme."""
    fin = r.get("finance") or {}
    nights = float(r.get("nights_total") or fin.get("stay") or r.get("total_price") or 0)
    cleaning = float(r.get("cleaning_fee") or fin.get("fees") or 0)
    tax = float(r.get("tourist_tax") or fin.get("taxes") or 0)
    commission = float(fin.get("commission") or 0)
    return {"nights": round(nights, 2), "cleaning": round(cleaning, 2),
            "tax": round(tax, 2), "commission": round(commission, 2)}
def _resolve_period(month: str = "", start: str = "", end: str = ""):
    """Retourne (start_date, end_date_exclusive, period_key, period_label).
    Soit un mois (YYYY-MM), soit une plage explicite start..end (YYYY-MM-DD, end inclus)."""
    if start and end:
        try:
            sd = datetime.fromisoformat(start).date()
            ed = datetime.fromisoformat(end).date()
        except Exception:
            raise HTTPException(status_code=400, detail="Dates invalides (YYYY-MM-DD)")
        if ed < sd:
            raise HTTPException(status_code=400, detail="La date de fin précède la date de début")
        end_excl = (ed + timedelta(days=1)).isoformat()
        key = f"{sd.isoformat()}_{ed.isoformat()}"
        label = f"{sd.strftime('%d/%m/%Y')} → {ed.strftime('%d/%m/%Y')}"
        return sd.isoformat(), end_excl, key, label
    try:
        y, m = month.split("-")
        sd = f"{int(y):04d}-{int(m):02d}-01"
        nm = int(m) + 1
        ny = int(y) + (1 if nm > 12 else 0)
        nm = 1 if nm > 12 else nm
        ed_excl = f"{ny:04d}-{nm:02d}-01"
    except Exception:
        raise HTTPException(status_code=400, detail="Mois invalide (YYYY-MM)")
    return sd, ed_excl, month, month
class CommissionOverrideIn(BaseModel):
    property_id: str
    month: str
    commission: Optional[float] = None   # None => revenir à la valeur automatique
def _money(n) -> str:
    return f"{(n or 0):.2f} €"
def _company_header_html(company: dict, logo_url: str = "") -> str:
    """Bandeau d'en-tête : logo Casanéo + coordonnées de la société de conciergerie."""
    c = company or {}
    logo = (
        f"<img src='{escape(logo_url)}' alt='Casanéo' style='height:44px;display:block' />"
        if logo_url else
        "<div style='font-family:Arial,sans-serif;font-size:22px;font-weight:800;color:#2A6F9E'>Casanéo</div>"
    )
    name = escape(str(c.get("name") or ""))
    addr_parts = [c.get("address"), " ".join([str(c.get("postal_code") or ""), str(c.get("city") or "")]).strip()]
    addr = " · ".join([escape(str(a).strip()) for a in addr_parts if str(a or "").strip()])
    contact_parts = []
    if c.get("phone"): contact_parts.append("Tél. " + escape(str(c["phone"])))
    if c.get("email"): contact_parts.append(escape(str(c["email"])))
    if c.get("website"): contact_parts.append(escape(str(c["website"])))
    contact = " · ".join(contact_parts)
    legal_parts = []
    if c.get("siret"): legal_parts.append("SIRET " + escape(str(c["siret"])))
    if c.get("vat"): legal_parts.append("TVA " + escape(str(c["vat"])))
    legal = " · ".join(legal_parts)
    right = ""
    if name or addr or contact or legal:
        right = (
            "<div style='text-align:right;font-family:Arial,sans-serif;font-size:12px;color:#555;line-height:1.5'>"
            + (f"<div style='font-weight:700;color:#111;font-size:14px'>{name}</div>" if name else "")
            + (f"<div>{addr}</div>" if addr else "")
            + (f"<div>{contact}</div>" if contact else "")
            + (f"<div style='color:#999'>{legal}</div>" if legal else "")
            + "</div>"
        )
    return (
        "<table style='width:100%;border-collapse:collapse;margin-bottom:16px'>"
        f"<tr><td style='vertical-align:top'>{logo}</td>"
        f"<td style='vertical-align:top'>{right}</td></tr></table>"
        "<div style='height:3px;background:#2A6F9E;border-radius:2px;margin-bottom:16px'></div>"
    )
def _statement_body_html(month: str, s: dict) -> str:
    """Corps du relevé pour UN logement (titre + tableau), sans en-tête société."""
    t = s["totals"]
    m = _money
    rows = "".join(
        f"<tr><td style='padding:6px 0;color:#555'>{escape(str(l.get('guest_name') or '—'))} · "
        f"{escape(str(l.get('check_in') or ''))}→{escape(str(l.get('check_out') or ''))} "
        f"({escape(str(l.get('platform') or ''))})</td>"
        f"<td style='padding:6px 0;text-align:right;font-weight:600'>{m(l.get('nights'))}</td></tr>"
        for l in s.get("lines", [])
    )

    def line(lbl, val, bold=False, color="#111"):
        w = "700" if bold else "400"
        return (f"<tr><td style='padding:5px 0;color:#555'>{escape(lbl)}</td>"
                f"<td style='padding:5px 0;text-align:right;font-weight:{w};color:{color}'>{val}</td></tr>")

    reg = ""
    if (t.get("tax_regional") or 0) > 0:
        reg = line("Taxe add. régionale (à reverser)", m(t.get("tax_regional")))
    res_header = ("<tr><td colspan=2 style='padding-top:8px;font-weight:700;color:#2A6F9E'>Réservations</td></tr>" + rows) if rows else ""
    prop_title = escape(str(s.get("property_name") or ""))
    gestion_lbl = "Frais de gestion (" + str(s.get("management_fee_pct", 0)) + "%)"
    tax_sej = m(t.get("tax_sejour") if t.get("tax_sejour") is not None else t.get("tax"))
    return (
        f"<h3 style='color:#2A6F9E;margin:18px 0 4px'>{prop_title}</h3>"
        f"<p style='color:#777;margin:0 0 6px'>{s.get('reservations_count',0)} réservation(s) · Frais de gestion {s.get('management_fee_pct',0)}%</p>"
        f"<table style='width:100%;border-collapse:collapse;font-size:14px'>"
        f"{res_header}"
        f"<tr><td colspan=2 style='border-top:1px solid #eee;padding-top:8px'></td></tr>"
        f"{line('Nuitées (base voyageurs)', m(t.get('nights')))}"
        f"{line('Frais de ménage (conciergerie)', m(t.get('cleaning')))}"
        f"{line('Taxe de séjour (à reverser)', tax_sej)}"
        f"{reg}"
        f"{line('Commissions OTA', '-' + m(t.get('commission')))}"
        f"{line(gestion_lbl, m(t.get('management_fee')))}"
        f"<tr><td colspan=2 style='border-top:2px solid #2A6F9E;padding-top:8px'></td></tr>"
        f"{line('Revenu propriétaire', m(t.get('owner_revenue')), bold=True, color='#2A6F9E')}"
        f"{line('Revenu conciergerie', m(t.get('concierge_revenue')))}"
        f"</table>"
    )
def _month_label(month: str) -> str:
    try:
        return f"{month.split('-')[1]}/{month.split('-')[0]}"
    except Exception:
        return month
def _statement_html(month: str, s: dict, company: dict = None, logo_url: str = "",
                    period_label: str = None) -> str:
    """Relevé complet pour UN logement (en-tête société + corps + pied)."""
    lbl = period_label or _month_label(month)
    return (
        "<div style='font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:16px'>"
        f"{_company_header_html(company or {}, logo_url)}"
        f"<h2 style='color:#111;margin:0 0 4px'>Relevé de gestion — {escape(lbl)}</h2>"
        f"{_statement_body_html(month, s)}"
        "<p style='color:#aaa;font-size:12px;margin-top:24px'>Édité via Casanéo</p>"
        "</div>"
    )
def _combined_statement_html(month: str, statements: list, owner_name: str,
                             company: dict = None, logo_url: str = "",
                             period_label: str = None) -> str:
    """Relevé regroupant TOUS les logements d'un même propriétaire pour la période."""
    lbl = period_label or _month_label(month)
    g_owner = round(sum((st["totals"].get("owner_revenue") or 0) for st in statements), 2)
    g_conc = round(sum((st["totals"].get("concierge_revenue") or 0) for st in statements), 2)
    bodies = "<div style='height:1px;background:#eee;margin:20px 0'></div>".join(
        _statement_body_html(month, st) for st in statements
    )
    total_block = ""
    if len(statements) > 1:
        total_block = (
            "<div style='margin-top:24px;padding:14px 16px;background:#F0F6FB;border-radius:12px'>"
            "<table style='width:100%;border-collapse:collapse;font-size:15px'>"
            f"<tr><td style='color:#555;padding:4px 0'>Total revenu propriétaire ({len(statements)} logements)</td>"
            f"<td style='text-align:right;font-weight:800;color:#2A6F9E'>{_money(g_owner)}</td></tr>"
            f"<tr><td style='color:#555;padding:4px 0'>Total revenu conciergerie</td>"
            f"<td style='text-align:right;font-weight:600'>{_money(g_conc)}</td></tr>"
            "</table></div>"
        )
    return (
        "<div style='font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:16px'>"
        f"{_company_header_html(company or {}, logo_url)}"
        f"<h2 style='color:#111;margin:0 0 4px'>Relevé de gestion — {escape(lbl)}</h2>"
        + (f"<p style='color:#555;margin:0 0 8px'>Propriétaire : {escape(str(owner_name))}</p>" if owner_name else "")
        + bodies
        + total_block
        + "<p style='color:#aaa;font-size:12px;margin-top:24px'>Édité via Casanéo</p>"
        "</div>"
    )
class StatementEmailIn(BaseModel):
    month: str = ""
    start: str = ""
    end: str = ""
    property_id: str
    base_url: Optional[str] = None
def _logo_url_from_base(base: str, company: dict = None) -> str:
    """URL publique du logo pour l'en-tête : logo de la société si téléversé, sinon logo Casanéo."""
    base = (base or "").rstrip("/")
    if not base:
        return ""
    lp = (company or {}).get("logo_path")
    if lp:
        return f"{base}/api/company-logo/{lp}"
    return f"{base}/api/assets/casaneo-logo.png"
async def _record_statement_send(uid: str, property_id: str, month: str, to: str):
    await db.statement_sends.update_one(
        {"user_id": uid, "property_id": property_id, "month": month},
        {"$set": {"user_id": uid, "property_id": property_id, "month": month,
                  "sent_at": now_utc().isoformat(), "to": to}},
        upsert=True,
    )
class StatementEmailAllIn(BaseModel):
    month: str = ""
    start: str = ""
    end: str = ""
    base_url: Optional[str] = None
class ReviewIn(BaseModel):
    property_id: str
    reservation_id: str = ""
    guest_name: str = ""
    rating: int = 5           # 1..5
    comment: str = ""
    date: str = ""            # YYYY-MM-DD (défaut aujourd'hui)
    platform: str = ""
class PromotionIn(BaseModel):
    name: str
    description: str = ""
    photo_path: str = ""
    require_code: bool = False
    code: str = ""
    calc_type: str = "none"        # none | fixed | percentage
    amount: float = 0
    period_enabled: bool = False
    start_date: str = ""           # YYYY-MM-DD
    end_date: str = ""
    property_ids: List[str] = []
    enabled: bool = True
def _clean_promotion(data: dict) -> dict:
    data["name"] = str(data.get("name") or "").strip() or "Promotion"
    data["calc_type"] = data.get("calc_type") if data.get("calc_type") in ("none", "fixed", "percentage") else "none"
    try:
        amt = float(data.get("amount") or 0)
    except Exception:
        amt = 0
    if data["calc_type"] == "percentage":
        amt = max(0.0, min(100.0, amt))
    data["amount"] = round(max(0.0, amt), 2)
    data["require_code"] = bool(data.get("require_code"))
    data["code"] = str(data.get("code") or "").strip()
    data["period_enabled"] = bool(data.get("period_enabled"))
    data["property_ids"] = [str(x) for x in (data.get("property_ids") or [])]
    data["enabled"] = bool(data.get("enabled", True))
    return data
def _monthly_report_html(period_label: str, kpi: dict, company: dict = None, logo_url: str = "") -> str:
    """Récap global (tous logements) : synthèse conciergerie + tableau par logement."""
    m = _money
    t = kpi.get("totals") or {}
    occ = kpi.get("occupancy_all", 0)

    def kpi_card(lbl, val, color="#2A6F9E"):
        return (
            "<td style='padding:10px;width:33%;vertical-align:top'>"
            "<div style='background:#F0F6FB;border-radius:12px;padding:12px'>"
            f"<div style='font-size:12px;color:#666'>{escape(lbl)}</div>"
            f"<div style='font-size:20px;font-weight:800;color:{color};margin-top:4px'>{val}</div>"
            "</div></td>"
        )

    rows = "".join(
        "<tr>"
        f"<td style='padding:6px 4px;color:#333'>{escape(str(p.get('name') or ''))}</td>"
        f"<td style='padding:6px 4px;text-align:right'>{p.get('reservations', 0)}</td>"
        f"<td style='padding:6px 4px;text-align:right'>{p.get('occupancy', 0)}%</td>"
        f"<td style='padding:6px 4px;text-align:right;font-weight:600'>{m(p.get('concierge_revenue'))}</td>"
        f"<td style='padding:6px 4px;text-align:right;color:#2A6F9E;font-weight:600'>{m(p.get('owner_revenue'))}</td>"
        "</tr>"
        for p in (kpi.get("per_property") or [])
    )
    return (
        "<div style='font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:16px'>"
        f"{_company_header_html(company or {}, logo_url)}"
        f"<h2 style='color:#111;margin:0 0 4px'>Rapport d'activité — {escape(period_label)}</h2>"
        f"<p style='color:#777;margin:0 0 12px'>{kpi.get('properties_count', 0)} logement(s) · "
        f"{t.get('reservations', 0)} réservation(s) · occupation moyenne {occ}%</p>"
        "<table style='width:100%;border-collapse:collapse;margin-bottom:8px'><tr>"
        + kpi_card("Revenu conciergerie", m(t.get("concierge_revenue")))
        + kpi_card("Revenu propriétaires", m(t.get("owner_revenue")))
        + kpi_card("Frais de gestion", m(t.get("management_fee")))
        + "</tr></table>"
        "<table style='width:100%;border-collapse:collapse;font-size:13px;margin-top:12px'>"
        "<tr style='color:#2A6F9E;font-weight:700;border-bottom:2px solid #2A6F9E'>"
        "<td style='padding:6px 4px'>Logement</td>"
        "<td style='padding:6px 4px;text-align:right'>Rés.</td>"
        "<td style='padding:6px 4px;text-align:right'>Occ.</td>"
        "<td style='padding:6px 4px;text-align:right'>Conciergerie</td>"
        "<td style='padding:6px 4px;text-align:right'>Propriétaire</td></tr>"
        f"{rows}"
        "</table>"
        "<p style='color:#aaa;font-size:12px;margin-top:24px'>Édité via Casanéo</p>"
        "</div>"
    )
class MonthlyReportIn(BaseModel):
    month: str = ""
    base_url: Optional[str] = None
DEFAULT_TEMPLATES = [
    {"marker_key": "paid", "name": "Payée", "kind": "payment", "color": "#30D158",
     "body": "", "trigger_event": "payment", "trigger_days": 0, "enabled": True, "order": 10},
    {"marker_key": "booklet", "name": "Livret d'accueil envoyé", "kind": "message", "color": "#0A84FF",
     "body": "Bonjour {guest}, voici votre livret d'accueil pour {property} : {welcome_book}. Bon séjour !",
     "trigger_event": "before_arrival", "trigger_days": 3, "enabled": False, "order": 20},
    {"marker_key": "keys", "name": "Instructions clés envoyées", "kind": "message", "color": "#BF5AF2",
     "body": "Bonjour {guest}, voici les instructions pour récupérer les clés de {property}.",
     "trigger_event": "before_arrival", "trigger_days": 1, "enabled": False, "order": 30},
]
class MessageTemplateIn(BaseModel):
    name: str
    body: str = ""
    color: str = "#0A84FF"
    trigger_event: str = "before_arrival"  # before_arrival | payment
    trigger_days: int = 3
    enabled: bool = False
async def get_templates(uid: str):
    docs = await db.message_templates.find({"user_id": uid}, {"_id": 0}).to_list(100)
    if not docs:
        docs = []
        for t in DEFAULT_TEMPLATES:
            doc = {**t, "id": str(uuid.uuid4()), "user_id": uid, "created_at": now_utc().isoformat()}
            await db.message_templates.insert_one(doc)
            doc.pop("_id", None)
            docs.append(doc)
    docs.sort(key=lambda x: x.get("order", 100))
    return docs
DEFAULT_QUICK_REPLIES = [
    {"title": "Arrivée (check-in)",
     "body": "Bonjour, l'arrivée se fait à partir de 16h. Je vous transmettrai les instructions d'accès la veille de votre arrivée. Bon voyage !"},
    {"title": "Wifi",
     "body": "Le code Wifi est affiché dans le logement (livret d'accueil). N'hésitez pas si vous avez besoin d'aide pour vous connecter."},
    {"title": "Parking",
     "body": "Un parking gratuit est disponible à proximité du logement. Je vous communiquerai les détails à votre arrivée."},
]
class QuickReplyIn(BaseModel):
    title: str
    body: str
async def _seed_quick_replies(uid: str):
    docs = await db.quick_replies.find({"user_id": uid}, {"_id": 0}).to_list(200)
    if not docs:
        docs = []
        for i, q in enumerate(DEFAULT_QUICK_REPLIES):
            doc = {**q, "id": str(uuid.uuid4()), "user_id": uid, "order": i,
                   "created_at": now_utc().isoformat()}
            await db.quick_replies.insert_one(doc)
            doc.pop("_id", None)
            docs.append(doc)
    docs.sort(key=lambda x: x.get("order", 100))
    return docs
async def run_automations_for_user(uid: str):
    """Send due automatic messages via Lodgify and set the corresponding markers.
    Envoie aussi automatiquement les instructions de clés aux voyageurs Airbnb (sans caution)."""
    settings = await db.channel_settings.find_one({"user_id": uid}, {"_id": 0})
    if not settings or not settings.get("api_key"):
        return 0
    templates = await get_templates(uid)
    active = [t for t in templates if t.get("kind") == "message" and t.get("enabled")]
    tmap = {t["marker_key"]: t for t in templates}
    adapter = LodgifyAdapter(settings["api_key"])
    base_url = settings.get("public_base_url") or ""
    reminder_days = int(settings.get("deposit_reminder_days") or 2)
    props = await db.properties.find({"user_id": uid}, {"_id": 0}).to_list(2000)
    pmap = {p["id"]: p for p in props}
    today = date.today()
    sent = 0
    reservations = await db.reservations.find(
        {"user_id": uid, "source": "lodgify", "status": {"$ne": "annulee"},
         "thread_uid": {"$nin": [None, ""]}, "lodgify_id": {"$nin": [None, ""]}},
        {"_id": 0}).to_list(3000)
    async with httpx.AsyncClient(timeout=30) as http:
        for r in reservations:
            try:
                ci = date.fromisoformat(r["check_in"]) if r.get("check_in") else None
            except Exception:
                ci = None
            if not ci or ci < today:
                continue
            markers = set(r.get("markers") or [])
            changed = False
            for t in active:
                if t["marker_key"] in markers:
                    continue
                if t["trigger_event"] == "before_arrival" and today >= ci - timedelta(days=int(t.get("trigger_days", 0))):
                    body = (t.get("body") or "").replace("{guest}", r.get("guest_name", "")).replace(
                        "{property}", r.get("property_name") or "").replace(
                        "{welcome_book}", (pmap.get(r.get("property_id"), {}) or {}).get("welcome_book_url", "") or "").replace(
                        "{caution}", (pmap.get(r.get("property_id"), {}) or {}).get("deposit_link", "") or "")
                    try:
                        await adapter.send_message(http, r["lodgify_id"], body, t["name"])
                    except Exception:
                        continue
                    markers.add(t["marker_key"])
                    changed = True
                    sent += 1
            # Airbnb : caution non requise → envoi auto des clés 1 jour avant l'arrivée
            plat = (r.get("platform") or "").lower()
            if "airbnb" in plat and not r.get("keys_sent_at") and today >= ci - timedelta(days=1):
                prop = pmap.get(r.get("property_id")) or {}
                if prop.get("key_instructions") or prop.get("key_photos"):
                    body = _build_keys_message(r, prop, base_url)
                    try:
                        await adapter.send_message(http, r["lodgify_id"], body, "Récupération des clés")
                        await db.reservations.update_one(
                            {"user_id": uid, "id": r["id"]},
                            {"$set": {"keys_sent_at": now_utc().isoformat()}})
                        sent += 1
                    except Exception:
                        pass
            # Relance caution à J-2 : hors Airbnb, caution non validée, lien de caution défini
            if ("airbnb" not in plat and not r.get("caution_validated")
                    and not r.get("deposit_reminder_sent_at") and today >= ci - timedelta(days=reminder_days)):
                prop = pmap.get(r.get("property_id")) or {}
                link = (prop.get("deposit_link") or "").strip()
                if link:
                    guest = r.get("guest_name") or ""
                    pname = r.get("property_name") or prop.get("name") or "votre logement"
                    body = (f"Bonjour {guest},".rstrip(",") + "\n"
                            f"Petit rappel : votre arrivée à {pname} approche. Si ce n'est pas déjà fait, "
                            f"merci de régler la caution via ce lien sécurisé :\n{link}\n\nMerci et à bientôt !")
                    try:
                        await adapter.send_message(http, r["lodgify_id"], body, "Rappel caution")
                        await db.reservations.update_one(
                            {"user_id": uid, "id": r["id"]},
                            {"$set": {"deposit_reminder_sent_at": now_utc().isoformat()}})
                        sent += 1
                    except Exception:
                        pass
            if changed:
                await db.reservations.update_one(
                    {"user_id": uid, "id": r["id"]},
                    {"$set": {"markers": list(markers), "marker_color": marker_color_for(list(markers), tmap)}})
        # Demande d'avis automatique après le départ (X jours après le check-out)
        prefs = await db.preferences.find_one({"user_id": uid}, {"_id": 0}) or {}
        if prefs.get("review_request_enabled"):
            rdays = int(prefs.get("review_request_days") or 1)
            for r in reservations:
                if r.get("review_request_sent_at"):
                    continue
                try:
                    co = date.fromisoformat(r["check_out"]) if r.get("check_out") else None
                except Exception:
                    co = None
                if not co or today < co + timedelta(days=rdays) or today > co + timedelta(days=rdays + 14):
                    continue  # hors fenêtre (trop tôt ou trop ancien)
                prop = pmap.get(r.get("property_id")) or {}
                guest = r.get("guest_name") or ""
                pname = r.get("property_name") or prop.get("name") or "notre logement"
                body = (f"Bonjour {guest},".rstrip(",") + "\n"
                        f"Merci d'avoir séjourné à {pname} ! Nous espérons que tout s'est bien passé. "
                        f"Si vous avez un instant, votre avis nous aiderait beaucoup. À bientôt !")
                try:
                    await adapter.send_message(http, r["lodgify_id"], body, "Demande d'avis")
                    await db.reservations.update_one(
                        {"user_id": uid, "id": r["id"]},
                        {"$set": {"review_request_sent_at": now_utc().isoformat()}})
                    sent += 1
                except Exception:
                    pass

    return sent
import requests as _requests
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from fastapi import UploadFile, File
_STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
_STORAGE_URL = _STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
_EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
_APP_NAME = "staypilot"
_storage_key = None
def _init_storage():
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = _requests.post(f"{_STORAGE_URL}/init", json={"emergent_key": _EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key
def _put_object(path: str, data: bytes, content_type: str):
    global _storage_key
    key = _init_storage()
    resp = _requests.put(f"{_STORAGE_URL}/objects/{path}",
                         headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    if resp.status_code == 503:
        _storage_key = None
        key = _init_storage()
        resp = _requests.put(f"{_STORAGE_URL}/objects/{path}",
                             headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    resp.raise_for_status()
    return resp.json()
def _get_object(path: str):
    key = _init_storage()
    resp = _requests.get(f"{_STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


__all__ = [
    'FastAPI',
    'APIRouter',
    'Depends',
    'HTTPException',
    'Header',
    'Request',
    'Body',
    'load_dotenv',
    'CORSMiddleware',
    'AsyncIOMotorClient',
    'os',
    're',
    'json',
    'asyncio',
    'logging',
    'uuid',
    'escape',
    'pycalendar',
    'Path',
    'BaseModel',
    'Field',
    'List',
    'Optional',
    'datetime',
    'timezone',
    'timedelta',
    'date',
    'httpx',
    'LlmChat',
    'UserMessage',
    'StripeCheckout',
    'CheckoutSessionRequest',
    'secrets',
    'sha256',
    'LODGIFY_STATUS_MAP',
    'source_label',
    'strip_html',
    'LodgifyAdapter',
    'map_lodgify_property',
    'ChannexAdapter',
    'map_channex_property',
    'map_channex_room',
    'map_channex_rate_plan',
    'send_email',
    'build_invite_email',
    'now_utc',
    'hash_password',
    'verify_password',
    'norm_email',
    'hash_token',
    'DEFAULT_STATUSES',
    'DEFAULT_STATUS_COLORS',
    'CORE_STATUS_KEYS',
    'DEFAULT_COMMISSION_RATES',
    'DEFAULT_PAYMENT_METHODS',
    '_build_payment_methods',
    '_build_commission_rates',
    '_build_statuses',
    'compute_display',
    'recompute_payment',
    'marker_color_for',
    '_unfold_ical',
    '_parse_ical_date',
    'parse_ical',
    '_BLOCK_SUMMARIES',
    '_ics_date',
    '_ics_escape',
    '_build_ics',
    'ROOT_DIR',
    'mongo_url',
    'client',
    'db',
    'EMERGENT_LLM_KEY',
    'STRIPE_API_KEY',
    'EMERGENT_AUTH_URL',
    'app',
    'api_router',
    'logger',
    'SessionRequest',
    'Season',
    'IcalLink',
    'PropertyIn',
    'ReservationIn',
    'InterventionIn',
    'GuestReplyRequest',
    'PricingRequest',
    'get_current_user',
    '_prop_scope',
    '_can',
    '_NO_INBOX_ROLES',
    '_can_inbox',
    '_jwt',
    '_PyJWKClient',
    'APPLE_AUDIENCES',
    '_apple_jwk_client',
    'AppleAuthIn',
    'status_color_map',
    'ensure_cleaning',
    'regenerate_auto_cleanings',
    'CautionValidatedIn',
    '_build_keys_message',
    '_send_key_instructions',
    'SendKeysIn',
    'CHECKLIST_KEYS',
    'PublishIn',
    'ChecklistIn',
    'CheckoutIn',
    'stripe_client',
    '_send_booking_confirmation',
    '_apply_stripe_payment',
    '_resolve_public_site',
    '_public_prop_card',
    '_booked_dates',
    '_match_promo',
    '_public_quote',
    'PublicQuoteIn',
    'PublicBookingIn',
    '_create_public_reservation',
    '_send_request_ack',
    'CHECKIN_QUESTION_LABELS',
    'CheckinSubmissionIn',
    'run_ical_sync',
    'IcalFrequencyIn',
    '_FREQ_SECONDS',
    'IcalLinksIn',
    'DoneIn',
    'CautionActionIn',
    'DEFAULT_DYNAMIC_PRICING',
    '_price_for_day',
    '_is_high_season',
    'make_chat',
    '_parse_pricing_json',
    'DEFAULT_COMPANY',
    '_COMPANY_KEYS',
    '_build_company',
    'CHECKIN_PREDEFINED_KEYS',
    'DEFAULT_CHECKIN',
    '_slugify',
    '_build_public_site',
    '_build_checkin',
    'PreferencesIn',
    '_ai_auto_draft_enabled',
    'get_channel_adapter',
    '_sync_log',
    'get_channex_adapter',
    'ChannexConnectIn',
    'BookingPolicyIn',
    '_clean_policy',
    'PUSH_BASE_URL',
    'PUSH_KEY',
    '_push_client',
    'RegisterPushBody',
    'send_push',
    '_set_property_rooms_availability',
    'RoomIn',
    'RatePlanIn',
    '_assert_property',
    'AvailabilitySetIn',
    'ChannelConnectIn',
    'SyncIntervalIn',
    'ReminderDaysIn',
    'run_channel_sync',
    '_normalize_msgs',
    '_TONE_LABELS',
    '_make_guest_draft',
    '_store_draft',
    '_translate_to_fr',
    'ReplyIn',
    '_generate_drafts_for_user',
    'StaffIn',
    'MemberIn',
    'InviteIn',
    'AcceptInviteIn',
    'LoginIn',
    '_create_member_session',
    'OwnerIn',
    'ExpenseIn',
    '_res_amounts',
    '_resolve_period',
    'CommissionOverrideIn',
    '_money',
    '_company_header_html',
    '_statement_body_html',
    '_month_label',
    '_statement_html',
    '_combined_statement_html',
    'StatementEmailIn',
    '_logo_url_from_base',
    '_record_statement_send',
    'StatementEmailAllIn',
    'ReviewIn',
    'PromotionIn',
    '_clean_promotion',
    '_monthly_report_html',
    'MonthlyReportIn',
    'DEFAULT_TEMPLATES',
    'MessageTemplateIn',
    'get_templates',
    'DEFAULT_QUICK_REPLIES',
    'QuickReplyIn',
    '_seed_quick_replies',
    'run_automations_for_user',
    '_requests',
    'run_in_threadpool',
    'Response',
    'UploadFile',
    'File',
    '_STORAGE_BASE',
    '_STORAGE_URL',
    '_EMERGENT_KEY',
    '_APP_NAME',
    '_storage_key',
    '_init_storage',
    '_put_object',
    '_get_object',
]
