from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header, Request
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import json
import asyncio
import logging
import uuid
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
from pwdlib import PasswordHash

from lodgify import (
    LODGIFY_STATUS_MAP, source_label, strip_html,
    LodgifyAdapter, map_lodgify_property,
)
from emailer import send_email, build_invite_email

_pwd = PasswordHash.recommended()
_DUMMY_HASH = _pwd.hash("not-a-real-password")


def hash_password(p: str) -> str:
    return _pwd.hash(p)


def verify_password(p: str, stored: Optional[str]) -> bool:
    return _pwd.verify(p, stored or _DUMMY_HASH)


def norm_email(v: str) -> str:
    return (v or "").strip().lower()


def hash_token(raw: str) -> str:
    return sha256(raw.encode("utf-8")).hexdigest()

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
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


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
    lodgify_id: Optional[str] = None
    owner_id: Optional[str] = None


class ReservationIn(BaseModel):
    property_id: str
    guest_name: str
    guest_email: str = ""
    platform: str = "Direct"
    check_in: str  # YYYY-MM-DD
    check_out: str
    guests: int = 1
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
        return {
            "user_id": member["user_id"],  # data owner (the account that owns the properties)
            "email": member.get("email", ""),
            "name": name or member.get("email", ""),
            "role": "member",
            "member_role": member.get("role", "member"),
            "member_id": member["id"],
            "permissions": member.get("permissions", []),
            "allowed_property_ids": member.get("property_ids") or [],
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
DEFAULT_STATUS_COLORS = {
    "demande": "#FF9500", "confirmee": "#34C759", "arrivee": "#32ADE6",
    "depart": "#8E8E93", "annulee": "#FF3B30",
}


async def status_color_map(uid: str):
    doc = await db.preferences.find_one({"user_id": uid}, {"_id": 0})
    m = {s["key"]: s["color"] for s in _build_statuses(doc)}
    for k, v in DEFAULT_STATUS_COLORS.items():
        m.setdefault(k, v)
    return m


def compute_display(r: dict, cmap: dict):
    """Attach display_status/display_color driven by dates (arrivée/départ) + markers."""
    status = r.get("status")
    today = date.today()

    def p(d):
        try:
            return date.fromisoformat(d)
        except Exception:
            return None

    ci, co = p(r.get("check_in")), p(r.get("check_out"))
    if status == "annulee":
        ds, color = "annulee", cmap.get("annulee")
    elif ci and co:
        if today < ci:
            ds = status
            color = r.get("marker_color") or cmap.get(status)
        elif today < co:
            ds, color = "arrivee", cmap.get("arrivee")
        else:
            ds, color = "depart", cmap.get("depart")
    else:
        ds = status
        color = r.get("marker_color") or cmap.get(status)
    r["display_status"] = ds
    r["display_color"] = color
    return r


def recompute_payment(r: dict):
    """Recompute finance.paid/due from acomptes (payments) + manual full-paid flag."""
    fin = dict(r.get("finance") or {})
    total = float(fin.get("total") or r.get("total_price") or 0)
    payments = r.get("payments") or []
    s = sum(float(p.get("amount") or 0) for p in payments)
    lod = float(fin.get("_lodgify_paid") or 0)
    paid = total if r.get("paid_manual") else max(lod, s)
    if total:
        paid = min(paid, total)
    fin["paid"] = round(paid, 2)
    fin["due"] = round(max(0.0, total - paid), 2)
    r["finance"] = fin
    return total > 0 and paid + 0.01 >= total


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
    total = float(doc.get("total_price") or 0)
    doc["finance"] = {"total": total, "paid": 0.0, "due": total, "currency": "EUR"}
    doc["payments"] = []
    await db.reservations.insert_one(doc)
    doc.pop("_id", None)
    await ensure_cleaning(user["user_id"], doc["property_id"], doc.get("check_out"), doc.get("status"))
    return doc


@api_router.put("/reservations/{reservation_id}")
async def update_reservation(reservation_id: str, payload: ReservationIn, user=Depends(get_current_user)):
    res = await db.reservations.update_one(
        {"id": reservation_id, "user_id": user["user_id"]},
        {"$set": payload.dict()},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Reservation not found")
    item = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    # Réservations manuelles : garder finance.total aligné sur le prix total
    if item.get("source") != "lodgify":
        fin = dict(item.get("finance") or {})
        fin["total"] = float(item.get("total_price") or 0)
        item["finance"] = fin
        recompute_payment(item)
        await db.reservations.update_one(
            {"id": reservation_id, "user_id": user["user_id"]},
            {"$set": {"finance": item["finance"]}})
        item = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    await ensure_cleaning(user["user_id"], item["property_id"], item.get("check_out"), item.get("status"))
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


@api_router.delete("/reservations/{reservation_id}")
async def delete_reservation(reservation_id: str, user=Depends(get_current_user)):
    await db.reservations.delete_one({"id": reservation_id, "user_id": user["user_id"]})
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
def _unfold_ical(text: str):
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out = []
    for ln in lines:
        if ln[:1] in (" ", "\t") and out:
            out[-1] += ln[1:]
        else:
            out.append(ln)
    return out


def _parse_ical_date(val: str):
    m = re.search(r"(\d{8})", val)
    if not m:
        return None
    s = m.group(1)
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"


def parse_ical(text: str):
    events = []
    cur = None
    for ln in _unfold_ical(text):
        stripped = ln.strip()
        if stripped == "BEGIN:VEVENT":
            cur = {}
        elif stripped == "END:VEVENT":
            if cur is not None:
                events.append(cur)
            cur = None
        elif cur is not None and ":" in ln:
            key, val = ln.split(":", 1)
            key = key.split(";")[0].upper()
            if key == "DTSTART":
                cur["start"] = _parse_ical_date(val)
            elif key == "DTEND":
                cur["end"] = _parse_ical_date(val)
            elif key == "SUMMARY":
                cur["summary"] = val.strip()
            elif key == "DESCRIPTION":
                cur["description"] = val.strip().replace("\\n", "\n").replace("\\,", ",")
            elif key == "UID":
                cur["uid"] = val.strip()
    return events


_BLOCK_SUMMARIES = {
    "reserved", "not available", "closed", "blocked", "unavailable",
    "airbnb (not available)", "closed - not available", "busy",
}


@api_router.post("/properties/{property_id}/sync")
async def sync_ical(property_id: str, user=Depends(get_current_user)):
    prop = await db.properties.find_one({"id": property_id, "user_id": user["user_id"]}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    links = prop.get("ical_links") or []
    if not links:
        return {"imported": 0, "updated": 0, "errors": ["Aucun lien iCal configuré"]}

    imported = 0
    updated = 0
    errors = []
    details = []
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15",
        "Accept": "text/calendar, text/plain, */*",
    }
    async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers=headers) as http:
        for link in links:
            platform = link.get("platform", "iCal")
            url = link.get("url", "").strip()
            if url.startswith("webcal://"):
                url = "https://" + url[len("webcal://"):]
            link_imported = 0
            link_updated = 0
            try:
                resp = await http.get(url)
                body = resp.text
                looks_ical = "BEGIN:VCALENDAR" in body or "BEGIN:VEVENT" in body
                logger.info(
                    "iCal sync %s: url=%s status=%s len=%s ical=%s",
                    platform, url[:80], resp.status_code, len(body), looks_ical,
                )
                if resp.status_code != 200:
                    msg = f"{platform}: lien inaccessible (HTTP {resp.status_code})"
                    errors.append(msg)
                    details.append(msg)
                    continue
                if not looks_ical:
                    msg = f"{platform}: le lien ne renvoie pas un calendrier iCal (vérifiez l'URL d'export .ics)"
                    errors.append(msg)
                    details.append(msg)
                    continue
                events = parse_ical(body)
                valid_events = [e for e in events if e.get("start") and e.get("end")]
                logger.info("iCal sync %s: %s events parsed (%s valid)", platform, len(events), len(valid_events))
                feed_uids = []
                for ev in valid_events:
                    uid = ev.get("uid") or f"{platform}-{ev['start']}-{ev['end']}"
                    feed_uids.append(uid)
                    await ensure_cleaning(user["user_id"], property_id, ev.get("end"), "confirmee")
                    summary = (ev.get("summary") or "").strip()
                    description = (ev.get("description") or "").strip()
                    if summary and summary.lower() not in _BLOCK_SUMMARIES:
                        guest = summary
                    else:
                        guest = f"Réservation {platform}"
                    note = f"Importé depuis {platform}"
                    if description:
                        note += f"\n{description}"
                    q = {"user_id": user["user_id"], "property_id": property_id, "ical_uid": uid}
                    existing = await db.reservations.find_one(q)
                    if existing:
                        await db.reservations.update_one(q, {"$set": {
                            "check_in": ev["start"],
                            "check_out": ev["end"],
                            "guest_name": guest,
                            "platform": platform,
                            "notes": note,
                        }})
                        updated += 1
                        link_updated += 1
                    else:
                        await db.reservations.insert_one({
                            "id": str(uuid.uuid4()),
                            "user_id": user["user_id"],
                            "property_id": property_id,
                            "guest_name": guest,
                            "guest_email": "",
                            "platform": platform,
                            "check_in": ev["start"],
                            "check_out": ev["end"],
                            "guests": 1,
                            "total_price": 0,
                            "status": "confirmee",
                            "notes": note,
                            "source": "ical",
                            "ical_uid": uid,
                            "created_at": now_utc().isoformat(),
                        })
                        imported += 1
                        link_imported += 1
                # Remove imported reservations that disappeared from the feed
                await db.reservations.delete_many({
                    "user_id": user["user_id"],
                    "property_id": property_id,
                    "source": "ical",
                    "platform": platform,
                    "ical_uid": {"$nin": feed_uids},
                })
                if len(valid_events) == 0:
                    details.append(f"{platform}: aucune réservation dans le calendrier")
                else:
                    details.append(f"{platform}: {link_imported} importée(s), {link_updated} mise(s) à jour ({len(valid_events)} évènement(s))")
            except Exception as e:
                logger.exception("iCal sync error for %s", platform)
                msg = f"{platform}: erreur ({str(e)[:80]})"
                errors.append(msg)
                details.append(msg)

    return {"imported": imported, "updated": updated, "errors": errors, "details": details}


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
        "revenue_month": round(revenue_month),
        "total_properties": len(props),
        "upcoming_count": upcoming,
        "current_stays": current_stays,
        "arrivals_today": arrivals_today,
        "departures_today": departures_today,
        "interventions": upcoming_interventions,
    }


