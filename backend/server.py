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

# MongoDB connection
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


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
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


# Rôles membres sans accès à la boîte de réception (intervenant, ménage, propriétaire)
_NO_INBOX_ROLES = {"cleaning", "intervenant", "owner"}


def _can_inbox(user) -> bool:
    if user.get("role") != "member":
        return True
    return user.get("member_role") not in _NO_INBOX_ROLES


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@api_router.post("/auth/session")
async def create_session(payload: SessionRequest):
    async with httpx.AsyncClient(timeout=20) as http:
        resp = await http.get(EMERGENT_AUTH_URL, headers={"X-Session-ID": payload.session_id})
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = resp.json()
    email = data.get("email")
    name = data.get("name", "")
    picture = data.get("picture", "")
    session_token = data.get("session_token")

    existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"name": name, "picture": picture}})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "created_at": now_utc().isoformat(),
        })

    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "created_at": now_utc(),
        "expires_at": now_utc() + timedelta(days=7),
    })

    return {
        "session_token": session_token,
        "user": {"user_id": user_id, "email": email, "name": name, "picture": picture},
    }


import jwt as _jwt
from jwt import PyJWKClient as _PyJWKClient

APPLE_AUDIENCES = [a.strip() for a in os.environ.get("APPLE_AUDIENCES", "").split(",") if a.strip()]
_apple_jwk_client = _PyJWKClient("https://appleid.apple.com/auth/keys")


class AppleAuthIn(BaseModel):
    identity_token: str
    name: str = ""
    email: str = ""


@api_router.post("/auth/apple")
async def auth_apple(payload: AppleAuthIn):
    """Sign in with Apple : vérifie l'identity token auprès des clés publiques Apple."""
    try:
        signing_key = _apple_jwk_client.get_signing_key_from_jwt(payload.identity_token)
        claims = _jwt.decode(
            payload.identity_token, signing_key.key, algorithms=["RS256"],
            audience=APPLE_AUDIENCES, issuer="https://appleid.apple.com")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Token Apple invalide: {str(e)[:100]}")
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token Apple sans identifiant")
    email = (claims.get("email") or payload.email or "").strip().lower()

    existing = await db.users.find_one({"apple_sub": sub})
    if not existing and email:
        existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
        upd = {"apple_sub": sub}
        if payload.name and not existing.get("name"):
            upd["name"] = payload.name
        if email and not existing.get("email"):
            upd["email"] = email
        await db.users.update_one({"user_id": user_id}, {"$set": upd})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id, "apple_sub": sub, "email": email,
            "name": payload.name or "Utilisateur Apple", "picture": "",
            "created_at": now_utc().isoformat(),
        })

    session_token = secrets.token_urlsafe(32)
    await db.user_sessions.insert_one({
        "session_token": session_token, "user_id": user_id,
        "created_at": now_utc(), "expires_at": now_utc() + timedelta(days=7),
    })
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"session_token": session_token, "user": user}


@api_router.get("/auth/me")
async def get_me(user=Depends(get_current_user)):
    return user


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Properties
# ---------------------------------------------------------------------------
@api_router.get("/properties")
async def list_properties(user=Depends(get_current_user)):
    items = await db.properties.find(
        {"user_id": user["user_id"], **_prop_scope(user)}, {"_id": 0}).to_list(500)
    return items


@api_router.post("/properties")
async def create_property(payload: PropertyIn, user=Depends(get_current_user)):
    doc = payload.dict()
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    await db.properties.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/properties/{property_id}")
async def get_property(property_id: str, user=Depends(get_current_user)):
    item = await db.properties.find_one(
        {"id": property_id, "user_id": user["user_id"], **_prop_scope(user)}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Property not found")
    return item


@api_router.put("/properties/{property_id}")
async def update_property(property_id: str, payload: PropertyIn, user=Depends(get_current_user)):
    data = payload.dict()
    # Never wipe an existing channel mapping when the form omits it
    if data.get("lodgify_id") is None:
        data.pop("lodgify_id", None)
    if data.get("owner_id") is None:
        data.pop("owner_id", None)
    if data.get("dynamic_pricing") is None:
        data.pop("dynamic_pricing", None)
    res = await db.properties.update_one(
        {"id": property_id, "user_id": user["user_id"]},
        {"$set": data},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Property not found")
    item = await db.properties.find_one({"id": property_id}, {"_id": 0})
    return item


@api_router.delete("/properties/{property_id}")
async def delete_property(property_id: str, user=Depends(get_current_user)):
    await db.properties.delete_one({"id": property_id, "user_id": user["user_id"]})
    await db.reservations.delete_many({"property_id": property_id, "user_id": user["user_id"]})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Reservations
# ---------------------------------------------------------------------------
async def status_color_map(uid: str):
    doc = await db.preferences.find_one({"user_id": uid}, {"_id": 0})
    m = {s["key"]: s["color"] for s in _build_statuses(doc)}
    for k, v in DEFAULT_STATUS_COLORS.items():
        m.setdefault(k, v)
    return m


@api_router.get("/reservations")
async def list_reservations(status: Optional[str] = None, property_id: Optional[str] = None, user=Depends(get_current_user)):
    query = {"user_id": user["user_id"], **_prop_scope(user, "property_id")}
    if status:
        query["status"] = status
    if property_id:
        query["property_id"] = property_id
    items = await db.reservations.find(query, {"_id": 0}).sort("check_in", 1).to_list(1000)
    cmap = await status_color_map(user["user_id"])
    for it in items:
        compute_display(it, cmap)
    return items


async def ensure_cleaning(user_id: str, property_id: str, checkout_date: Optional[str], status: Optional[str]):
    """Auto-create a ménage intervention on the guest departure day (idempotent)."""
    if not checkout_date or status == "annulee":
        return
    # Do not create cleaning tasks for past departures
    try:
        if date.fromisoformat(checkout_date) < date.today():
            return
    except Exception:
        pass
    exists = await db.interventions.find_one({
        "user_id": user_id,
        "property_id": property_id,
        "date": checkout_date,
        "kind": "menage",
        "auto": True,
    })
    if exists:
        return
    await db.interventions.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "property_id": property_id,
        "kind": "menage",
        "date": checkout_date,
        "description": "Ménage après départ",
        "intervenant": "",
        "done": False,
        "not_done_reason": "",
        "auto": True,
        "created_at": now_utc().isoformat(),
    })


@api_router.post("/reservations")
async def create_reservation(payload: ReservationIn, user=Depends(get_current_user)):
    doc = payload.dict()
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    name = f"{doc.get('guest_first_name', '')} {doc.get('guest_last_name', '')}".strip()
    if name:
        doc["guest_name"] = name
    nights = float(doc.get("nights_total") or 0)
    fees = float(doc.get("cleaning_fee") or 0)
    tax = float(doc.get("tourist_tax") or 0)
    total = float(doc.get("total_price") or 0)
    if nights or fees or tax:
        total = round(nights + fees + tax, 2)
        doc["total_price"] = total
    doc["finance"] = {"total": total, "paid": 0.0, "due": total, "currency": "EUR",
                      "stay": nights, "fees": fees, "taxes": tax}
    doc["payments"] = []
    await db.reservations.insert_one(doc)
    doc.pop("_id", None)
    await ensure_cleaning(user["user_id"], doc["property_id"], doc.get("check_out"), doc.get("status"))
    if doc.get("status") != "annulee":
        await _set_property_rooms_availability(user["user_id"], doc["property_id"], doc.get("check_in"), doc.get("check_out"), True)
    return doc