@api_router.get("/analytics/revenue")
async def analytics_revenue(year: Optional[int] = None, user=Depends(get_current_user)):
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
        "Tu donnes des recommandations de prix concrètes et concises en français, "
        "avec des fourchettes de prix par nuit et un raisonnement bref (saisonnalité, week-ends, événements)."
    )
    chat = make_chat(system, f"pricing_{user['user_id']}")
    period = payload.period or "les prochaines semaines"
    prompt = (
        f"Logement: {prop.get('name')} à {prop.get('location')}, {prop.get('bedrooms')} chambres, "
        f"capacité {prop.get('capacity')}. Prix de base actuel: {prop.get('base_price')}€/nuit.\n"
        f"Donne une recommandation de tarification pour {period}. "
        f"Sois concret avec des chiffres et 3-4 conseils maximum."
    )
    suggestion = await chat.send_message(UserMessage(text=prompt))
    return {"suggestion": suggestion}


# ---------------------------------------------------------------------------
# Preferences (customizable statuses + colors)
# ---------------------------------------------------------------------------
DEFAULT_STATUSES = [
    {"key": "demande", "label": "Demande", "color": "#FF9500"},
    {"key": "confirmee", "label": "Confirmée", "color": "#34C759"},
    {"key": "arrivee", "label": "Arrivée", "color": "#32ADE6"},
    {"key": "depart", "label": "Départ", "color": "#8E8E93"},
    {"key": "annulee", "label": "Annulée", "color": "#FF3B30"},
]
DEFAULT_STATUS_COLORS = {s["key"]: s["color"] for s in DEFAULT_STATUSES}
CORE_STATUS_KEYS = {s["key"] for s in DEFAULT_STATUSES}


class PreferencesIn(BaseModel):
    status_colors: Optional[dict] = None
    statuses: Optional[list] = None
    commission_rates: Optional[dict] = None


DEFAULT_COMMISSION_RATES = {
    "Airbnb": 15.5, "Booking.com": 15.0, "Vrbo": 8.0, "Direct": 0.0, "Site web": 0.0,
}


def _build_commission_rates(doc):
    return {**DEFAULT_COMMISSION_RATES, **((doc or {}).get("commission_rates") or {})}


def _build_statuses(doc):
    """Return the full statuses list for a preferences doc, migrating legacy status_colors."""
    if doc and isinstance(doc.get("statuses"), list) and doc["statuses"]:
        return doc["statuses"]
    colors = (doc or {}).get("status_colors") or {}
    return [{**s, "color": colors.get(s["key"], s["color"])} for s in DEFAULT_STATUSES]


@api_router.get("/preferences")
async def get_preferences(user=Depends(get_current_user)):
    doc = await db.preferences.find_one({"user_id": user["user_id"]}, {"_id": 0})
    statuses = _build_statuses(doc)
    return {
        "statuses": statuses,
        "status_colors": {s["key"]: s["color"] for s in statuses},
        "commission_rates": _build_commission_rates(doc),
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

    await db.preferences.update_one({"user_id": uid}, {"$set": set_doc}, upsert=True)
    doc = await db.preferences.find_one({"user_id": uid}, {"_id": 0})
    statuses = _build_statuses(doc)
    return {
        "statuses": statuses,
        "status_colors": {s["key"]: s["color"] for s in statuses},
        "commission_rates": _build_commission_rates(doc),
    }


# ---------------------------------------------------------------------------
# Channel Manager — Lodgify integration (provider-neutral, swappable to Channex)
# ---------------------------------------------------------------------------
async def get_channel_adapter(user_id: str):
    doc = await db.channel_settings.find_one({"user_id": user_id}, {"_id": 0})
    if not doc or not doc.get("api_key"):
        return None, None
    return LodgifyAdapter(doc["api_key"]), doc


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
    }


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
    uid = user["user_id"]
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
    return {
        "imported": imported, "updated": updated, "unmapped": unmapped,
        "conversations": conversations, "total": len(bookings), "unread": unread_count,
    }