@api_router.put("/reservations/{reservation_id}")
async def update_reservation(reservation_id: str, payload: ReservationIn, user=Depends(get_current_user)):
    data = payload.dict()
    name = f"{data.get('guest_first_name', '')} {data.get('guest_last_name', '')}".strip()
    if name:
        data["guest_name"] = name
    nights = float(data.get("nights_total") or 0)
    fees = float(data.get("cleaning_fee") or 0)
    tax = float(data.get("tourist_tax") or 0)
    if nights or fees or tax:
        data["total_price"] = round(nights + fees + tax, 2)
    res = await db.reservations.update_one(
        {"id": reservation_id, "user_id": user["user_id"]},
        {"$set": data},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Reservation not found")
    item = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    # Réservations manuelles : garder finance.total + ventilation alignés
    if item.get("source") != "lodgify":
        fin = dict(item.get("finance") or {})
        fin["total"] = float(item.get("total_price") or 0)
        if nights or fees or tax:
            fin["stay"] = nights
            fin["fees"] = fees
            fin["taxes"] = tax
        item["finance"] = fin
        recompute_payment(item)
        await db.reservations.update_one(
            {"id": reservation_id, "user_id": user["user_id"]},
            {"$set": {"finance": item["finance"]}})
        item = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    await ensure_cleaning(user["user_id"], item["property_id"], item.get("check_out"), item.get("status"))
    await _set_property_rooms_availability(user["user_id"], item["property_id"], item.get("check_in"), item.get("check_out"),
                                           item.get("status") != "annulee")
    return item


@api_router.patch("/reservations/{reservation_id}/status")
async def update_status(reservation_id: str, body: dict, user=Depends(get_current_user)):
    new_status = body.get("status")
    if not isinstance(new_status, str) or not new_status.strip():
        raise HTTPException(status_code=400, detail="Invalid status")
    new_status = new_status.strip()
    # Allow core statuses + any custom status defined in the user's preferences
    doc = await db.preferences.find_one({"user_id": user["user_id"]}, {"_id": 0})
    valid_keys = {s["key"] for s in _build_statuses(doc)}
    if new_status not in valid_keys:
        raise HTTPException(status_code=400, detail="Invalid status")
    res = await db.reservations.update_one(
        {"id": reservation_id, "user_id": user["user_id"]},
        {"$set": {"status": new_status}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Reservation not found")
    item = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    await _set_property_rooms_availability(user["user_id"], item["property_id"], item.get("check_in"), item.get("check_out"),
                                           new_status != "annulee")
    return item


@api_router.patch("/reservations/{reservation_id}/paid")
async def set_reservation_paid(reservation_id: str, body: dict, user=Depends(get_current_user)):
    uid = user["user_id"]
    paid = bool(body.get("paid", True))
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    r["paid_manual"] = paid
    fully = recompute_payment(r)
    markers = set(r.get("markers") or [])
    if paid or fully:
        markers.add("paid")
    else:
        markers.discard("paid")
    tmap = {t["marker_key"]: t for t in await get_templates(uid)}
    await db.reservations.update_one(
        {"id": reservation_id, "user_id": uid},
        {"$set": {"paid_manual": paid, "finance": r["finance"], "markers": list(markers),
                  "marker_color": marker_color_for(list(markers), tmap)}})
    item = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    compute_display(item, await status_color_map(uid))
    return item


@api_router.post("/reservations/{reservation_id}/payments")
async def add_payment(reservation_id: str, body: dict, user=Depends(get_current_user)):
    uid = user["user_id"]
    amount = float(body.get("amount") or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Montant invalide")
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    payments = r.get("payments") or []
    payments.append({
        "id": str(uuid.uuid4()),
        "amount": round(amount, 2),
        "date": body.get("date") or date.today().isoformat(),
        "note": body.get("note", ""),
    })
    r["payments"] = payments
    fully = recompute_payment(r)
    markers = set(r.get("markers") or [])
    if fully:
        markers.add("paid")
    tmap = {t["marker_key"]: t for t in await get_templates(uid)}
    await db.reservations.update_one(
        {"id": reservation_id, "user_id": uid},
        {"$set": {"payments": payments, "finance": r["finance"], "markers": list(markers),
                  "marker_color": marker_color_for(list(markers), tmap)}})
    item = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    compute_display(item, await status_color_map(uid))
    return item


@api_router.delete("/reservations/{reservation_id}/payments/{payment_id}")
async def delete_payment(reservation_id: str, payment_id: str, user=Depends(get_current_user)):
    uid = user["user_id"]
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    payments = [p for p in (r.get("payments") or []) if p.get("id") != payment_id]
    r["payments"] = payments
    fully = recompute_payment(r)
    markers = set(r.get("markers") or [])
    if fully or r.get("paid_manual"):
        markers.add("paid")
    else:
        markers.discard("paid")
    tmap = {t["marker_key"]: t for t in await get_templates(uid)}
    await db.reservations.update_one(
        {"id": reservation_id, "user_id": uid},
        {"$set": {"payments": payments, "finance": r["finance"], "markers": list(markers),
                  "marker_color": marker_color_for(list(markers), tmap)}})
    item = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    compute_display(item, await status_color_map(uid))
    return item


@api_router.patch("/reservations/{reservation_id}/commission")
async def set_commission(reservation_id: str, body: dict, user=Depends(get_current_user)):
    uid = user["user_id"]
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    amount = float(body.get("amount") or 0)
    if amount < 0:
        raise HTTPException(status_code=400, detail="Montant invalide")
    fin = dict(r.get("finance") or {})
    fin["commission"] = round(amount, 2)
    await db.reservations.update_one(
        {"id": reservation_id, "user_id": uid}, {"$set": {"finance": fin}})
    item = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    compute_display(item, await status_color_map(uid))
    return item


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


@api_router.patch("/reservations/{reservation_id}/caution-validated")
async def set_caution_validated(reservation_id: str, payload: CautionValidatedIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    if payload.base_url:
        await db.channel_settings.update_one({"user_id": uid}, {"$set": {"public_base_url": payload.base_url}}, upsert=True)
    upd = {"caution_validated": payload.validated}
    keys_sent = False
    reason = "not_validated"
    if payload.validated:
        prop = await db.properties.find_one({"id": r.get("property_id"), "user_id": uid}, {"_id": 0}) or {}
        if r.get("keys_sent_at"):
            reason = "already_sent"
        else:
            try:
                keys_sent, reason = await _send_key_instructions(uid, r, prop, payload.base_url)
            except HTTPException as e:
                reason = f"send_error:{e.detail}"
            except Exception as e:
                reason = f"send_error:{e}"
            if keys_sent:
                upd["keys_sent_at"] = now_utc().isoformat()
    await db.reservations.update_one({"id": reservation_id, "user_id": uid}, {"$set": upd})
    item = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    return {"caution_validated": payload.validated, "keys_sent": keys_sent,
            "reason": reason, "reservation": item}


class SendKeysIn(BaseModel):
    base_url: str = ""


@api_router.post("/reservations/{reservation_id}/send-keys")
async def send_keys(reservation_id: str, payload: SendKeysIn, user=Depends(get_current_user)):
    """Envoi manuel des instructions de clés au voyageur (sans exiger de caution)."""
    uid = user["user_id"]
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    if payload.base_url:
        await db.channel_settings.update_one({"user_id": uid}, {"$set": {"public_base_url": payload.base_url}}, upsert=True)
    prop = await db.properties.find_one({"id": r.get("property_id"), "user_id": uid}, {"_id": 0}) or {}
    keys_sent, reason = await _send_key_instructions(uid, r, prop, payload.base_url)
    if keys_sent:
        await db.reservations.update_one(
            {"id": reservation_id, "user_id": uid},
            {"$set": {"keys_sent_at": now_utc().isoformat()}})
    return {"keys_sent": keys_sent, "reason": reason}


@api_router.post("/reservations/{reservation_id}/send-deposit-link")
async def send_deposit_link(reservation_id: str, user=Depends(get_current_user)):
    """Envoie au voyageur le lien de paiement de la caution défini sur le logement."""
    uid = user["user_id"]
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    prop = await db.properties.find_one({"id": r.get("property_id"), "user_id": uid}, {"_id": 0}) or {}
    link = (prop.get("deposit_link") or "").strip()
    if not link:
        return {"sent": False, "reason": "no_deposit_link"}
    if r.get("source") != "lodgify" or not r.get("thread_uid") or not r.get("lodgify_id"):
        return {"sent": False, "reason": "no_messaging"}
    settings = await db.channel_settings.find_one({"user_id": uid}, {"_id": 0})
    if not settings or not settings.get("api_key"):
        return {"sent": False, "reason": "no_channel"}
    guest = r.get("guest_name") or ""
    pname = r.get("property_name") or prop.get("name") or "votre logement"
    body = (f"Bonjour {guest},".rstrip(",") + "\n"
            f"Afin de finaliser votre réservation pour {pname}, merci de régler la caution "
            f"via ce lien sécurisé :\n{link}\n\nMerci et à bientôt !")
    adapter = LodgifyAdapter(settings["api_key"])
    async with httpx.AsyncClient(timeout=30) as http:
        await adapter.send_message(http, r["lodgify_id"], body, "Caution")
    await db.reservations.update_one(
        {"id": reservation_id, "user_id": uid},
        {"$set": {"deposit_link_sent_at": now_utc().isoformat()}})
    return {"sent": True, "reason": "sent"}


@api_router.get("/deposits/pending")
async def deposits_pending(user=Depends(get_current_user)):
    """Cautions à suivre : arrivées à venir (hors Airbnb) dont la caution n'est pas validée,
    pour un logement ayant un lien de caution. Signale les arrivées J-1 (urgent)."""
    uid = user["user_id"]
    props = await db.properties.find(
        {"user_id": uid, "deposit_link": {"$nin": [None, ""]}, **_prop_scope(user)},
        {"_id": 0, "id": 1, "name": 1}).to_list(2000)
    if not props:
        return []
    prop_ids = [p["id"] for p in props]
    pname = {p["id"]: p["name"] for p in props}
    today = date.today()
    q = {
        "user_id": uid,
        "property_id": {"$in": prop_ids},
        "status": {"$nin": ["annulee"]},
        "check_in": {"$gte": today.isoformat()},
        "caution_validated": {"$ne": True},
        "platform": {"$ne": "Airbnb"},
    }
    res = await db.reservations.find(
        q, {"_id": 0, "id": 1, "guest_name": 1, "property_id": 1, "check_in": 1, "platform": 1,
            "deposit_link_sent_at": 1, "deposit_reminder_sent_at": 1}
    ).sort("check_in", 1).to_list(500)
    out = []
    for r in res:
        try:
            days = (date.fromisoformat(r["check_in"]) - today).days
        except Exception:
            days = None
        out.append({
            "reservation_id": r["id"], "guest_name": r.get("guest_name", ""),
            "property_name": pname.get(r["property_id"], ""), "check_in": r.get("check_in"),
            "platform": r.get("platform", ""),
            "sent": bool(r.get("deposit_link_sent_at")),
            "reminder": bool(r.get("deposit_reminder_sent_at")),
            "days_until": days,
            "urgent": days is not None and days <= 1,
        })
    return out


@api_router.get("/payments/pending")
async def payments_pending(user=Depends(get_current_user)):
    """Réservations à venir dont le solde n'est pas réglé avant l'arrivée."""
    uid = user["user_id"]
    today = date.today()
    q = {
        "user_id": uid,
        "status": {"$nin": ["annulee"]},
        "check_in": {"$gte": today.isoformat()},
        **_prop_scope(user, "property_id"),
    }
    res = await db.reservations.find(q, {"_id": 0}).sort("check_in", 1).to_list(1000)
    out = []
    for r in res:
        if "paid" in (r.get("markers") or []):
            continue
        fin = r.get("finance") or {}
        due = round(float(fin.get("due") or 0), 2)
        if due <= 0:
            continue
        try:
            days = (date.fromisoformat(r["check_in"]) - today).days
        except Exception:
            days = None
        out.append({
            "reservation_id": r["id"], "guest_name": r.get("guest_name", ""),
            "property_name": r.get("property_name", ""), "check_in": r.get("check_in"),
            "platform": r.get("platform", ""), "due": due,
            "total": round(float(fin.get("total") or 0), 2),
            "days_until": days, "urgent": days is not None and days <= 2,
        })
    return out







CHECKLIST_KEYS = ["caution", "keys", "welcome_book", "cleaning"]


class ChecklistIn(BaseModel):
    checklist: dict


@api_router.patch("/reservations/{reservation_id}/checklist")
async def set_reservation_checklist(reservation_id: str, payload: ChecklistIn, user=Depends(get_current_user)):
    """Met à jour la check-list d'arrivée d'une réservation (caution, clés, livret, ménage).
    Le champ `checklist` est hors ReservationIn → préservé par le PUT principal."""
    uid = user["user_id"]
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    current = {k: bool((r.get("checklist") or {}).get(k)) for k in CHECKLIST_KEYS}
    for k in CHECKLIST_KEYS:
        if k in (payload.checklist or {}):
            current[k] = bool(payload.checklist[k])
    await db.reservations.update_one({"id": reservation_id, "user_id": uid}, {"$set": {"checklist": current}})
    return {"checklist": current}



@api_router.delete("/reservations/{reservation_id}")
async def delete_reservation(reservation_id: str, user=Depends(get_current_user)):
    r = await db.reservations.find_one({"id": reservation_id, "user_id": user["user_id"]}, {"_id": 0})
    await db.reservations.delete_one({"id": reservation_id, "user_id": user["user_id"]})
    if r:
        await _set_property_rooms_availability(user["user_id"], r.get("property_id"), r.get("check_in"), r.get("check_out"), False)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Stripe payments (encaissement direct voyageur + caution) — Emergent managed
# ---------------------------------------------------------------------------
class CheckoutIn(BaseModel):
    kind: str = "payment"          # "payment" (acompte/solde) | "deposit" (caution)
    amount: Optional[float] = None
    origin_url: str


def stripe_client() -> StripeCheckout:
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe non configuré")
    return StripeCheckout(api_key=STRIPE_API_KEY)


@api_router.post("/reservations/{reservation_id}/checkout")
async def create_checkout(reservation_id: str, payload: CheckoutIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    fin = r.get("finance") or {}
    # Montant défini côté serveur, jamais fourni librement par le client
    if payload.kind == "deposit":
        amount = float(payload.amount or 0)
        label = "Caution"
    else:
        due = float(fin.get("due") or 0)
        total = float(fin.get("total") or r.get("total_price") or 0)
        default_amount = due if due > 0 else total
        amount = float(payload.amount) if payload.amount else default_amount
        label = "Paiement réservation"
    amount = round(amount, 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Montant invalide")

    currency = (fin.get("currency") or "EUR").lower()
    origin = payload.origin_url.rstrip("/")
    success_url = f"{origin}/reservation-form?id={reservation_id}&stripe=success"
    cancel_url = f"{origin}/reservation-form?id={reservation_id}&stripe=cancel"

    client = stripe_client()
    req = CheckoutSessionRequest(
        amount=amount,
        currency=currency,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={"reservation_id": reservation_id, "user_id": uid, "kind": payload.kind},
    )
    session = await client.create_checkout_session(req)

    await db.payment_transactions.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "reservation_id": reservation_id,
        "kind": payload.kind,
        "session_id": session.session_id,
        "amount": amount,
        "currency": currency,
        "label": label,
        "payment_status": "initiated",
        "status": "open",
        "processed": False,
        "created_at": now_utc().isoformat(),
    })
    return {"url": session.url, "session_id": session.session_id}


async def _apply_stripe_payment(tx: dict):
    """Enregistre l'effet d'un paiement Stripe réussi sur la réservation (idempotent)."""
    if tx.get("processed"):
        return
    uid = tx["user_id"]
    rid = tx["reservation_id"]
    r = await db.reservations.find_one({"id": rid, "user_id": uid}, {"_id": 0})
    if not r:
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


@api_router.get("/checkout/status/{session_id}")
async def checkout_status(session_id: str, user=Depends(get_current_user)):
    tx = await db.payment_transactions.find_one({"session_id": session_id, "user_id": user["user_id"]}, {"_id": 0})
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction inconnue")
    client = stripe_client()
    st = await client.get_checkout_status(session_id)
    await db.payment_transactions.update_one(
        {"session_id": session_id}, {"$set": {"payment_status": st.payment_status, "status": st.status}})
    if st.payment_status == "paid" and not tx.get("processed"):
        await _apply_stripe_payment(tx)
    return {
        "kind": tx["kind"],
        "amount": tx["amount"],
        "status": st.status,
        "payment_status": st.payment_status,
    }


@api_router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()
    sig = request.headers.get("Stripe-Signature")
    client = stripe_client()
    try:
        event = await client.handle_webhook(body, sig)
    except Exception:
        raise HTTPException(status_code=400, detail="Webhook invalide")
    sid = getattr(event, "session_id", None)
    if event.payment_status == "paid" and sid:
        tx = await db.payment_transactions.find_one({"session_id": sid}, {"_id": 0})
        if tx and not tx.get("processed"):
            await _apply_stripe_payment(tx)
    return {"received": True}


# ---------------------------------------------------------------------------
# Interventions (ménage / interventions techniques) shown in calendar + dashboard
# ---------------------------------------------------------------------------
@api_router.get("/interventions")
async def list_interventions(property_id: Optional[str] = None, user=Depends(get_current_user)):
    query = {"user_id": user["user_id"], **_prop_scope(user, "property_id")}
    if property_id:
        query["property_id"] = property_id
    # Purge past ménages (cleaning tasks before today) and exclude them from results
    today_iso = date.today().isoformat()
    await db.interventions.delete_many(
        {"user_id": user["user_id"], "kind": "menage", "date": {"$lt": today_iso}})
    items = await db.interventions.find(query, {"_id": 0}).sort("date", 1).to_list(1000)
    return items


@api_router.post("/interventions")
async def create_intervention(payload: InterventionIn, user=Depends(get_current_user)):
    doc = payload.dict()
    if doc.get("intervenants"):
        doc["intervenant"] = ", ".join([x for x in doc["intervenants"] if x])
    elif doc.get("intervenant"):
        doc["intervenants"] = [doc["intervenant"]]
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    await db.interventions.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/interventions/{intervention_id}")
async def update_intervention(intervention_id: str, payload: InterventionIn, user=Depends(get_current_user)):
    data = payload.dict()
    if data.get("intervenants"):
        data["intervenant"] = ", ".join([x for x in data["intervenants"] if x])
    elif data.get("intervenant"):
        data["intervenants"] = [data["intervenant"]]
    res = await db.interventions.update_one(
        {"id": intervention_id, "user_id": user["user_id"]},
        {"$set": data},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Intervention not found")
    item = await db.interventions.find_one({"id": intervention_id}, {"_id": 0})
    return item


@api_router.delete("/interventions/{intervention_id}")
async def delete_intervention(intervention_id: str, user=Depends(get_current_user)):
    await db.interventions.delete_one({"id": intervention_id, "user_id": user["user_id"]})
    return {"ok": True}


# ---------------------------------------------------------------------------
# iCal synchronization (import reservations from Airbnb/Booking .ics feeds)
# ---------------------------------------------------------------------------
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


@api_router.post("/properties/{property_id}/sync")
async def sync_ical(property_id: str, user=Depends(get_current_user)):
    res = await run_ical_sync(user["user_id"], property_id)
    if res is None:
        raise HTTPException(status_code=404, detail="Property not found")
    return res


class IcalFrequencyIn(BaseModel):
    frequency: str = "daily"  # hourly | 6h | daily


_FREQ_SECONDS = {"hourly": 3300, "6h": 21300, "daily": 23 * 3600}


@api_router.put("/properties/{property_id}/ical-frequency")
async def set_ical_frequency(property_id: str, payload: IcalFrequencyIn, user=Depends(get_current_user)):
    freq = payload.frequency if payload.frequency in _FREQ_SECONDS else "daily"
    res = await db.properties.update_one(
        {"id": property_id, "user_id": user["user_id"], **_prop_scope(user)},
        {"$set": {"ical_sync_frequency": freq}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Property not found")
    return {"frequency": freq}


async def _ical_auto_sync_loop():
    """Boucle de synchro iCal automatique : fréquence configurable par logement."""
    await asyncio.sleep(60)  # laisser l'app démarrer
    while True:
        try:
            props = await db.properties.find(
                {"ical_links.0": {"$exists": True}},
                {"_id": 0, "id": 1, "user_id": 1, "ical_last_sync": 1, "ical_sync_frequency": 1}).to_list(2000)
            for p in props:
                freq = p.get("ical_sync_frequency") or "daily"
                threshold = _FREQ_SECONDS.get(freq, _FREQ_SECONDS["daily"])
                last = p.get("ical_last_sync")
                stale = True
                if last:
                    try:
                        stale = (now_utc() - datetime.fromisoformat(last)).total_seconds() > threshold
                    except Exception:
                        stale = True
                if stale:
                    try:
                        await run_ical_sync(p["user_id"], p["id"])
                    except Exception:
                        logger.exception("auto ical sync failed for %s", p.get("id"))
                    await asyncio.sleep(2)  # espacer les appels externes
        except Exception:
            logger.exception("auto ical loop error")
        await asyncio.sleep(3600)  # revérifier chaque heure



class IcalLinksIn(BaseModel):
    links: List[IcalLink] = []


@api_router.put("/properties/{property_id}/ical-links")
async def set_ical_links(property_id: str, payload: IcalLinksIn, user=Depends(get_current_user)):
    """Remplace la liste des liens iCal importés pour un logement."""
    links = [{"platform": (l.platform or "Autre").strip(), "url": (l.url or "").strip()}
             for l in payload.links if (l.url or "").strip()]
    res = await db.properties.update_one(
        {"id": property_id, "user_id": user["user_id"], **_prop_scope(user)},
        {"$set": {"ical_links": links}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Property not found")
    return {"ical_links": links}


@api_router.get("/properties/{property_id}/ical-export")
async def get_ical_export(property_id: str, user=Depends(get_current_user)):
    """Renvoie le token/chemin du flux .ics public à partager avec les plateformes."""
    prop = await db.properties.find_one(
        {"id": property_id, "user_id": user["user_id"], **_prop_scope(user)}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    token = prop.get("ical_export_token")
    if not token:
        token = uuid.uuid4().hex
        await db.properties.update_one(
            {"id": property_id, "user_id": user["user_id"]},
            {"$set": {"ical_export_token": token}})
    return {"token": token, "path": f"/api/ical/{property_id}/{token}.ics"}


@api_router.get("/ical/{property_id}/{token}.ics")
async def public_ical_feed(property_id: str, token: str):
    """Flux .ics public (sans auth) pour synchroniser la disponibilité vers Airbnb/Booking."""
    prop = await db.properties.find_one(
        {"id": property_id, "ical_export_token": token}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Flux introuvable")
    reservations = await db.reservations.find(
        {"property_id": property_id, "status": {"$ne": "annulee"}},
        {"_id": 0, "id": 1, "check_in": 1, "check_out": 1, "ical_uid": 1}).to_list(5000)
    body = _build_ics(prop, reservations)
    from fastapi.responses import Response
    return Response(content=body, media_type="text/calendar; charset=utf-8")



# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
@api_router.get("/dashboard")
async def dashboard(user=Depends(get_current_user)):
    uid = user["user_id"]
    today = date.today()
    today_str = today.isoformat()
    year, month = today.year, today.month
    days_in_month = pycalendar.monthrange(year, month)[1]
    month_start = date(year, month, 1)
    month_end = date(year, month, days_in_month)

    props = await db.properties.find({"user_id": uid, **_prop_scope(user)}, {"_id": 0}).to_list(500)
    reservations = await db.reservations.find(
        {"user_id": uid, **_prop_scope(user, "property_id")}, {"_id": 0}).to_list(2000)
    await db.interventions.delete_many(
        {"user_id": uid, "kind": "menage", "date": {"$lt": today_str}})
    interventions = await db.interventions.find(
        {"user_id": uid, **_prop_scope(user, "property_id")}, {"_id": 0}).sort("date", 1).to_list(1000)

    prop_map = {p["id"]: p for p in props}
    cmap = await status_color_map(uid)

    def parse(d):
        try:
            return date.fromisoformat(d)
        except Exception:
            return None

    arrivals_today = []
    departures_today = []
    current_stays = []
    revenue_month = 0.0
    booked_nights = 0

    for r in reservations:
        if r["status"] == "annulee":
            continue
        ci = parse(r.get("check_in"))
        co = parse(r.get("check_out"))
        pname = prop_map.get(r["property_id"], {}).get("name", "Logement")
        r_view = compute_display({**r, "property_name": pname}, cmap)
        if r.get("check_in") == today_str:
            arrivals_today.append(r_view)
        if r.get("check_out") == today_str:
            departures_today.append(r_view)
        # current stay: today is within [check_in, check_out) (checkout day excluded)
        if ci and co and ci <= today < co:
            current_stays.append(r_view)
        # revenue + occupancy for current month
        if ci and co and r["status"] in ("confirmee", "arrivee", "depart"):
            overlap_start = max(ci, month_start)
            overlap_end = min(co, month_end + timedelta(days=1))
            nights = (overlap_end - overlap_start).days
            if nights > 0:
                booked_nights += nights
            # revenue counted if check-in within month
            if month_start <= ci <= month_end:
                revenue_month += float(r.get("total_price", 0) or 0)

    current_stays.sort(key=lambda x: x.get("check_out") or "")

    capacity_nights = max(len(props) * days_in_month, 1)
    occupancy = round(min(booked_nights / capacity_nights * 100, 100))

    upcoming = 0
    for r in reservations:
        ci = parse(r.get("check_in"))
        if ci and ci >= today and r["status"] in ("demande", "confirmee"):
            upcoming += 1

    # Upcoming interventions (today and future), enriched with property name
    upcoming_interventions = []
    for iv in interventions:
        if iv.get("done"):
            continue
        d = parse(iv.get("date"))
        if d and d >= today:
            upcoming_interventions.append({
                **iv,
                "property_name": prop_map.get(iv["property_id"], {}).get("name", "Logement"),
            })
    upcoming_interventions.sort(key=lambda x: x.get("date") or "")

    return {
        "occupancy_rate": occupancy,
        "revenue_month": round(revenue_month) if _can(user, "view_revenue_charts") else None,
        "total_properties": len(props),
        "upcoming_count": upcoming,
        "current_stays": current_stays,
        "arrivals_today": arrivals_today,
        "departures_today": departures_today,
        "interventions": upcoming_interventions,
    }


@api_router.get("/cleaning-schedule")
async def cleaning_schedule(day: Optional[str] = None, user=Depends(get_current_user)):
    """Vue quotidienne : départs, ménages, interventions, remises de clés,
    cautions à encaisser et arrivées (vérification caution le jour de l'arrivée)."""
    uid = user["user_id"]
    try:
        target = date.fromisoformat(day) if day else date.today()
    except ValueError:
        target = date.today()
    tstr = target.isoformat()
    scope = _prop_scope(user, "property_id")
    props = await db.properties.find(
        {"user_id": uid, **_prop_scope(user)}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
    pmap = {p["id"]: p.get("name", "Logement") for p in props}

    deps = await db.reservations.find(
        {"user_id": uid, "check_out": tstr, "status": {"$ne": "annulee"}, **scope}, {"_id": 0}).to_list(500)
    departures = [{
        "id": r["id"], "property_id": r["property_id"],
        "property_name": pmap.get(r["property_id"], "Logement"),
        "guest_name": r.get("guest_name"), "checkout_time": r.get("checkout_time") or "",
        "platform": r.get("platform") or "",
    } for r in deps if r["property_id"] in pmap]

    arr = await db.reservations.find(
        {"user_id": uid, "check_in": tstr, "status": {"$ne": "annulee"}, **scope}, {"_id": 0}).to_list(500)
    arrivals = [{
        "id": r["id"], "property_id": r["property_id"],
        "property_name": pmap.get(r["property_id"], "Logement"),
        "guest_name": r.get("guest_name"), "checkin_time": r.get("checkin_time") or "",
        "platform": r.get("platform") or "",
        "deposit_collected": bool((r.get("finance") or {}).get("deposit_collected")),
        "deposit_amount": (r.get("finance") or {}).get("deposit_amount") or 0,
        "damage_deposit": r.get("damage_deposit") or "",
    } for r in arr if r["property_id"] in pmap]

    # Toutes les interventions du jour, regroupées par type
    ivs = await db.interventions.find(
        {"user_id": uid, "date": tstr, **scope}, {"_id": 0}).to_list(1000)

    def _iv(iv):
        return {
            "id": iv["id"], "property_id": iv["property_id"],
            "property_name": pmap.get(iv["property_id"], "Logement"),
            "description": iv.get("description", ""), "intervenant": iv.get("intervenant", ""),
            "done": bool(iv.get("done")),
            "caution_amount": iv.get("caution_amount") or 0,
            "caution_debited": bool(iv.get("caution_debited")),
        }

    cleanings, interventions, key_handovers, cautions = [], [], [], []
    for iv in ivs:
        if iv["property_id"] not in pmap:
            continue
        kind = iv.get("kind", "menage")
        item = _iv(iv)
        if kind == "menage":
            cleanings.append(item)
        elif kind == "remise_cles":
            key_handovers.append(item)
        elif kind == "caution":
            cautions.append(item)
        else:
            interventions.append(item)

    departures.sort(key=lambda x: (x["checkout_time"] or "~", x["property_name"]))
    arrivals.sort(key=lambda x: (x["checkin_time"] or "~", x["property_name"]))
    for lst in (cleanings, interventions, key_handovers, cautions):
        lst.sort(key=lambda x: x["property_name"])

    return {
        "date": tstr,
        "departures": departures,
        "arrivals": arrivals,
        "cleanings": cleanings,
        "interventions": interventions,
        "key_handovers": key_handovers,
        "cautions": cautions,
    }



class DoneIn(BaseModel):
    done: bool = True


@api_router.patch("/interventions/{intervention_id}/done")
async def set_intervention_done(intervention_id: str, payload: DoneIn, user=Depends(get_current_user)):
    """Marquer une tâche (ménage, intervention, remise de clés) comme faite.
    Autorisé au personnel de terrain. La caution N'EST PAS gérée ici."""
    iv = await db.interventions.find_one(
        {"id": intervention_id, "user_id": user["user_id"]}, {"_id": 0})
    if not iv or (user.get("allowed_property_ids") is not None
                  and iv.get("property_id") not in user["allowed_property_ids"]):
        raise HTTPException(status_code=404, detail="Intervention introuvable")
    if iv.get("kind") == "caution":
        raise HTTPException(status_code=403, detail="La caution ne peut pas être modifiée ici")
    await db.interventions.update_one(
        {"id": intervention_id, "user_id": user["user_id"]},
        {"$set": {"done": payload.done}})
    return {"id": intervention_id, "done": payload.done}


class CautionActionIn(BaseModel):
    debited: bool
    done: bool = True


@api_router.patch("/interventions/{intervention_id}/caution")
async def set_caution_state(intervention_id: str, payload: CautionActionIn, user=Depends(get_current_user)):
    """Marquer une caution comme encaissée (debited=true) ou rendue (debited=false)."""
    iv = await db.interventions.find_one(
        {"id": intervention_id, "user_id": user["user_id"]}, {"_id": 0})
    if not iv or (user.get("allowed_property_ids") is not None
                  and iv.get("property_id") not in user["allowed_property_ids"]):
        raise HTTPException(status_code=404, detail="Intervention introuvable")
    await db.interventions.update_one(
        {"id": intervention_id, "user_id": user["user_id"]},
        {"$set": {"caution_debited": payload.debited, "done": payload.done}})
    return {"id": intervention_id, "caution_debited": payload.debited, "done": payload.done}


@api_router.get("/analytics/revenue")
async def analytics_revenue(year: Optional[int] = None, user=Depends(get_current_user)):
    if not _can(user, "view_revenue_charts"):
        raise HTTPException(status_code=403, detail="Accès aux revenus non autorisé")
    uid = user["user_id"]
    y = year or date.today().year
    props = await db.properties.find({"user_id": uid, **_prop_scope(user)}, {"_id": 0}).to_list(500)
    reservations = await db.reservations.find(
        {"user_id": uid, "status": {"$ne": "annulee"}, **_prop_scope(user, "property_id")}, {"_id": 0}).to_list(5000)

    def parse(d):
        try:
            return date.fromisoformat(d)
        except Exception:
            return None

    # Structure: per property → 12 mois {revenue, nights}
    per_prop = {p["id"]: {"revenue": [0.0] * 12, "nights": [0] * 12} for p in props}
    for r in reservations:
        pid = r.get("property_id")
        if pid not in per_prop:
            continue
        ci, co = parse(r.get("check_in")), parse(r.get("check_out"))
        if not ci or not co or co <= ci:
            continue
        total_nights = (co - ci).days
        fin = r.get("finance") or {}
        price = float(fin.get("total") or r.get("total_price") or 0)
        # Répartir les nuits (et le revenu au prorata) sur chaque mois de l'année demandée
        cur = ci
        while cur < co:
            if cur.year == y:
                m = cur.month - 1
                per_prop[pid]["nights"][m] += 1
                if total_nights > 0:
                    per_prop[pid]["revenue"][m] += price / total_nights
            cur = cur + timedelta(days=1)

    out_props = []
    totals_rev = [0.0] * 12
    totals_nights = [0] * 12
    days_per_month = [pycalendar.monthrange(y, m)[1] for m in range(1, 13)]
    for p in props:
        d = per_prop[p["id"]]
        monthly = []
        for m in range(12):
            rev = round(d["revenue"][m])
            nights = d["nights"][m]
            occ = round(min(nights / days_per_month[m] * 100, 100)) if days_per_month[m] else 0
            monthly.append({"month": m + 1, "revenue": rev, "nights": nights, "occupancy": occ})
            totals_rev[m] += d["revenue"][m]
            totals_nights[m] += nights
        total_rev = round(sum(d["revenue"]))
        total_nights_p = sum(d["nights"])
        avg_occ = round(min(total_nights_p / sum(days_per_month) * 100, 100)) if props else 0
        out_props.append({
            "id": p["id"], "name": p.get("name", "Logement"),
            "monthly": monthly, "total_revenue": total_rev, "avg_occupancy": avg_occ,
        })

    n_props = max(len(props), 1)
    totals_monthly = []
    for m in range(12):
        occ = round(min(totals_nights[m] / (days_per_month[m] * n_props) * 100, 100)) if days_per_month[m] else 0
        totals_monthly.append({"month": m + 1, "revenue": round(totals_rev[m]), "nights": totals_nights[m], "occupancy": occ})
    total_rev_all = round(sum(totals_rev))
    avg_occ_all = round(min(sum(totals_nights) / (sum(days_per_month) * n_props) * 100, 100))

    return {
        "year": y,
        "properties": out_props,
        "totals": {
            "monthly": totals_monthly,
            "total_revenue": total_rev_all,
            "avg_occupancy": avg_occ_all,
        },
    }


@api_router.get("/analytics/kpi")
async def analytics_kpi(month: str = "", start: str = "", end: str = "",
                        user=Depends(get_current_user)):
    """Synthèse conciergerie sur une période (mois OU plage) : revenus conciergerie
    vs propriétaires, frais de gestion, commissions, taux d'occupation global,
    top logements. Réutilise les règles comptables du relevé propriétaire."""
    if not _can(user, "view_revenue_charts"):
        raise HTTPException(status_code=403, detail="Accès aux revenus non autorisé")
    uid = user["user_id"]
    if not (month or (start and end)):
        month = date.today().strftime("%Y-%m")
    start_d, end_excl, period_key, period_label = _resolve_period(month, start, end)
    sd = date.fromisoformat(start_d)
    ed = date.fromisoformat(end_excl)  # exclusive
    period_days = max((ed - sd).days, 1)

    props = await db.properties.find(
        {"user_id": uid, **_prop_scope(user)}, {"_id": 0}).to_list(500)

    reservations = await db.reservations.find(
        {"user_id": uid, "property_id": {"$in": [p["id"] for p in props]},
         "check_in": {"$gte": start_d, "$lt": end_excl},
         "status": {"$nin": ["annulee", "bloque"]}}, {"_id": 0}).to_list(5000)

    by_prop = {p["id"]: [] for p in props}
    for r in reservations:
        pid = r.get("property_id")
        if pid in by_prop:
            by_prop[pid].append(r)

    # Nuits réservées sur la période (pour l'occupation) — tous statuts occupants
    occ_res = await db.reservations.find(
        {"user_id": uid, "property_id": {"$in": [p["id"] for p in props]},
         "status": {"$nin": ["annulee"]},
         "check_in": {"$lt": end_excl}, "check_out": {"$gt": start_d}}, {"_id": 0}).to_list(5000)
    nights_by_prop = {p["id"]: 0 for p in props}
    for r in occ_res:
        pid = r.get("property_id")
        if pid not in nights_by_prop:
            continue
        try:
            ci = max(date.fromisoformat(r.get("check_in")), sd)
            co = min(date.fromisoformat(r.get("check_out")), ed)
        except Exception:
            continue
        if co > ci:
            nights_by_prop[pid] += (co - ci).days

    tot = {"nights": 0.0, "cleaning": 0.0, "tax": 0.0, "commission": 0.0,
           "management_fee": 0.0, "owner_revenue": 0.0, "concierge_revenue": 0.0,
           "reservations": 0, "booked_nights": 0}
    per_property = []
    for p in props:
        pid = p["id"]
        rs = by_prop.get(pid, [])
        t_nights = t_clean = t_tax = t_comm = 0.0
        for r in rs:
            a = _res_amounts(r)
            t_nights += a["nights"]; t_clean += a["cleaning"]
            t_tax += a["tax"]; t_comm += a["commission"]
        # dépenses & override commission (mois uniquement — cohérent avec le relevé)
        expenses = await db.statement_expenses.find(
            {"user_id": uid, "property_id": pid, "month": period_key}, {"_id": 0}).to_list(500)
        owner_exp = round(sum(float(e.get("amount") or 0) for e in expenses if e.get("charge_to") == "owner"), 2)
        concierge_exp = round(sum(float(e.get("amount") or 0) for e in expenses if e.get("charge_to") == "concierge"), 2)
        ov = await db.statement_overrides.find_one(
            {"user_id": uid, "property_id": pid, "month": period_key}, {"_id": 0})
        eff_comm = round(float(ov.get("commission") or 0), 2) if (ov and ov.get("commission") is not None) else round(t_comm, 2)
        pct = float(p.get("management_fee_pct") or 0)
        mgmt_fee = round(t_nights * pct / 100.0, 2)
        owner_rev = round(t_nights - mgmt_fee - eff_comm - owner_exp, 2)
        concierge_rev = round(mgmt_fee + t_clean - concierge_exp, 2)
        booked = nights_by_prop.get(pid, 0)
        occ = round(min(booked / period_days * 100, 100)) if period_days else 0

        tot["nights"] += t_nights; tot["cleaning"] += t_clean
        tot["tax"] += t_tax; tot["commission"] += eff_comm
        tot["management_fee"] += mgmt_fee
        tot["owner_revenue"] += owner_rev
        tot["concierge_revenue"] += concierge_rev
        tot["reservations"] += len(rs)
        tot["booked_nights"] += booked

        per_property.append({
            "id": pid, "name": p.get("name", "Logement"),
            "nights_revenue": round(t_nights, 2), "cleaning": round(t_clean, 2),
            "commission": eff_comm, "management_fee": mgmt_fee,
            "owner_revenue": owner_rev, "concierge_revenue": concierge_rev,
            "reservations": len(rs), "booked_nights": booked, "occupancy": occ,
        })

    n_props = max(len(props), 1)
    occ_all = round(min(tot["booked_nights"] / (period_days * n_props) * 100, 100)) if period_days else 0
    top_by_revenue = sorted(per_property, key=lambda x: -x["concierge_revenue"])[:5]
    top_by_occupancy = sorted(per_property, key=lambda x: -x["occupancy"])[:5]

    return {
        "period_key": period_key, "period_label": period_label,
        "period_days": period_days, "properties_count": len(props),
        "totals": {k: (round(v, 2) if isinstance(v, float) else v) for k, v in tot.items()},
        "occupancy_all": occ_all,
        "per_property": per_property,
        "top_by_revenue": top_by_revenue,
        "top_by_occupancy": top_by_occupancy,
    }


# ---------------------------------------------------------------------------
# Tarification dynamique (suggestions par logement) — occupation + comparables
# ---------------------------------------------------------------------------
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


@api_router.get("/properties/{property_id}/dynamic-pricing")
async def dynamic_pricing(property_id: str, start: str = "", end: str = "", user=Depends(get_current_user)):
    """Suggestions de prix/nuit (à valider) basées sur : prix des logements comparables
    du même secteur (même ville, capacité proche), taux d'occupation du logement, et
    règles (anticipation longue, haute saison, week-end). Retour par jour."""
    uid = user["user_id"]
    prop = await db.properties.find_one(
        {"id": property_id, "user_id": uid, **_prop_scope(user)}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    cfg = {**DEFAULT_DYNAMIC_PRICING, **((prop.get("dynamic_pricing") or {}))}

    try:
        sd = date.fromisoformat(start) if start else date.today().replace(day=1)
        ed = date.fromisoformat(end) if end else (sd + timedelta(days=31))
    except Exception:
        raise HTTPException(status_code=400, detail="Dates invalides (YYYY-MM-DD)")
    if ed < sd:
        ed = sd + timedelta(days=31)
    ed = min(ed, sd + timedelta(days=95))  # borne de sécurité

    # Comparables : même ville (sinon tout le portefeuille), capacité ±2, hors soi-même
    city = (prop.get("city") or prop.get("location") or "").strip().lower()
    cap = int(prop.get("capacity") or 0)
    all_props = await db.properties.find({"user_id": uid}, {"_id": 0}).to_list(500)
    comps = []
    for p in all_props:
        if p["id"] == property_id:
            continue
        pcity = (p.get("city") or p.get("location") or "").strip().lower()
        if city and pcity and city != pcity:
            continue
        if cap and p.get("capacity") and abs(int(p["capacity"]) - cap) > 2:
            continue
        comps.append(p)
    if not comps:  # repli : tout le portefeuille (hors soi)
        comps = [p for p in all_props if p["id"] != property_id]

    # Occupation prospective du logement (30 prochains jours à partir de sd)
    win_end = sd + timedelta(days=30)
    occ_res = await db.reservations.find(
        {"user_id": uid, "property_id": property_id, "status": {"$nin": ["annulee"]},
         "check_in": {"$lt": win_end.isoformat()}, "check_out": {"$gt": sd.isoformat()}}, {"_id": 0}).to_list(500)
    booked = 0
    for r in occ_res:
        try:
            ci = max(date.fromisoformat(r["check_in"]), sd)
            co = min(date.fromisoformat(r["check_out"]), win_end)
            if co > ci:
                booked += (co - ci).days
        except Exception:
            pass
    occ_rate = round(min(booked / 30 * 100, 100))

    mw = max(0.0, min(1.0, float(cfg["market_weight"]) / 100.0))
    today = date.today()
    days = []
    cur = sd
    while cur < ed:
        dstr = cur.isoformat()
        base = _price_for_day(prop, dstr)
        comp_prices = [_price_for_day(c, dstr) for c in comps if _price_for_day(c, dstr) > 0]
        market = round(sum(comp_prices) / len(comp_prices), 2) if comp_prices else base
        ref = base * (1 - mw) + market * mw
        factors = []
        adj = 0.0
        # Week-end
        if cur.weekday() in (4, 5):  # vendredi, samedi
            adj += float(cfg["weekend_pct"]); factors.append("week-end")
        # Haute saison
        if _is_high_season(prop, dstr):
            adj += float(cfg["high_season_pct"]); factors.append("haute saison")
        # Anticipation
        lead = (cur - today).days
        if lead >= int(cfg["lead_long_days"]):
            adj += float(cfg["lead_long_pct"]); factors.append("anticipation")
        elif 0 <= lead <= int(cfg["lead_last_days"]):
            adj += float(cfg["lead_last_pct"]); factors.append("dernière minute")
        # Occupation
        if occ_rate >= 70:
            adj += float(cfg["occ_high_pct"]); factors.append("forte occupation")
        elif occ_rate <= 30:
            adj += float(cfg["occ_low_pct"]); factors.append("faible occupation")
        suggested = ref * (1 + adj / 100.0)
        if float(cfg["min_price"]) > 0:
            suggested = max(suggested, float(cfg["min_price"]))
        if float(cfg["max_price"]) > 0:
            suggested = min(suggested, float(cfg["max_price"]))
        suggested = round(suggested)
        days.append({"date": dstr, "base": round(base), "market": round(market),
                     "suggested": suggested, "factors": factors,
                     "delta": suggested - round(base)})
        cur += timedelta(days=1)

    return {
        "property_id": property_id, "config": cfg, "occupancy_rate": occ_rate,
        "comps_count": len(comps), "market_city": prop.get("city") or prop.get("location") or "",
        "days": days,
    }





# ---------------------------------------------------------------------------
# AI assistant
# ---------------------------------------------------------------------------
def make_chat(system_message: str, session_id: str) -> LlmChat:
    return LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=system_message,
    ).with_model("anthropic", "claude-sonnet-4-6")


@api_router.post("/ai/guest-reply")
async def ai_guest_reply(payload: GuestReplyRequest, user=Depends(get_current_user)):
    context = ""
    if payload.property_id:
        prop = await db.properties.find_one({"id": payload.property_id, "user_id": user["user_id"]}, {"_id": 0})
        if prop:
            context = f"Logement: {prop.get('name')} à {prop.get('location')}, {prop.get('bedrooms')} chambres, capacité {prop.get('capacity')} personnes."
    system = (
        "Tu es l'assistant d'un hôte de location saisonnière. "
        "Tu rédiges des réponses courtes, professionnelles et chaleureuses aux voyageurs, en français. "
        "Réponds uniquement avec le message prêt à envoyer, sans préambule."
    )
    chat = make_chat(system, f"reply_{user['user_id']}")
    prompt = f"Ton souhaité: {payload.tone}. {context}\nMessage du voyageur: \"{payload.guest_message}\"\nRédige une réponse."
    reply = await chat.send_message(UserMessage(text=prompt))
    return {"reply": reply}


@api_router.post("/ai/pricing-suggestion")
async def ai_pricing(payload: PricingRequest, user=Depends(get_current_user)):
    prop = await db.properties.find_one({"id": payload.property_id, "user_id": user["user_id"]}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    system = (
        "Tu es un expert en tarification (revenue management) de locations saisonnières. "
        "Tu réponds STRICTEMENT en JSON valide (aucun texte hors JSON), au format : "
        '{"advice": "conseils en français, 3-4 puces max", '
        '"seasons": [{"name": "Basse saison", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "price": nombre}, '
        '{"name": "Moyenne saison", ...}, {"name": "Haute saison", ...}]}. '
        "Propose exactement 3 saisons cohérentes (basse, moyenne, haute) couvrant la période demandée, "
        "avec des prix/nuit concrets et croissants."
    )
    chat = make_chat(system, f"pricing_{user['user_id']}")
    period = payload.period or "les prochaines semaines"
    seasons = prop.get("seasons") or []
    seasons_txt = ""
    if seasons:
        seasons_txt = "Saisons déjà configurées: " + "; ".join(
            f"{s.get('name')} ({s.get('start_date')}→{s.get('end_date')}): {s.get('price')}€/nuit" for s in seasons
        ) + ".\n"
    prompt = (
        f"Logement: {prop.get('name')} à {prop.get('location')}, {prop.get('bedrooms')} chambres, "
        f"capacité {prop.get('capacity')}. Prix de base actuel: {prop.get('base_price')}€/nuit.\n"
        f"{seasons_txt}"
        f"Donne une recommandation de tarification pour {period} (année {date.today().year} ou suivante)."
    )
    raw = await chat.send_message(UserMessage(text=prompt))
    advice, seasons_out = _parse_pricing_json(raw)
    return {"suggestion": advice, "seasons": seasons_out,
            "season": seasons_out[0] if seasons_out else None}


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


# ---------------------------------------------------------------------------
# Preferences (customizable statuses + colors)
# ---------------------------------------------------------------------------
DEFAULT_COMPANY = {
    "name": "", "address": "", "postal_code": "", "city": "",
    "phone": "", "email": "", "website": "", "siret": "", "vat": "",
    "logo_path": "",
}
_COMPANY_KEYS = list(DEFAULT_COMPANY.keys())


def _build_company(doc: Optional[dict]) -> dict:
    c = (doc or {}).get("company") or {}
    return {k: str(c.get(k) or "") for k in _COMPANY_KEYS}


# Enregistrement en ligne (online check-in form) --------------------------------
# guests_count est toujours obligatoire (non désactivable).
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


async def _ai_auto_draft_enabled(uid: str) -> bool:
    doc = await db.preferences.find_one({"user_id": uid}, {"_id": 0})
    return bool((doc or {}).get("ai_auto_draft", True))


@api_router.get("/preferences")
async def get_preferences(user=Depends(get_current_user)):
    doc = await db.preferences.find_one({"user_id": user["user_id"]}, {"_id": 0})
    statuses = _build_statuses(doc)
    return {
        "statuses": statuses,
        "status_colors": {s["key"]: s["color"] for s in statuses},
        "commission_rates": _build_commission_rates(doc),
        "payment_methods": _build_payment_methods(doc),
        "ai_auto_draft": bool((doc or {}).get("ai_auto_draft", True)),
        "company": _build_company(doc),
        "online_checkin": _build_checkin(doc),
        "monthly_report_enabled": bool((doc or {}).get("monthly_report_enabled", True)),
        "review_request_enabled": bool((doc or {}).get("review_request_enabled", False)),
        "review_request_days": int((doc or {}).get("review_request_days", 1)),
    }


@api_router.put("/preferences")
async def update_preferences(payload: PreferencesIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    set_doc = {"user_id": uid}

    if payload.statuses is not None or payload.status_colors is not None:
        if payload.statuses is not None:
            cleaned = []
            seen = set()
            for s in payload.statuses:
                key = str(s.get("key") or "").strip()
                label = str(s.get("label") or "").strip()
                color = str(s.get("color") or "#8E8E93").strip()
                if not key or key in seen:
                    continue
                seen.add(key)
                cleaned.append({"key": key, "label": label or key, "color": color})
            # Always keep the core statuses so existing reservations stay valid
            for d in DEFAULT_STATUSES:
                if d["key"] not in seen:
                    cleaned.append(d)
                    seen.add(d["key"])
            statuses = cleaned
        else:
            colors = {**DEFAULT_STATUS_COLORS, **(payload.status_colors or {})}
            statuses = [{**s, "color": colors.get(s["key"], s["color"])} for s in DEFAULT_STATUSES]
        set_doc["statuses"] = statuses
        set_doc["status_colors"] = {s["key"]: s["color"] for s in statuses}

    if payload.commission_rates is not None:
        rates = {}
        for k, v in payload.commission_rates.items():
            try:
                rates[str(k)] = max(0.0, min(100.0, float(v)))
            except Exception:
                continue
        set_doc["commission_rates"] = {**DEFAULT_COMMISSION_RATES, **rates}

    if payload.payment_methods is not None:
        pm = {}
        for k in DEFAULT_PAYMENT_METHODS:
            if k in payload.payment_methods:
                pm[k] = bool(payload.payment_methods[k])
        set_doc["payment_methods"] = {**DEFAULT_PAYMENT_METHODS, **pm}

    if payload.ai_auto_draft is not None:
        set_doc["ai_auto_draft"] = bool(payload.ai_auto_draft)

    if payload.company is not None:
        set_doc["company"] = {k: str(payload.company.get(k) or "").strip() for k in _COMPANY_KEYS}

    if payload.online_checkin is not None:
        c = payload.online_checkin or {}
        pre_in = c.get("predefined") or {}
        predefined = {k: bool(pre_in.get(k, DEFAULT_CHECKIN["predefined"][k])) for k in CHECKIN_PREDEFINED_KEYS}
        predefined["guests_count"] = True  # toujours obligatoire
        custom = []
        for q in (c.get("custom_questions") or [])[:5]:
            label = str((q or {}).get("label") or "").strip()
            if label:
                custom.append({"id": str((q or {}).get("id") or uuid.uuid4().hex[:8]), "label": label})
        set_doc["online_checkin"] = {
            "enabled": bool(c.get("enabled", False)),
            "require_before_arrival": bool(c.get("require_before_arrival", False)),
            "auto_reminders": bool(c.get("auto_reminders", True)),
            "predefined": predefined,
            "custom_questions": custom,
        }

    if payload.monthly_report_enabled is not None:
        set_doc["monthly_report_enabled"] = bool(payload.monthly_report_enabled)
    if payload.review_request_enabled is not None:
        set_doc["review_request_enabled"] = bool(payload.review_request_enabled)
    if payload.review_request_days is not None:
        set_doc["review_request_days"] = max(0, min(30, int(payload.review_request_days)))

    await db.preferences.update_one({"user_id": uid}, {"$set": set_doc}, upsert=True)
    doc = await db.preferences.find_one({"user_id": uid}, {"_id": 0})
    statuses = _build_statuses(doc)
    return {
        "statuses": statuses,
        "status_colors": {s["key"]: s["color"] for s in statuses},
        "commission_rates": _build_commission_rates(doc),
        "payment_methods": _build_payment_methods(doc),
        "ai_auto_draft": bool((doc or {}).get("ai_auto_draft", True)),
        "company": _build_company(doc),
        "online_checkin": _build_checkin(doc),
        "monthly_report_enabled": bool((doc or {}).get("monthly_report_enabled", True)),
        "review_request_enabled": bool((doc or {}).get("review_request_enabled", False)),
        "review_request_days": int((doc or {}).get("review_request_days", 1)),
    }


# ---------------------------------------------------------------------------
# Channel Manager — Lodgify integration (provider-neutral, swappable to Channex)
# ---------------------------------------------------------------------------
async def get_channel_adapter(user_id: str):
    doc = await db.channel_settings.find_one({"user_id": user_id}, {"_id": 0})
    if not doc or not doc.get("api_key"):
        return None, None
    return LodgifyAdapter(doc["api_key"]), doc


# ---------------------------------------------------------------------------
# Channex integration (foundation) — provider-neutral, alongside Lodgify.
# Read-only for now: connect/validate, status, list Channex properties/catalog.
# Does NOT touch Lodgify. Key stored in `channex_settings` (never returned).
# ---------------------------------------------------------------------------
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


class ChannexConnectIn(BaseModel):
    api_key: str
    environment: str = "staging"  # staging | production


@api_router.post("/channex/connect")
async def channex_connect(payload: ChannexConnectIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    key = (payload.api_key or "").strip()
    env = (payload.environment or "staging").lower()
    if env not in ("staging", "production"):
        env = "staging"
    if not key:
        raise HTTPException(status_code=400, detail="Clé API Channex requise")
    adapter = ChannexAdapter(key, env)
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            count = await adapter.validate(http)
    except HTTPException as e:
        await _sync_log(uid, "connect", "error", str(e.detail))
        raise
    await db.channex_settings.update_one(
        {"user_id": uid},
        {"$set": {
            "user_id": uid, "provider": "channex", "api_key": key,
            "environment": env, "properties_count": count,
            "connected_at": now_utc().isoformat(),
        }},
        upsert=True,
    )
    await _sync_log(uid, "connect", "success", f"{count} logement(s) — {env}")
    return {"ok": True, "environment": env, "properties_count": count}


@api_router.get("/channex/status")
async def channex_status(user=Depends(get_current_user)):
    doc = await db.channex_settings.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not doc or not doc.get("api_key"):
        return {"connected": False}
    return {
        "connected": True,
        "environment": doc.get("environment", "staging"),
        "properties_count": doc.get("properties_count", 0),
        "connected_at": doc.get("connected_at"),
        "last_read_at": doc.get("last_read_at"),
    }


@api_router.post("/channex/disconnect")
async def channex_disconnect(user=Depends(get_current_user)):
    await db.channex_settings.delete_one({"user_id": user["user_id"]})
    await _sync_log(user["user_id"], "disconnect", "success")
    return {"ok": True}


@api_router.get("/channex/properties")
async def channex_properties(user=Depends(get_current_user)):
    uid = user["user_id"]
    adapter, doc = await get_channex_adapter(uid)
    if not adapter:
        raise HTTPException(status_code=400, detail="Channex non connecté")
    try:
        async with httpx.AsyncClient(timeout=40) as http:
            raw = await adapter.list_properties(http)
    except HTTPException as e:
        await _sync_log(uid, "read_properties", "error", str(e.detail))
        raise
    props = [map_channex_property(p) for p in raw]
    await db.channex_settings.update_one(
        {"user_id": uid},
        {"$set": {"properties_count": len(props), "last_read_at": now_utc().isoformat()}})
    await _sync_log(uid, "read_properties", "success", f"{len(props)} logement(s)")
    return {"properties": props, "count": len(props)}


@api_router.get("/channex/properties/{channex_id}/catalog")
async def channex_catalog(channex_id: str, user=Depends(get_current_user)):
    uid = user["user_id"]
    adapter, doc = await get_channex_adapter(uid)
    if not adapter:
        raise HTTPException(status_code=400, detail="Channex non connecté")
    async with httpx.AsyncClient(timeout=40) as http:
        rooms = await adapter.list_room_types(http, channex_id)
        rates = await adapter.list_rate_plans(http, channex_id)
    await _sync_log(uid, "read_catalog", "success",
                    f"{len(rooms)} chambres, {len(rates)} tarifs")
    return {
        "channex_id": channex_id,
        "rooms": [map_channex_room(r) for r in rooms],
        "rate_plans": [map_channex_rate_plan(rp) for rp in rates],
    }


@api_router.get("/channex/sync-logs")
async def channex_sync_logs(user=Depends(get_current_user)):
    logs = await db.sync_logs.find(
        {"user_id": user["user_id"], "provider": "channex"}, {"_id": 0}
    ).sort("date", -1).to_list(50)
    return {"logs": logs}


# ---------------------------------------------------------------------------
# Politiques de réservation (Booking policies)
# ---------------------------------------------------------------------------
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


@api_router.get("/booking-policies")
async def list_booking_policies(user=Depends(get_current_user)):
    docs = await db.booking_policies.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"policies": docs}


@api_router.post("/booking-policies")
async def create_booking_policy(payload: BookingPolicyIn, user=Depends(get_current_user)):
    doc = _clean_policy(payload)
    doc.update({"id": str(uuid.uuid4()), "user_id": user["user_id"], "created_at": now_utc().isoformat()})
    await db.booking_policies.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/booking-policies/{policy_id}")
async def update_booking_policy(policy_id: str, payload: BookingPolicyIn, user=Depends(get_current_user)):
    existing = await db.booking_policies.find_one({"id": policy_id, "user_id": user["user_id"]}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Politique introuvable")
    doc = _clean_policy(payload)
    await db.booking_policies.update_one({"id": policy_id}, {"$set": doc})
    return {**existing, **doc}


@api_router.delete("/booking-policies/{policy_id}")
async def delete_booking_policy(policy_id: str, user=Depends(get_current_user)):
    res = await db.booking_policies.delete_one({"id": policy_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Politique introuvable")
    return {"ok": True}




# ---------------------------------------------------------------------------
# Push notifications (Emergent managed relay) — register device + send_push
# ---------------------------------------------------------------------------
PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")
_push_client = httpx.AsyncClient(base_url=PUSH_BASE_URL, headers={"X-Push-Key": PUSH_KEY}, timeout=10.0)


class RegisterPushBody(BaseModel):
    user_id: str
    platform: str
    device_token: str


@api_router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody):
    resp = await _push_client.post("/api/v1/push/users/register", json=body.model_dump())
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(502, "Push provider unavailable")
    resp.raise_for_status()
    return {"status": "registered"}


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


# ---------------------------------------------------------------------------
# Auto-block room availability from reservations
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Rooms / RatePlans / Availability (modèle aligné Channex, coexiste avec Lodgify)
# ---------------------------------------------------------------------------
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


@api_router.get("/properties/{property_id}/rooms")
async def list_rooms(property_id: str, user=Depends(get_current_user)):
    await _assert_property(user["user_id"], property_id)
    rooms = await db.rooms.find({"user_id": user["user_id"], "property_id": property_id}, {"_id": 0}).to_list(200)
    return {"rooms": rooms}


@api_router.post("/properties/{property_id}/rooms")
async def create_room(property_id: str, payload: RoomIn, user=Depends(get_current_user)):
    await _assert_property(user["user_id"], property_id)
    doc = payload.dict()
    doc.update({"id": str(uuid.uuid4()), "user_id": user["user_id"], "property_id": property_id,
                "created_at": now_utc().isoformat()})
    await db.rooms.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/rooms/{room_id}")
async def update_room(room_id: str, payload: RoomIn, user=Depends(get_current_user)):
    r = await db.rooms.find_one({"id": room_id, "user_id": user["user_id"]}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Chambre introuvable")
    await db.rooms.update_one({"id": room_id}, {"$set": payload.dict()})
    return {**r, **payload.dict()}


@api_router.delete("/rooms/{room_id}")
async def delete_room(room_id: str, user=Depends(get_current_user)):
    res = await db.rooms.delete_one({"id": room_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Chambre introuvable")
    await db.rate_plans.delete_many({"room_id": room_id, "user_id": user["user_id"]})
    await db.availability.delete_many({"room_id": room_id, "user_id": user["user_id"]})
    return {"ok": True}


@api_router.get("/properties/{property_id}/rate-plans")
async def list_rate_plans(property_id: str, user=Depends(get_current_user)):
    await _assert_property(user["user_id"], property_id)
    plans = await db.rate_plans.find({"user_id": user["user_id"], "property_id": property_id}, {"_id": 0}).to_list(200)
    return {"rate_plans": plans}


@api_router.post("/properties/{property_id}/rate-plans")
async def create_rate_plan(property_id: str, payload: RatePlanIn, user=Depends(get_current_user)):
    await _assert_property(user["user_id"], property_id)
    doc = payload.dict()
    doc.update({"id": str(uuid.uuid4()), "user_id": user["user_id"], "property_id": property_id,
                "created_at": now_utc().isoformat()})
    await db.rate_plans.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/rate-plans/{plan_id}")
async def update_rate_plan(plan_id: str, payload: RatePlanIn, user=Depends(get_current_user)):
    p = await db.rate_plans.find_one({"id": plan_id, "user_id": user["user_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Tarif introuvable")
    await db.rate_plans.update_one({"id": plan_id}, {"$set": payload.dict()})
    return {**p, **payload.dict()}


@api_router.delete("/rate-plans/{plan_id}")
async def delete_rate_plan(plan_id: str, user=Depends(get_current_user)):
    res = await db.rate_plans.delete_one({"id": plan_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Tarif introuvable")
    return {"ok": True}


class AvailabilitySetIn(BaseModel):
    date_from: str
    date_to: str            # inclus
    is_available: bool = True
    min_stay: Optional[int] = None
    closed: bool = False


@api_router.get("/rooms/{room_id}/availability")
async def get_availability(room_id: str, start: str, end: str, user=Depends(get_current_user)):
    docs = await db.availability.find(
        {"user_id": user["user_id"], "room_id": room_id,
         "date": {"$gte": start, "$lte": end}}, {"_id": 0}).sort("date", 1).to_list(1000)
    return {"availability": docs}


@api_router.post("/rooms/{room_id}/availability")
async def set_availability(room_id: str, payload: AvailabilitySetIn, user=Depends(get_current_user)):
    room = await db.rooms.find_one({"id": room_id, "user_id": user["user_id"]}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Chambre introuvable")
    try:
        d = datetime.fromisoformat(payload.date_from).date()
        end = datetime.fromisoformat(payload.date_to).date()
    except Exception:
        raise HTTPException(status_code=400, detail="Dates invalides (YYYY-MM-DD)")
    n = 0
    while d <= end and n < 800:
        ds = d.isoformat()
        await db.availability.update_one(
            {"user_id": user["user_id"], "room_id": room_id, "date": ds},
            {"$set": {"user_id": user["user_id"], "room_id": room_id, "date": ds,
                      "is_available": payload.is_available, "closed": payload.closed,
                      "min_stay": payload.min_stay}},
            upsert=True)
        d += timedelta(days=1); n += 1
    return {"ok": True, "days": n}


@api_router.get("/availability/blocked")
async def availability_blocked(start: str, end: str, user=Depends(get_current_user)):
    """Dates bloquées MANUELLEMENT (closed=true, hors blocages auto de réservations)
    agrégées par logement, pour l'affichage dans le Planning. Retourne {blocks: {property_id: [dates]}}."""
    uid = user["user_id"]
    rooms = await db.rooms.find({"user_id": uid}, {"_id": 0, "id": 1, "property_id": 1}).to_list(1000)
    if not rooms:
        return {"blocks": {}}
    room_to_prop = {r["id"]: r["property_id"] for r in rooms}
    docs = await db.availability.find(
        {"user_id": uid, "room_id": {"$in": list(room_to_prop.keys())},
         "date": {"$gte": start, "$lte": end}, "closed": True},
        {"_id": 0, "room_id": 1, "date": 1, "auto_booking": 1}).to_list(20000)
    blocks: dict = {}
    for d in docs:
        if d.get("auto_booking"):
            continue  # blocage lié à une réservation (déjà affiché comme barre)
        pid = room_to_prop.get(d["room_id"])
        if not pid:
            continue
        blocks.setdefault(pid, set()).add(d["date"])
    return {"blocks": {k: sorted(v) for k, v in blocks.items()}}



async def channex_import(user=Depends(get_current_user)):
    """Importe les logements Channex → Property + Room + RatePlan (idempotent par channex_id).
    Conserve les IDs Lodgify existants (mapping provider-neutre)."""
    uid = user["user_id"]
    adapter, doc = await get_channex_adapter(uid)
    if not adapter:
        raise HTTPException(status_code=400, detail="Channex non connecté")
    imported_props = imported_rooms = imported_rates = 0
    async with httpx.AsyncClient(timeout=60) as http:
        raw_props = await adapter.list_properties(http)
        for rp in raw_props:
            cp = map_channex_property(rp)
            cid = cp["channex_id"]
            existing = await db.properties.find_one({"user_id": uid, "channex_id": cid}, {"_id": 0})
            if existing:
                pid = existing["id"]
            else:
                pid = str(uuid.uuid4())
                await db.properties.insert_one({
                    "id": pid, "user_id": uid, "name": cp["title"],
                    "channex_id": cid, "location": cp.get("city") or "",
                    "base_price": 0, "capacity": 2, "bedrooms": 1,
                    "seasons": [], "ical_links": [],
                    "created_at": now_utc().isoformat(),
                })
                imported_props += 1
            rooms = await adapter.list_room_types(http, cid)
            for rr in rooms:
                cr = map_channex_room(rr)
                rtid = cr["channex_room_type_id"]
                ex_room = await db.rooms.find_one({"user_id": uid, "channex_room_type_id": rtid}, {"_id": 0})
                if ex_room:
                    room_id = ex_room["id"]
                else:
                    room_id = str(uuid.uuid4())
                    await db.rooms.insert_one({
                        "id": room_id, "user_id": uid, "property_id": pid,
                        "name": cr["title"], "channex_room_type_id": rtid,
                        "max_guests": cr.get("occ_adults") or 2,
                        "count_of_rooms": cr.get("count_of_rooms") or 1,
                        "created_at": now_utc().isoformat(),
                    })
                    imported_rooms += 1
            rates = await adapter.list_rate_plans(http, cid)
            for rpn in rates:
                crp = map_channex_rate_plan(rpn)
                rpid = crp["channex_rate_plan_id"]
                ex_rate = await db.rate_plans.find_one({"user_id": uid, "channex_rate_plan_id": rpid}, {"_id": 0})
                if not ex_rate:
                    linked = await db.rooms.find_one(
                        {"user_id": uid, "channex_room_type_id": crp.get("channex_room_type_id")}, {"_id": 0, "id": 1})
                    await db.rate_plans.insert_one({
                        "id": str(uuid.uuid4()), "user_id": uid, "property_id": pid,
                        "room_id": (linked or {}).get("id"), "name": crp["title"],
                        "channex_rate_plan_id": rpid, "base_price": 0, "min_stay": 1,
                        "closed": False, "created_at": now_utc().isoformat(),
                    })
                    imported_rates += 1
    await _sync_log(uid, "import", "success",
                    f"{imported_props} logements, {imported_rooms} chambres, {imported_rates} tarifs")
    return {"ok": True, "imported_properties": imported_props,
            "imported_rooms": imported_rooms, "imported_rate_plans": imported_rates}



class ChannelConnectIn(BaseModel):
    api_key: str
    provider: str = "lodgify"


@api_router.post("/channel/connect")
async def channel_connect(payload: ChannelConnectIn, user=Depends(get_current_user)):
    key = payload.api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="Clé API requise")
    adapter = LodgifyAdapter(key)
    async with httpx.AsyncClient(timeout=30) as http:
        count = await adapter.validate(http)
    await db.channel_settings.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "user_id": user["user_id"],
            "provider": payload.provider,
            "api_key": key,
            "properties_count": count,
            "connected_at": now_utc().isoformat(),
        }},
        upsert=True,
    )
    return {"ok": True, "provider": payload.provider, "properties_count": count}


@api_router.get("/channel/status")
async def channel_status(user=Depends(get_current_user)):
    doc = await db.channel_settings.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not doc:
        return {"connected": False}
    mapped = await db.properties.count_documents(
        {"user_id": user["user_id"], "lodgify_id": {"$nin": [None, ""]}})
    return {
        "connected": True,
        "provider": doc.get("provider", "lodgify"),
        "properties_count": doc.get("properties_count", 0),
        "mapped_count": mapped,
        "connected_at": doc.get("connected_at"),
        "last_sync": doc.get("last_sync"),
        "sync_interval_min": int(doc.get("sync_interval_min") or 30),
        "deposit_reminder_days": int(doc.get("deposit_reminder_days") or 2),
    }


class SyncIntervalIn(BaseModel):
    minutes: int


@api_router.patch("/channel/sync-interval")
async def set_sync_interval(payload: SyncIntervalIn, user=Depends(get_current_user)):
    # Bornes de sécurité : entre 5 min et 24 h
    minutes = max(5, min(1440, int(payload.minutes or 30)))
    await db.channel_settings.update_one(
        {"user_id": user["user_id"]}, {"$set": {"sync_interval_min": minutes}})
    return {"sync_interval_min": minutes}


class ReminderDaysIn(BaseModel):
    days: int


@api_router.patch("/channel/reminder-days")
async def set_reminder_days(payload: ReminderDaysIn, user=Depends(get_current_user)):
    # Nombre de jours avant l'arrivée pour la relance caution (0..14)
    days = max(0, min(14, int(payload.days if payload.days is not None else 2)))
    await db.channel_settings.update_one(
        {"user_id": user["user_id"]}, {"$set": {"deposit_reminder_days": days}})
    return {"deposit_reminder_days": days}


@api_router.post("/channel/disconnect")
async def channel_disconnect(user=Depends(get_current_user)):
    await db.channel_settings.delete_one({"user_id": user["user_id"]})
    return {"ok": True}


@api_router.get("/channel/remote-properties")
async def channel_remote_properties(user=Depends(get_current_user)):
    adapter, _ = await get_channel_adapter(user["user_id"])
    if not adapter:
        raise HTTPException(status_code=400, detail="Channel manager non connecté")
    async with httpx.AsyncClient(timeout=40) as http:
        lps = await adapter.list_properties(http)
    existing = {p.get("lodgify_id") for p in await db.properties.find(
        {"user_id": user["user_id"]}, {"lodgify_id": 1}).to_list(2000)}
    return [{
        "id": str(lp.get("id")),
        "name": lp.get("name") or lp.get("internal_name") or f"Logement {lp.get('id')}",
        "city": lp.get("city") or "",
        "imported": str(lp.get("id")) in existing,
    } for lp in lps]


@api_router.post("/channel/import-properties")
async def channel_import_properties(user=Depends(get_current_user)):
    adapter, _ = await get_channel_adapter(user["user_id"])
    if not adapter:
        raise HTTPException(status_code=400, detail="Channel manager non connecté")
    async with httpx.AsyncClient(timeout=40) as http:
        lps = await adapter.list_properties(http)
    imported = 0
    for lp in lps:
        lid = str(lp.get("id"))
        exists = await db.properties.find_one({"user_id": user["user_id"], "lodgify_id": lid})
        if exists:
            continue
        doc = map_lodgify_property(lp)
        doc["id"] = str(uuid.uuid4())
        doc["user_id"] = user["user_id"]
        doc["created_at"] = now_utc().isoformat()
        await db.properties.insert_one(doc)
        imported += 1
    return {"imported": imported, "total": len(lps)}


@api_router.post("/channel/sync")
async def channel_sync(user=Depends(get_current_user)):
    return await run_channel_sync(user["user_id"])


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


# ---------------------------------------------------------------------------
# Inbox (Boîte de réception) — OTA guest messages via Lodgify threads
# ---------------------------------------------------------------------------
@api_router.get("/inbox")
async def inbox(user=Depends(get_current_user)):
    if not _can_inbox(user):
        raise HTTPException(status_code=403, detail="Accès à la boîte de réception non autorisé")
    convs = await db.conversations.find(
        {"user_id": user["user_id"], **_prop_scope(user, "property_id")}, {"_id": 0}).sort("last_activity", -1).to_list(500)
    return convs


@api_router.get("/inbox-unread-count")
async def inbox_unread_count(user=Depends(get_current_user)):
    if not _can_inbox(user):
        return {"count": 0}
    n = await db.conversations.count_documents({"user_id": user["user_id"], "unread": True})
    return {"count": n}


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


@api_router.get("/inbox/{thread_uid}")
async def inbox_thread(thread_uid: str, user=Depends(get_current_user)):
    if not _can_inbox(user):
        raise HTTPException(status_code=403, detail="Accès à la boîte de réception non autorisé")
    adapter, _ = await get_channel_adapter(user["user_id"])
    if not adapter:
        raise HTTPException(status_code=400, detail="Channel manager non connecté")
    uid = user["user_id"]
    conv = await db.conversations.find_one(
        {"user_id": uid, "thread_uid": thread_uid}, {"_id": 0})
    async with httpx.AsyncClient(timeout=30) as http:
        thread = await adapter.get_thread(http, thread_uid)
    msgs = _normalize_msgs(thread)

    need_draft = bool(msgs and not msgs[-1].get("mine"))
    guest_idx = [i for i, m in enumerate(msgs) if not m.get("mine")]
    prop = None
    if need_draft:
        prop = await db.properties.find_one(
            {"id": (conv or {}).get("property_id"), "user_id": uid}, {"_id": 0})

    stored_draft = None
    if (need_draft and conv and conv.get("ai_draft")
            and conv.get("ai_draft_msg_id") == msgs[-1]["id"]
            and not conv.get("ai_draft_validated")):
        stored_draft = conv["ai_draft"]

    async def _do_draft():
        if not need_draft or stored_draft is not None:
            return stored_draft
        if not await _ai_auto_draft_enabled(uid):
            return None
        try:
            d = await _make_guest_draft(uid, thread_uid, msgs[-1]["text"], prop)
            await _store_draft(uid, thread_uid, msgs[-1]["id"], d)
            return d
        except Exception:
            logger.exception("draft generation failed")
            return None

    async def _do_trans():
        try:
            return await _translate_to_fr(uid, thread_uid, [msgs[i]["text"] for i in guest_idx])
        except Exception:
            return []

    ai_draft, fr = await asyncio.gather(_do_draft(), _do_trans())
    for j, i in enumerate(guest_idx):
        if j < len(fr):
            t = (fr[j] or "").strip()
            if t and t != (msgs[i]["text"] or "").strip():
                msgs[i]["text_fr"] = t

    await db.conversations.update_one(
        {"user_id": uid, "thread_uid": thread_uid},
        {"$set": {"unread": False}})
    return {
        "thread_uid": thread_uid,
        "guest_name": thread.get("guest_name") or (conv or {}).get("guest_name"),
        "property_name": (conv or {}).get("property_name"),
        "source": (conv or {}).get("source"),
        "messages": msgs,
        "ai_draft": ai_draft,
    }


@api_router.post("/inbox/{thread_uid}/generate-draft")
async def generate_draft(thread_uid: str, payload: dict = Body(default={}), user=Depends(get_current_user)):
    """Génère (ou régénère) un brouillon de réponse IA pour une conversation."""
    if not _can_inbox(user):
        raise HTTPException(status_code=403, detail="Accès à la boîte de réception non autorisé")
    adapter, _ = await get_channel_adapter(user["user_id"])
    if not adapter:
        raise HTTPException(status_code=400, detail="Channel manager non connecté")
    uid = user["user_id"]
    tone = (payload or {}).get("tone") or "chaleureux"
    conv = await db.conversations.find_one(
        {"user_id": uid, "thread_uid": thread_uid}, {"_id": 0})
    async with httpx.AsyncClient(timeout=30) as http:
        thread = await adapter.get_thread(http, thread_uid)
    msgs = _normalize_msgs(thread)
    last_guest = next((m for m in reversed(msgs) if not m.get("mine")), None)
    if not last_guest:
        raise HTTPException(status_code=400, detail="Aucun message voyageur auquel répondre")
    prop = await db.properties.find_one(
        {"id": (conv or {}).get("property_id"), "user_id": uid}, {"_id": 0})
    draft = await _make_guest_draft(uid, thread_uid, last_guest["text"], prop, tone)
    await _store_draft(uid, thread_uid, last_guest["id"], draft)
    return {"ai_draft": draft}


@api_router.get("/notifications")
async def notifications(user=Depends(get_current_user)):
    """Réponses IA prêtes à valider (brouillons non encore validés)."""
    if not _can_inbox(user):
        return {"count": 0, "items": []}
    convs = await db.conversations.find(
        {"user_id": user["user_id"], "ai_draft": {"$nin": [None, ""]},
         "ai_draft_validated": {"$ne": True}, **_prop_scope(user, "property_id")},
        {"_id": 0}).sort("ai_draft_at", -1).to_list(200)
    items = [{
        "thread_uid": c["thread_uid"], "guest_name": c.get("guest_name"),
        "property_name": c.get("property_name"), "source": c.get("source"),
        "ai_draft": c.get("ai_draft"), "ai_draft_at": c.get("ai_draft_at"),
    } for c in convs]
    return {"count": len(items), "items": items}


@api_router.get("/notifications/count")
async def notifications_count(user=Depends(get_current_user)):
    if not _can_inbox(user):
        return {"count": 0}
    n = await db.conversations.count_documents(
        {"user_id": user["user_id"], "ai_draft": {"$nin": [None, ""]},
         "ai_draft_validated": {"$ne": True}, **_prop_scope(user, "property_id")})
    return {"count": n}


class ReplyIn(BaseModel):
    message: str
    subject: str = ""


@api_router.post("/inbox/{thread_uid}/reply")
async def inbox_reply(thread_uid: str, payload: ReplyIn, user=Depends(get_current_user)):
    if not _can_inbox(user):
        raise HTTPException(status_code=403, detail="Accès à la boîte de réception non autorisé")
    if not payload.message.strip():
        raise HTTPException(status_code=400, detail="Message vide")
    adapter, _ = await get_channel_adapter(user["user_id"])
    if not adapter:
        raise HTTPException(status_code=400, detail="Channel manager non connecté")
    res = await db.reservations.find_one(
        {"user_id": user["user_id"], "thread_uid": thread_uid, "lodgify_id": {"$nin": [None, ""]}},
        {"_id": 0})
    if not res or not res.get("lodgify_id"):
        raise HTTPException(status_code=404, detail="Réservation liée introuvable pour cette conversation")
    async with httpx.AsyncClient(timeout=30) as http:
        await adapter.send_message(http, res["lodgify_id"], payload.message.strip(), payload.subject)
    # Une fois envoyé, le brouillon IA est validé/consommé
    await db.conversations.update_one(
        {"user_id": user["user_id"], "thread_uid": thread_uid},
        {"$set": {"last_activity": now_utc().isoformat(), "ai_draft_validated": True},
         "$unset": {"ai_draft": "", "ai_draft_msg_id": "", "ai_draft_at": ""}})
    return {
        "ok": True,
        "message": {
            "id": str(uuid.uuid4()),
            "text": payload.message.strip(),
            "type": "Owner",
            "date": now_utc().isoformat(),
            "mine": True,
        },
    }


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


async def _ai_draft_loop():
    """Boucle de fond : pré-génère les brouillons IA pour les nouveaux messages voyageurs."""
    await asyncio.sleep(90)
    while True:
        try:
            uids = await db.channel_settings.distinct("user_id")
            for uid in uids:
                try:
                    await _generate_drafts_for_user(uid)
                except Exception:
                    logger.exception("ai draft error for %s", uid)
        except Exception:
            logger.exception("ai draft loop error")
        await asyncio.sleep(1800)  # toutes les 30 min


# ---------------------------------------------------------------------------
# Staff (intervenants) — managed in Settings, used in intervention form
# ---------------------------------------------------------------------------
class StaffIn(BaseModel):
    name: str
    role: str = ""
    phone: str = ""
    email: str = ""


@api_router.get("/staff")
async def list_staff(user=Depends(get_current_user)):
    return await db.staff.find({"user_id": user["user_id"]}, {"_id": 0}).sort("name", 1).to_list(500)


@api_router.post("/staff")
async def create_staff(payload: StaffIn, user=Depends(get_current_user)):
    doc = payload.dict()
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    await db.staff.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/staff/{staff_id}")
async def update_staff(staff_id: str, payload: StaffIn, user=Depends(get_current_user)):
    res = await db.staff.update_one(
        {"id": staff_id, "user_id": user["user_id"]}, {"$set": payload.dict()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Intervenant introuvable")
    return await db.staff.find_one({"id": staff_id}, {"_id": 0})


@api_router.delete("/staff/{staff_id}")
async def delete_staff(staff_id: str, user=Depends(get_current_user)):
    await db.staff.delete_one({"id": staff_id, "user_id": user["user_id"]})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Members (utilisateurs) — équipe avec rôles et autorisations granulaires
# ---------------------------------------------------------------------------
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


@api_router.get("/members")
async def list_members(user=Depends(get_current_user)):
    return await db.members.find({"user_id": user["user_id"]}, {"_id": 0}).sort("first_name", 1).to_list(500)


@api_router.post("/members")
async def create_member(payload: MemberIn, user=Depends(get_current_user)):
    doc = payload.dict()
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["email_normalized"] = norm_email(doc.get("email", ""))
    doc["invite_status"] = "none"  # none | pending | active
    doc["created_at"] = now_utc().isoformat()
    await db.members.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/members/{member_id}")
async def get_member(member_id: str, user=Depends(get_current_user)):
    m = await db.members.find_one(
        {"id": member_id, "user_id": user["user_id"]},
        {"_id": 0, "password_hash": 0, "invite_token_hash": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return m


@api_router.put("/members/{member_id}")
async def update_member(member_id: str, payload: MemberIn, user=Depends(get_current_user)):
    data = payload.dict()
    data["email_normalized"] = norm_email(data.get("email", ""))
    res = await db.members.update_one(
        {"id": member_id, "user_id": user["user_id"]}, {"$set": data})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return await db.members.find_one(
        {"id": member_id}, {"_id": 0, "password_hash": 0, "invite_token_hash": 0})


@api_router.delete("/members/{member_id}")
async def delete_member(member_id: str, user=Depends(get_current_user)):
    await db.members.delete_one({"id": member_id, "user_id": user["user_id"]})
    await db.user_sessions.delete_many({"member_id": member_id})
    return {"ok": True}


class InviteIn(BaseModel):
    origin_url: str


@api_router.post("/members/{member_id}/invite")
async def invite_member(member_id: str, payload: InviteIn, user=Depends(get_current_user)):
    m = await db.members.find_one({"id": member_id, "user_id": user["user_id"]}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    email = norm_email(m.get("email", ""))
    if not email:
        raise HTTPException(status_code=400, detail="Renseignez d'abord l'email de l'utilisateur.")
    raw_token = secrets.token_urlsafe(32)
    await db.members.update_one(
        {"id": member_id, "user_id": user["user_id"]},
        {"$set": {
            "invite_token_hash": hash_token(raw_token),
            "invite_expires_at": (now_utc() + timedelta(days=7)).isoformat(),
            "invite_status": "pending",
            "invited_at": now_utc().isoformat(),
        }})
    origin = payload.origin_url.rstrip("/")
    link = f"{origin}/accept-invite?token={raw_token}"
    name = f'{m.get("first_name", "")} {m.get("last_name", "")}'.strip()
    subject, html = build_invite_email(member_name=name, invite_link=link)
    try:
        await send_email(to=m["email"], subject=subject, html=html)
    except Exception as e:
        logger.error("Invite email failed: %s", e)
        raise HTTPException(status_code=502, detail="Échec de l'envoi de l'email d'invitation")
    return {"ok": True, "email": m["email"]}


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


@api_router.post("/auth/accept-invite")
async def accept_invite(payload: AcceptInviteIn):
    if len(payload.password or "") < 8:
        raise HTTPException(status_code=422, detail="Le mot de passe doit contenir au moins 8 caractères")
    th = hash_token(payload.token)
    member = await db.members.find_one({"invite_token_hash": th}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=400, detail="Invitation invalide ou expirée")
    exp = member.get("invite_expires_at")
    try:
        if exp and datetime.fromisoformat(exp) < now_utc():
            raise HTTPException(status_code=400, detail="Invitation invalide ou expirée")
    except ValueError:
        pass
    await db.members.update_one(
        {"id": member["id"]},
        {"$set": {
            "password_hash": hash_password(payload.password),
            "password_set_at": now_utc().isoformat(),
            "invite_status": "active",
            "active": True,
        },
         "$unset": {"invite_token_hash": "", "invite_expires_at": ""}})
    member = await db.members.find_one({"id": member["id"]}, {"_id": 0})
    return await _create_member_session(member)


@api_router.post("/auth/login")
async def member_login(payload: LoginIn):
    email = norm_email(payload.email)
    member = await db.members.find_one(
        {"email_normalized": email, "password_hash": {"$exists": True}}, {"_id": 0})
    stored = member.get("password_hash") if member else None
    if not verify_password(payload.password, stored):
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")
    if member.get("active") is False:
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")
    return await _create_member_session(member)



# ---------------------------------------------------------------------------
# Owners (propriétaires) — managed in Settings, linked to properties
# ---------------------------------------------------------------------------
class OwnerIn(BaseModel):
    name: str
    email: str = ""
    phone: str = ""
    notes: str = ""


@api_router.get("/owners")
async def list_owners(user=Depends(get_current_user)):
    owners = await db.owners.find({"user_id": user["user_id"]}, {"_id": 0}).sort("name", 1).to_list(500)
    props = await db.properties.find({"user_id": user["user_id"]}, {"_id": 0, "id": 1, "owner_id": 1}).to_list(2000)
    counts = {}
    for p in props:
        oid = p.get("owner_id")
        if oid:
            counts[oid] = counts.get(oid, 0) + 1
    for o in owners:
        o["property_count"] = counts.get(o["id"], 0)
    return owners


@api_router.post("/owners")
async def create_owner(payload: OwnerIn, user=Depends(get_current_user)):
    doc = payload.dict()
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    await db.owners.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/owners/{owner_id}")
async def update_owner(owner_id: str, payload: OwnerIn, user=Depends(get_current_user)):
    res = await db.owners.update_one(
        {"id": owner_id, "user_id": user["user_id"]}, {"$set": payload.dict()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Propriétaire introuvable")
    return await db.owners.find_one({"id": owner_id}, {"_id": 0})


@api_router.delete("/owners/{owner_id}")
async def delete_owner(owner_id: str, user=Depends(get_current_user)):
    await db.owners.delete_one({"id": owner_id, "user_id": user["user_id"]})
    await db.properties.update_many(
        {"user_id": user["user_id"], "owner_id": owner_id}, {"$set": {"owner_id": None}})
    return {"ok": True}


@api_router.post("/owners/{owner_id}/documents")
async def add_owner_document(owner_id: str, body: dict, user=Depends(get_current_user)):
    uid = user["user_id"]
    owner = await db.owners.find_one({"id": owner_id, "user_id": uid}, {"_id": 0})
    if not owner:
        raise HTTPException(status_code=404, detail="Propriétaire introuvable")
    path = (body.get("path") or "").strip()
    if not path:
        raise HTTPException(status_code=400, detail="Fichier manquant")
    doc = {
        "id": str(uuid.uuid4()),
        "name": (body.get("name") or "Document").strip(),
        "path": path,
        "created_at": now_utc().isoformat(),
    }
    docs = (owner.get("documents") or []) + [doc]
    await db.owners.update_one({"id": owner_id, "user_id": uid}, {"$set": {"documents": docs}})
    return await db.owners.find_one({"id": owner_id}, {"_id": 0})


@api_router.delete("/owners/{owner_id}/documents/{doc_id}")
async def delete_owner_document(owner_id: str, doc_id: str, user=Depends(get_current_user)):
    uid = user["user_id"]
    owner = await db.owners.find_one({"id": owner_id, "user_id": uid}, {"_id": 0})
    if not owner:
        raise HTTPException(status_code=404, detail="Propriétaire introuvable")
    docs = [d for d in (owner.get("documents") or []) if d.get("id") != doc_id]
    await db.owners.update_one({"id": owner_id, "user_id": uid}, {"$set": {"documents": docs}})
    return await db.owners.find_one({"id": owner_id}, {"_id": 0})


@api_router.get("/owners/{owner_id}/summary")
async def owner_summary(owner_id: str, user=Depends(get_current_user)):
    uid = user["user_id"]
    owner = await db.owners.find_one({"id": owner_id, "user_id": uid}, {"_id": 0})
    if not owner:
        raise HTTPException(status_code=404, detail="Propriétaire introuvable")
    props = await db.properties.find({"user_id": uid, "owner_id": owner_id}, {"_id": 0}).to_list(500)
    prop_ids = [p["id"] for p in props]
    reservations = []
    if prop_ids:
        reservations = await db.reservations.find(
            {"user_id": uid, "property_id": {"$in": prop_ids}}, {"_id": 0}).to_list(5000)

    def parse(d):
        try:
            return date.fromisoformat(d)
        except Exception:
            return None

    revenue_total = 0.0
    per_month = {}
    nights_total = 0
    prop_name = {p["id"]: p.get("name", "Logement") for p in props}
    pp = {p["id"]: {"id": p["id"], "name": p.get("name", "Logement"), "revenue": 0.0, "nights": 0, "months": {}} for p in props}
    for r in reservations:
        if r.get("status") == "annulee":
            continue
        ci = parse(r.get("check_in"))
        co = parse(r.get("check_out"))
        fin = r.get("finance") or {}
        price = float(fin.get("total") or r.get("total_price", 0) or 0)
        revenue_total += price
        pid = r.get("property_id")
        if ci:
            key = f"{ci.year}-{ci.month:02d}"
            per_month[key] = per_month.get(key, 0) + price
            if pid in pp:
                pp[pid]["months"][key] = pp[pid]["months"].get(key, 0) + price
        if pid in pp:
            pp[pid]["revenue"] += price
        if ci and co and co > ci:
            n = (co - ci).days
            nights_total += n
            if pid in pp:
                pp[pid]["nights"] += n
    months_sorted = sorted(per_month.items())
    per_property = [
        {
            "id": v["id"], "name": v["name"],
            "revenue_total": round(v["revenue"]), "nights_total": v["nights"],
            "per_month": [{"month": k, "revenue": round(rv)} for k, rv in sorted(v["months"].items())],
        }
        for v in pp.values()
    ]
    per_property.sort(key=lambda x: -x["revenue_total"])
    return {
        "owner": owner,
        "properties": props,
        "revenue_total": round(revenue_total),
        "reservations_count": len([r for r in reservations if r.get("status") != "annulee"]),
        "nights_total": nights_total,
        "per_month": [{"month": k, "revenue": round(v)} for k, v in months_sorted],
        "per_property": per_property,
    }



# ---------------------------------------------------------------------------
# Relevé des propriétaires (comptabilité conciergerie / propriétaire)
# ---------------------------------------------------------------------------
class ExpenseIn(BaseModel):
    property_id: str
    month: str            # YYYY-MM
    label: str
    amount: float = 0
    charge_to: str = "owner"   # owner | concierge


@api_router.get("/statement-expenses")
async def list_expenses(month: str, property_id: str = "", user=Depends(get_current_user)):
    q = {"user_id": user["user_id"], "month": month, **_prop_scope(user, "property_id")}
    if property_id:
        q["property_id"] = property_id
    docs = await db.statement_expenses.find(q, {"_id": 0}).sort("created_at", 1).to_list(500)
    return docs


@api_router.post("/statement-expenses")
async def create_expense(payload: ExpenseIn, user=Depends(get_current_user)):
    if not payload.label.strip():
        raise HTTPException(status_code=400, detail="Libellé requis")
    doc = payload.dict()
    doc["label"] = doc["label"].strip()
    doc["charge_to"] = doc["charge_to"] if doc["charge_to"] in ("owner", "concierge") else "owner"
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    await db.statement_expenses.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.delete("/statement-expenses/{expense_id}")
async def delete_expense(expense_id: str, user=Depends(get_current_user)):
    await db.statement_expenses.delete_one({"id": expense_id, "user_id": user["user_id"]})
    return {"ok": True}


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


@api_router.get("/owner-statement")
async def owner_statement(month: str = "", start: str = "", end: str = "",
                          property_id: str = "", user=Depends(get_current_user)):
    """Relevé par logement sur un mois OU une plage de dates : ventilation + revenus.

    Règles: frais de gestion = % logement x nuitées ; ménage -> conciergerie ;
    taxe de séjour -> reversée à la commune ; revenu propriétaire = nuitées -
    frais de gestion - commissions plateforme - dépenses propriétaire.
    Réservations retenues : arrivée (check_in) dans la période, hors annulées.
    """
    start_d, end_d, period_key, period_label = _resolve_period(month, start, end)

    pq = {"user_id": user["user_id"], **_prop_scope(user, "id")}
    if property_id:
        pq["id"] = property_id
    properties = await db.properties.find(pq, {"_id": 0}).to_list(500)

    statements = []
    for p in properties:
        pid = p["id"]
        reservations = await db.reservations.find(
            {"user_id": user["user_id"], "property_id": pid,
             "check_in": {"$gte": start_d, "$lt": end_d}, "status": {"$nin": ["annulee", "bloque"]}},
            {"_id": 0}).sort("check_in", 1).to_list(1000)
        lines = []
        t_nights = t_clean = t_tax = t_comm = 0.0
        t_tax_sejour = t_tax_regional = 0.0
        _tp = float(p.get("tourist_tax_pct") or 0)
        _rp = float(p.get("regional_tax_pct") or 0)
        _tot_pct = _tp + _rp
        for r in reservations:
            a = _res_amounts(r)
            t_nights += a["nights"]; t_clean += a["cleaning"]; t_tax += a["tax"]; t_comm += a["commission"]
            # Répartition taxe de séjour / taxe additionnelle régionale (proportionnelle aux taux du logement)
            if _tot_pct > 0:
                sej = round(a["tax"] * _tp / _tot_pct, 2)
            else:
                sej = a["tax"]
            reg = round(a["tax"] - sej, 2)
            t_tax_sejour += sej; t_tax_regional += reg
            lines.append({
                "id": r.get("id"), "guest_name": r.get("guest_name"),
                "platform": r.get("platform"), "check_in": r.get("check_in"),
                "check_out": r.get("check_out"), **a,
            })
        expenses = await db.statement_expenses.find(
            {"user_id": user["user_id"], "property_id": pid, "month": period_key}, {"_id": 0}).to_list(500)
        owner_exp = round(sum(float(e.get("amount") or 0) for e in expenses if e.get("charge_to") == "owner"), 2)
        concierge_exp = round(sum(float(e.get("amount") or 0) for e in expenses if e.get("charge_to") == "concierge"), 2)

        pct = float(p.get("management_fee_pct") or 0)
        mgmt_fee = round(t_nights * pct / 100.0, 2)
        # Commission OTA : override manuel éventuel (par logement/période) sinon somme auto
        ov = await db.statement_overrides.find_one(
            {"user_id": user["user_id"], "property_id": pid, "month": period_key}, {"_id": 0})
        comm_override = None
        if ov and ov.get("commission") is not None:
            comm_override = round(float(ov.get("commission") or 0), 2)
        eff_comm = comm_override if comm_override is not None else round(t_comm, 2)
        owner_revenue = round(t_nights - mgmt_fee - eff_comm - owner_exp, 2)
        concierge_revenue = round(mgmt_fee + t_clean - concierge_exp, 2)

        send_log = await db.statement_sends.find_one(
            {"user_id": user["user_id"], "property_id": pid, "month": period_key}, {"_id": 0})

        statements.append({
            "property_id": pid, "property_name": p.get("name"), "owner": p.get("owner"),
            "management_fee_pct": pct, "reservations_count": len(lines), "lines": lines,
            "last_sent_at": (send_log or {}).get("sent_at"),
            "last_sent_to": (send_log or {}).get("to"),
            "totals": {
                "nights": round(t_nights, 2), "cleaning": round(t_clean, 2),
                "tax": round(t_tax, 2), "commission": eff_comm,
                "tax_sejour": round(t_tax_sejour, 2), "tax_regional": round(t_tax_regional, 2),
                "commission_auto": round(t_comm, 2), "commission_override": comm_override,
                "management_fee": mgmt_fee, "owner_expenses": owner_exp,
                "concierge_expenses": concierge_exp,
                "owner_revenue": owner_revenue, "concierge_revenue": concierge_revenue,
                "tourist_tax_to_reverse": round(t_tax, 2),
            },
            "expenses": expenses,
        })
    return {"month": period_key, "period_key": period_key, "period_label": period_label, "statements": statements}


class CommissionOverrideIn(BaseModel):
    property_id: str
    month: str
    commission: Optional[float] = None   # None => revenir à la valeur automatique


@api_router.put("/statement-commission")
async def set_statement_commission(payload: CommissionOverrideIn, user=Depends(get_current_user)):
    """Fixe (ou réinitialise) la commission OTA du relevé pour un logement/mois."""
    uid = user["user_id"]
    q = {"user_id": uid, "property_id": payload.property_id, "month": payload.month}
    if payload.commission is None:
        await db.statement_overrides.delete_one(q)
        return {"commission_override": None}
    val = round(float(payload.commission), 2)
    await db.statement_overrides.update_one(q, {"$set": {**q, "commission": val}}, upsert=True)
    return {"commission_override": val}


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


@api_router.post("/owner-statement/email")
async def email_owner_statement(payload: StatementEmailIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    prop = await db.properties.find_one({"id": payload.property_id, "user_id": uid}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Logement introuvable")
    owner_email = ""
    owner_name = prop.get("owner") or ""
    if prop.get("owner_id"):
        owner = await db.owners.find_one({"id": prop["owner_id"], "user_id": uid}, {"_id": 0})
        if owner:
            owner_email = (owner.get("email") or "").strip()
            owner_name = owner.get("name") or owner_name
    if not owner_email:
        return {"sent": False, "reason": "no_owner_email"}
    data = await owner_statement(month=payload.month, start=payload.start, end=payload.end,
                                 property_id=payload.property_id, user=user)
    stmts = data.get("statements") or []
    if not stmts:
        return {"sent": False, "reason": "no_data"}
    s = stmts[0]
    period_key = data.get("period_key")
    period_label = data.get("period_label")
    prefs = await db.preferences.find_one({"user_id": uid}, {"_id": 0})
    company = _build_company(prefs)
    logo_url = _logo_url_from_base(payload.base_url or (await db.channel_settings.find_one({"user_id": uid}) or {}).get("public_base_url", ""), company)
    subject = f"Relevé {period_label} — {s.get('property_name')}"
    html = _statement_html(payload.month, s, company, logo_url, period_label)
    await send_email(to=owner_email, subject=subject, html=html)
    await _record_statement_send(uid, payload.property_id, period_key, owner_email)
    return {"sent": True, "to": owner_email, "owner_name": owner_name}


class StatementEmailAllIn(BaseModel):
    month: str = ""
    start: str = ""
    end: str = ""
    base_url: Optional[str] = None


@api_router.post("/owner-statement/email-all")
async def email_all_owner_statements(payload: StatementEmailAllIn, user=Depends(get_current_user)):
    """Envoie à chaque propriétaire UN SEUL email regroupant tous ses logements pour la période."""
    uid = user["user_id"]
    data = await owner_statement(month=payload.month, start=payload.start, end=payload.end,
                                 property_id="", user=user)
    stmts = data.get("statements") or []
    if not stmts:
        return {"sent": 0, "results": [], "reason": "no_data"}
    period_key = data.get("period_key")
    period_label = data.get("period_label")

    # Regroupe les logements par propriétaire (owner_id)
    prop_ids = [s["property_id"] for s in stmts]
    props = await db.properties.find({"user_id": uid, "id": {"$in": prop_ids}}, {"_id": 0}).to_list(500)
    prop_by_id = {p["id"]: p for p in props}

    groups: dict = {}
    for s in stmts:
        p = prop_by_id.get(s["property_id"], {})
        oid = p.get("owner_id") or f"__noid__{s['property_id']}"
        groups.setdefault(oid, {"owner_id": p.get("owner_id"), "owner_fallback": p.get("owner") or "", "statements": []})
        groups[oid]["statements"].append(s)

    prefs = await db.preferences.find_one({"user_id": uid}, {"_id": 0})
    company = _build_company(prefs)
    logo_url = _logo_url_from_base(payload.base_url or (await db.channel_settings.find_one({"user_id": uid}) or {}).get("public_base_url", ""), company)

    results = []
    sent = 0
    for grp in groups.values():
        owner_email = ""
        owner_name = grp["owner_fallback"]
        if grp["owner_id"]:
            owner = await db.owners.find_one({"id": grp["owner_id"], "user_id": uid}, {"_id": 0})
            if owner:
                owner_email = (owner.get("email") or "").strip()
                owner_name = owner.get("name") or owner_name
        names = ", ".join(st.get("property_name") or "" for st in grp["statements"])
        if not owner_email:
            results.append({"owner_name": owner_name or "?", "properties": names, "sent": False, "reason": "no_owner_email"})
            continue
        subject = f"Relevé {period_label} — {owner_name}" if owner_name else f"Relevé {period_label}"
        html = _combined_statement_html(payload.month, grp["statements"], owner_name, company, logo_url, period_label)
        await send_email(to=owner_email, subject=subject, html=html)
        for st in grp["statements"]:
            await _record_statement_send(uid, st["property_id"], period_key, owner_email)
        sent += 1
        results.append({"owner_name": owner_name, "properties": names, "sent": True, "to": owner_email})
    return {"sent": sent, "results": results}


@api_router.get("/owner-statement/pending-send")
async def owner_statement_pending_send(month: str = "", user=Depends(get_current_user)):
    """Relevés du mois écoulé (par défaut) non encore envoyés au propriétaire.
    Un logement est 'à envoyer' s'il a des réservations sur la période, un propriétaire
    avec email, et aucun enregistrement d'envoi (statement_sends) pour cette période."""
    uid = user["user_id"]
    if not month:
        today = now_utc().date()
        first = today.replace(day=1)
        prev = first - timedelta(days=1)
        month = f"{prev.year:04d}-{prev.month:02d}"
    data = await owner_statement(month=month, property_id="", user=user)
    stmts = data.get("statements") or []
    period_key = data.get("period_key")
    period_label = data.get("period_label")
    pending = []
    for s in stmts:
        if (s.get("reservations_count") or 0) == 0:
            continue
        if s.get("last_sent_at"):
            continue
        # propriétaire avec email ?
        prop = await db.properties.find_one({"id": s["property_id"], "user_id": uid}, {"_id": 0})
        owner_email = ""
        owner_name = (prop or {}).get("owner") or ""
        if prop and prop.get("owner_id"):
            owner = await db.owners.find_one({"id": prop["owner_id"], "user_id": uid}, {"_id": 0})
            if owner:
                owner_email = (owner.get("email") or "").strip()
                owner_name = owner.get("name") or owner_name
        pending.append({
            "property_id": s["property_id"], "property_name": s.get("property_name"),
            "owner_name": owner_name, "has_owner_email": bool(owner_email),
            "owner_revenue": s["totals"].get("owner_revenue"),
        })
    return {"month": month, "period_key": period_key, "period_label": period_label,
            "count": len(pending), "pending": pending}



# ---------------------------------------------------------------------------
# Avis voyageurs (guest reviews) — suivi des notes par logement
# ---------------------------------------------------------------------------
class ReviewIn(BaseModel):
    property_id: str
    reservation_id: str = ""
    guest_name: str = ""
    rating: int = 5           # 1..5
    comment: str = ""
    date: str = ""            # YYYY-MM-DD (défaut aujourd'hui)
    platform: str = ""


@api_router.get("/reviews")
async def list_reviews(property_id: str = "", user=Depends(get_current_user)):
    uid = user["user_id"]
    q = {"user_id": uid, **_prop_scope(user, "property_id")}
    if property_id:
        q["property_id"] = property_id
    items = await db.reviews.find(q, {"_id": 0}).sort("date", -1).to_list(2000)
    return items


@api_router.get("/reviews/summary")
async def reviews_summary(user=Depends(get_current_user)):
    """Note moyenne + nombre d'avis par logement (+ moyenne globale)."""
    uid = user["user_id"]
    props = await db.properties.find(
        {"user_id": uid, **_prop_scope(user)}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
    reviews = await db.reviews.find(
        {"user_id": uid, **_prop_scope(user, "property_id")}, {"_id": 0}).to_list(5000)
    by_prop: dict = {}
    for rv in reviews:
        by_prop.setdefault(rv["property_id"], []).append(float(rv.get("rating") or 0))
    per_property = []
    all_ratings = []
    for p in props:
        rs = by_prop.get(p["id"], [])
        all_ratings += rs
        per_property.append({
            "property_id": p["id"], "property_name": p.get("name", "Logement"),
            "count": len(rs),
            "avg": round(sum(rs) / len(rs), 2) if rs else 0,
        })
    per_property.sort(key=lambda x: (-x["avg"], -x["count"]))
    return {
        "per_property": per_property,
        "total_reviews": len(all_ratings),
        "avg_all": round(sum(all_ratings) / len(all_ratings), 2) if all_ratings else 0,
    }


@api_router.post("/reviews")
async def create_review(payload: ReviewIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    prop = await db.properties.find_one(
        {"id": payload.property_id, "user_id": uid, **_prop_scope(user)}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Logement introuvable")
    doc = payload.dict()
    doc["rating"] = max(1, min(5, int(doc.get("rating") if doc.get("rating") is not None else 5)))
    doc["date"] = doc.get("date") or date.today().isoformat()
    doc["property_name"] = prop.get("name", "")
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = uid
    doc["created_at"] = now_utc().isoformat()
    await db.reviews.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/reviews/{review_id}")
async def update_review(review_id: str, payload: ReviewIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    data = payload.dict()
    data["rating"] = max(1, min(5, int(data.get("rating") if data.get("rating") is not None else 5)))
    res = await db.reviews.update_one({"id": review_id, "user_id": uid}, {"$set": data})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Avis introuvable")
    item = await db.reviews.find_one({"id": review_id}, {"_id": 0})
    return item


@api_router.delete("/reviews/{review_id}")
async def delete_review(review_id: str, user=Depends(get_current_user)):
    await db.reviews.delete_one({"id": review_id, "user_id": user["user_id"]})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Promotions (codes promo / réductions par logement)
# ---------------------------------------------------------------------------
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


@api_router.get("/promotions")
async def list_promotions(user=Depends(get_current_user)):
    return await db.promotions.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)


@api_router.post("/promotions")
async def create_promotion(payload: PromotionIn, user=Depends(get_current_user)):
    doc = _clean_promotion(payload.dict())
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    await db.promotions.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/promotions/{promotion_id}")
async def update_promotion(promotion_id: str, payload: PromotionIn, user=Depends(get_current_user)):
    data = _clean_promotion(payload.dict())
    res = await db.promotions.update_one({"id": promotion_id, "user_id": user["user_id"]}, {"$set": data})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Promotion introuvable")
    return await db.promotions.find_one({"id": promotion_id}, {"_id": 0})


@api_router.delete("/promotions/{promotion_id}")
async def delete_promotion(promotion_id: str, user=Depends(get_current_user)):
    await db.promotions.delete_one({"id": promotion_id, "user_id": user["user_id"]})
    return {"ok": True}



# ---------------------------------------------------------------------------
# Rapport d'activité mensuel (récap global tous logements) — PDF/email
# ---------------------------------------------------------------------------
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


@api_router.post("/reports/monthly-activity/send")
async def send_monthly_report(payload: MonthlyReportIn, user=Depends(get_current_user)):
    """Génère et envoie par email au gestionnaire le récap global du mois (défaut : mois écoulé)."""
    if not _can(user, "view_revenue_charts"):
        raise HTTPException(status_code=403, detail="Accès aux revenus non autorisé")
    uid = user["user_id"]
    month = payload.month
    if not month:
        today = now_utc().date()
        prev = today.replace(day=1) - timedelta(days=1)
        month = f"{prev.year:04d}-{prev.month:02d}"
    kpi = await analytics_kpi(month=month, user=user)
    u = await db.users.find_one({"user_id": uid}, {"_id": 0})
    email = (u or {}).get("email", "").strip()
    if not email:
        return {"sent": False, "reason": "no_manager_email"}
    prefs = await db.preferences.find_one({"user_id": uid}, {"_id": 0})
    company = _build_company(prefs)
    logo_url = _logo_url_from_base(
        payload.base_url or (await db.channel_settings.find_one({"user_id": uid}) or {}).get("public_base_url", ""), company)
    label = kpi.get("period_label") or month
    html = _monthly_report_html(label, kpi, company, logo_url)
    await send_email(to=email, subject=f"Casanéo — Rapport d'activité {label}", html=html)
    return {"sent": True, "to": email, "period_label": label}



# ---------------------------------------------------------------------------
# Message templates + markers (couleurs automatiques + envois programmés)
# ---------------------------------------------------------------------------
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


@api_router.get("/message-templates")
async def list_templates(user=Depends(get_current_user)):
    return await get_templates(user["user_id"])


@api_router.post("/message-templates")
async def create_template(payload: MessageTemplateIn, user=Depends(get_current_user)):
    await get_templates(user["user_id"])  # ensure defaults seeded
    doc = payload.dict()
    doc["marker_key"] = f"tpl_{uuid.uuid4().hex[:8]}"
    doc["kind"] = "message"
    doc["order"] = 100
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    await db.message_templates.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/message-templates/{tpl_id}")
async def update_template(tpl_id: str, payload: MessageTemplateIn, user=Depends(get_current_user)):
    res = await db.message_templates.update_one(
        {"id": tpl_id, "user_id": user["user_id"]}, {"$set": payload.dict()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Modèle introuvable")
    return await db.message_templates.find_one({"id": tpl_id}, {"_id": 0})


@api_router.delete("/message-templates/{tpl_id}")
async def delete_template(tpl_id: str, user=Depends(get_current_user)):
    tpl = await db.message_templates.find_one({"id": tpl_id, "user_id": user["user_id"]}, {"_id": 0})
    if tpl and tpl.get("kind") == "payment":
        raise HTTPException(status_code=400, detail="Le marqueur Payée ne peut pas être supprimé")
    await db.message_templates.delete_one({"id": tpl_id, "user_id": user["user_id"]})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Quick replies (réponses types réutilisables dans la boîte de réception)
# ---------------------------------------------------------------------------
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


@api_router.get("/quick-replies")
async def list_quick_replies(user=Depends(get_current_user)):
    if not _can_inbox(user):
        raise HTTPException(status_code=403, detail="Accès non autorisé")
    return await _seed_quick_replies(user["user_id"])


@api_router.post("/quick-replies")
async def create_quick_reply(payload: QuickReplyIn, user=Depends(get_current_user)):
    if not payload.title.strip() or not payload.body.strip():
        raise HTTPException(status_code=400, detail="Titre et message requis")
    await _seed_quick_replies(user["user_id"])
    doc = {"id": str(uuid.uuid4()), "user_id": user["user_id"],
           "title": payload.title.strip(), "body": payload.body.strip(),
           "order": 100, "created_at": now_utc().isoformat()}
    await db.quick_replies.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/quick-replies/{qid}")
async def update_quick_reply(qid: str, payload: QuickReplyIn, user=Depends(get_current_user)):
    res = await db.quick_replies.update_one(
        {"id": qid, "user_id": user["user_id"]},
        {"$set": {"title": payload.title.strip(), "body": payload.body.strip()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Réponse type introuvable")
    return await db.quick_replies.find_one({"id": qid}, {"_id": 0})


@api_router.delete("/quick-replies/{qid}")
async def delete_quick_reply(qid: str, user=Depends(get_current_user)):
    await db.quick_replies.delete_one({"id": qid, "user_id": user["user_id"]})
    return {"ok": True}



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


@api_router.post("/automations/run")
async def automations_run(user=Depends(get_current_user)):
    sent = await run_automations_for_user(user["user_id"])
    return {"sent": sent}


# ---------------------------------------------------------------------------
# Object storage (photos état des lieux) — Emergent managed
# ---------------------------------------------------------------------------
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


@api_router.post("/upload")
async def upload_file(file: UploadFile = File(...), user=Depends(get_current_user)):
    ext = (file.filename or "photo.jpg").rsplit(".", 1)[-1].lower()
    allowed = ("jpg", "jpeg", "png", "webp", "heic", "pdf", "doc", "docx", "xls", "xlsx", "txt", "csv")
    if ext not in allowed:
        ext = "bin"
    path = f"{_APP_NAME}/uploads/{user['user_id']}/{uuid.uuid4().hex}.{ext}"
    data = await file.read()
    ct = file.content_type or "application/octet-stream"
    try:
        result = await run_in_threadpool(_put_object, path, data, ct)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upload échoué: {e}")
    await db.uploads.insert_one({
        "user_id": user["user_id"], "path": result["path"],
        "created_at": now_utc().isoformat(),
    })
    return {"path": result["path"]}


@api_router.get("/files/{path:path}")
async def get_file(path: str, token: Optional[str] = None, authorization: Optional[str] = Header(None)):
    tok = token
    if not tok and authorization and authorization.startswith("Bearer "):
        tok = authorization[7:]
    session = await db.user_sessions.find_one({"session_token": tok}) if tok else None
    if not session:
        raise HTTPException(status_code=401, detail="Non autorisé")
    owned = await db.uploads.find_one({"user_id": session["user_id"], "path": path})
    if not owned:
        raise HTTPException(status_code=404, detail="Fichier introuvable")
    try:
        content, ct = await run_in_threadpool(_get_object, path)
    except Exception:
        raise HTTPException(status_code=404, detail="Fichier introuvable")
    return Response(content=content, media_type=ct)


@api_router.get("/assets/casaneo-logo.png")
async def get_casaneo_logo():
    """Logo Casanéo public (utilisé dans les emails de relevé)."""
    p = ROOT_DIR / "assets" / "casaneo-logo.png"
    try:
        return Response(content=p.read_bytes(), media_type="image/png")
    except Exception:
        raise HTTPException(status_code=404, detail="Logo introuvable")


@api_router.get("/company-logo/{path:path}")
async def get_company_logo(path: str):
    """Logo de la société de conciergerie (public, chemin non devinable) — utilisé dans les relevés/emails.
    Ne sert le fichier que s'il est enregistré comme logo dans les préférences d'un utilisateur."""
    pref = await db.preferences.find_one({"company.logo_path": path}, {"_id": 0, "user_id": 1})
    if not pref:
        raise HTTPException(status_code=404, detail="Logo introuvable")
    try:
        content, ct = await run_in_threadpool(_get_object, path)
    except Exception:
        raise HTTPException(status_code=404, detail="Logo introuvable")
    return Response(content=content, media_type=ct)


@api_router.get("/kp/{path:path}")
async def get_key_photo(path: str):
    """Accès public (lien non devinable) aux photos de clés envoyées aux voyageurs.
    Ne sert que les fichiers réellement enregistrés comme photos de clés d'un logement."""
    prop = await db.properties.find_one({"key_photos": path}, {"_id": 0, "id": 1})
    if not prop:
        raise HTTPException(status_code=404, detail="Fichier introuvable")
    try:
        content, ct = await run_in_threadpool(_get_object, path)
    except Exception:
        raise HTTPException(status_code=404, detail="Fichier introuvable")
    return Response(content=content, media_type=ct)



# ---------------------------------------------------------------------------
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def enforce_write_permissions(request, call_next):
    """Seuls le compte principal (Google) et les membres Administrateur peuvent modifier.
    Le personnel de terrain (nettoyage/intervenant) peut uniquement marquer une tâche faite."""
    method = request.method
    path = request.url.path
    if method in ("POST", "PUT", "PATCH", "DELETE") and path.startswith("/api") and path != "/api/auth/logout":
        auth = request.headers.get("authorization", "")
        token = auth[7:].strip() if auth[:7].lower() == "bearer " else None
        if token:
            session = await db.user_sessions.find_one({"session_token": token})
            if session and session.get("kind") == "member":
                member = await db.members.find_one({"id": session.get("member_id")})
                role = (member or {}).get("role", "member")
                if role != "admin":
                    is_field = role in ("cleaning", "intervenant")
                    allowed = is_field and path.startswith("/api/interventions/") and path.endswith("/done")
                    if not allowed:
                        from starlette.responses import JSONResponse
                        return JSONResponse(
                            status_code=403,
                            content={"detail": "Modification réservée à l'administrateur et au compte principal."})
    return await call_next(request)




@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.properties.create_index("user_id")
    await db.reservations.create_index("user_id")
    await db.interventions.create_index("user_id")
    asyncio.create_task(automation_scheduler())
    asyncio.create_task(_ical_auto_sync_loop())
    asyncio.create_task(_lodgify_auto_sync_loop())
    asyncio.create_task(_ai_draft_loop())
    asyncio.create_task(_statement_reminder_loop())
    asyncio.create_task(_monthly_report_loop())


async def _lodgify_auto_sync_loop():
    """Synchronise automatiquement les réservations Lodgify de chaque utilisateur.
    Tick toutes les 5 min ; chaque utilisateur est synchronisé selon son intervalle réglable
    (channel_settings.sync_interval_min, défaut 30 min)."""
    await asyncio.sleep(90)  # laisser le serveur démarrer
    while True:
        try:
            settings = await db.channel_settings.find(
                {}, {"_id": 0, "user_id": 1, "last_sync": 1, "sync_interval_min": 1, "api_key": 1}).to_list(1000)
            now = now_utc()
            for s in settings:
                if not s.get("api_key"):
                    continue
                interval = int(s.get("sync_interval_min") or 30)
                due = True
                ls = s.get("last_sync")
                if ls:
                    try:
                        last = datetime.fromisoformat(ls)
                        due = (now - last) >= timedelta(minutes=interval)
                    except Exception:
                        due = True
                if not due:
                    continue
                try:
                    await run_channel_sync(s["user_id"])
                except Exception:
                    logger.exception("lodgify auto-sync error for %s", s.get("user_id"))
        except Exception:
            logger.exception("lodgify auto-sync loop error")
        await asyncio.sleep(300)



async def automation_scheduler():
    """Every 30 min, send due automatic messages for all connected users."""
    while True:
        try:
            uids = await db.channel_settings.distinct("user_id")
            for uid in uids:
                try:
                    await run_automations_for_user(uid)
                except Exception:
                    logger.exception("automation error for %s", uid)
        except Exception:
            logger.exception("automation scheduler loop error")
        await asyncio.sleep(1800)


async def _statement_reminder_loop():
    """Début de mois : rappelle (email + push) au gestionnaire les relevés du mois
    écoulé restant à envoyer. Envoi unique par mois (collection reminders_sent)."""
    await asyncio.sleep(60)
    while True:
        try:
            today = now_utc().date()
            if today.day <= 7:  # fenêtre "début de mois"
                cur_month = f"{today.year:04d}-{today.month:02d}"
                first = today.replace(day=1)
                prev = first - timedelta(days=1)
                prev_month = f"{prev.year:04d}-{prev.month:02d}"
                owners = await db.users.find({}, {"_id": 0, "user_id": 1, "email": 1, "name": 1}).to_list(1000)
                for u in owners:
                    uid = u.get("user_id")
                    if not uid:
                        continue
                    already = await db.reminders_sent.find_one({"user_id": uid, "month": cur_month, "kind": "statement"})
                    if already:
                        continue
                    fake = {"user_id": uid, "role": "owner", "allowed_property_ids": None, "permissions": []}
                    try:
                        data = await owner_statement(month=prev_month, property_id="", user=fake)
                    except Exception:
                        continue
                    pending = [s for s in (data.get("statements") or [])
                               if (s.get("reservations_count") or 0) > 0 and not s.get("last_sent_at")]
                    if not pending:
                        continue
                    label = data.get("period_label") or prev_month
                    title = "Relevés à envoyer"
                    msg = f"{len(pending)} relevé(s) de {label} restent à envoyer à vos propriétaires."
                    # Push
                    try:
                        await send_push(recipients=[uid], data={"title": title, "message": msg, "action_url": "/statement"},
                                        idempotency_key=f"stmt-{uid}-{cur_month}")
                    except Exception as e:
                        logger.warning("push rappel relevés échoué: %s", e)
                    # Email au gestionnaire
                    email = (u.get("email") or "").strip()
                    if email:
                        items = "".join(f"<li>{escape(str(p.get('property_name') or ''))} — {escape(str(p.get('owner') or ''))}</li>"
                                        for p in pending)
                        html = (f"<div style='font-family:Arial,sans-serif;max-width:560px;margin:auto'>"
                                f"<h2 style='color:#2A6F9E'>Relevés à envoyer — {escape(label)}</h2>"
                                f"<p>{len(pending)} relevé(s) du mois écoulé restent à envoyer :</p>"
                                f"<ul>{items}</ul>"
                                f"<p style='color:#777'>Ouvrez Casanéo → Relevé pour les envoyer.</p></div>")
                        try:
                            await send_email(to=email, subject=f"Casanéo — {len(pending)} relevé(s) à envoyer ({label})", html=html)
                        except Exception as e:
                            logger.warning("email rappel relevés échoué: %s", e)
                    await db.reminders_sent.update_one(
                        {"user_id": uid, "month": cur_month, "kind": "statement"},
                        {"$set": {"user_id": uid, "month": cur_month, "kind": "statement",
                                  "count": len(pending), "sent_at": now_utc().isoformat()}}, upsert=True)
        except Exception:
            logger.exception("statement reminder loop error")
        await asyncio.sleep(6 * 3600)
async def _monthly_report_loop():
    """Début de mois : envoie au gestionnaire le rapport d'activité du mois écoulé
    (récap global tous logements). Envoi unique par mois (reminders_sent kind=report)."""
    await asyncio.sleep(120)
    while True:
        try:
            today = now_utc().date()
            if today.day <= 3:
                cur_month = f"{today.year:04d}-{today.month:02d}"
                prev = today.replace(day=1) - timedelta(days=1)
                prev_month = f"{prev.year:04d}-{prev.month:02d}"
                owners = await db.users.find({}, {"_id": 0, "user_id": 1, "email": 1}).to_list(1000)
                for u in owners:
                    uid = u.get("user_id")
                    email = (u.get("email") or "").strip()
                    if not uid or not email:
                        continue
                    prefs = await db.preferences.find_one({"user_id": uid}, {"_id": 0}) or {}
                    if not prefs.get("monthly_report_enabled", True):
                        continue
                    already = await db.reminders_sent.find_one({"user_id": uid, "month": cur_month, "kind": "report"})
                    if already:
                        continue
                    fake = {"user_id": uid, "role": "owner", "allowed_property_ids": None, "permissions": []}
                    try:
                        kpi = await analytics_kpi(month=prev_month, user=fake)
                    except Exception:
                        continue
                    if (kpi.get("totals") or {}).get("reservations", 0) == 0:
                        continue
                    company = _build_company(prefs)
                    base = (await db.channel_settings.find_one({"user_id": uid}) or {}).get("public_base_url", "")
                    logo_url = _logo_url_from_base(base, company)
                    label = kpi.get("period_label") or prev_month
                    html = _monthly_report_html(label, kpi, company, logo_url)
                    try:
                        await send_email(to=email, subject=f"Casanéo — Rapport d'activité {label}", html=html)
                    except Exception as e:
                        logger.warning("email rapport mensuel échoué: %s", e)
                    await db.reminders_sent.update_one(
                        {"user_id": uid, "month": cur_month, "kind": "report"},
                        {"$set": {"user_id": uid, "month": cur_month, "kind": "report",
                                  "sent_at": now_utc().isoformat()}}, upsert=True)
        except Exception:
            logger.exception("monthly report loop error")
        await asyncio.sleep(6 * 3600)



async def shutdown_db_client():
    client.close()