# ---------------------------------------------------------------------------
# Inbox (Boîte de réception) — OTA guest messages via Lodgify threads
# ---------------------------------------------------------------------------
@api_router.get("/inbox")
async def inbox(user=Depends(get_current_user)):
    convs = await db.conversations.find(
        {"user_id": user["user_id"], **_prop_scope(user, "property_id")}, {"_id": 0}).sort("last_activity", -1).to_list(500)
    return convs


@api_router.get("/inbox-unread-count")
async def inbox_unread_count(user=Depends(get_current_user)):
    n = await db.conversations.count_documents({"user_id": user["user_id"], "unread": True})
    return {"count": n}


@api_router.get("/inbox/{thread_uid}")
async def inbox_thread(thread_uid: str, user=Depends(get_current_user)):
    adapter, _ = await get_channel_adapter(user["user_id"])
    if not adapter:
        raise HTTPException(status_code=400, detail="Channel manager non connecté")
    conv = await db.conversations.find_one(
        {"user_id": user["user_id"], "thread_uid": thread_uid}, {"_id": 0})
    async with httpx.AsyncClient(timeout=30) as http:
        thread = await adapter.get_thread(http, thread_uid)
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
    await db.conversations.update_one(
        {"user_id": user["user_id"], "thread_uid": thread_uid},
        {"$set": {"unread": False}})
    return {
        "thread_uid": thread_uid,
        "guest_name": thread.get("guest_name") or (conv or {}).get("guest_name"),
        "property_name": (conv or {}).get("property_name"),
        "source": (conv or {}).get("source"),
        "messages": msgs,
    }


class ReplyIn(BaseModel):
    message: str
    subject: str = ""


@api_router.post("/inbox/{thread_uid}/reply")
async def inbox_reply(thread_uid: str, payload: ReplyIn, user=Depends(get_current_user)):
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
    await db.conversations.update_one(
        {"user_id": user["user_id"], "thread_uid": thread_uid},
        {"$set": {"last_activity": now_utc().isoformat()}})
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


def marker_color_for(markers, tmap):
    best_order, best_color = -1, None
    for k in (markers or []):
        t = tmap.get(k)
        if t and t.get("order", 100) > best_order:
            best_order = t["order"]
            best_color = t["color"]
    return best_color


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


async def run_automations_for_user(uid: str):
    """Send due automatic messages via Lodgify and set the corresponding markers."""
    settings = await db.channel_settings.find_one({"user_id": uid}, {"_id": 0})
    if not settings or not settings.get("api_key"):
        return 0
    templates = await get_templates(uid)
    active = [t for t in templates if t.get("kind") == "message" and t.get("enabled")]
    if not active:
        return 0
    tmap = {t["marker_key"]: t for t in templates}
    adapter = LodgifyAdapter(settings["api_key"])
    props = await db.properties.find({"user_id": uid}, {"_id": 0, "id": 1, "welcome_book_url": 1}).to_list(2000)
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
                        "{welcome_book}", (pmap.get(r.get("property_id"), {}) or {}).get("welcome_book_url", "") or "")
                    try:
                        await adapter.send_message(http, r["lodgify_id"], body, t["name"])
                    except Exception:
                        continue
                    markers.add(t["marker_key"])
                    changed = True
                    sent += 1
            if changed:
                await db.reservations.update_one(
                    {"user_id": uid, "id": r["id"]},
                    {"$set": {"markers": list(markers), "marker_color": marker_color_for(list(markers), tmap)}})
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


# ---------------------------------------------------------------------------
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
