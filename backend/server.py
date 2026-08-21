from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import calendar as pycalendar
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta, date

import httpx
from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')
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
    seasons: List[Season] = []
    ical_links: List[IcalLink] = []


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
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


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
    items = await db.properties.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(500)
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
    item = await db.properties.find_one({"id": property_id, "user_id": user["user_id"]}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Property not found")
    return item


@api_router.put("/properties/{property_id}")
async def update_property(property_id: str, payload: PropertyIn, user=Depends(get_current_user)):
    res = await db.properties.update_one(
        {"id": property_id, "user_id": user["user_id"]},
        {"$set": payload.dict()},
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
@api_router.get("/reservations")
async def list_reservations(status: Optional[str] = None, property_id: Optional[str] = None, user=Depends(get_current_user)):
    query = {"user_id": user["user_id"]}
    if status:
        query["status"] = status
    if property_id:
        query["property_id"] = property_id
    items = await db.reservations.find(query, {"_id": 0}).sort("check_in", 1).to_list(1000)
    return items


@api_router.post("/reservations")
async def create_reservation(payload: ReservationIn, user=Depends(get_current_user)):
    doc = payload.dict()
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    await db.reservations.insert_one(doc)
    doc.pop("_id", None)
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
    return item


@api_router.patch("/reservations/{reservation_id}/status")
async def update_status(reservation_id: str, body: dict, user=Depends(get_current_user)):
    new_status = body.get("status")
    if new_status not in ["demande", "confirmee", "arrivee", "depart", "annulee"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    res = await db.reservations.update_one(
        {"id": reservation_id, "user_id": user["user_id"]},
        {"$set": {"status": new_status}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Reservation not found")
    item = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    return item


@api_router.delete("/reservations/{reservation_id}")
async def delete_reservation(reservation_id: str, user=Depends(get_current_user)):
    await db.reservations.delete_one({"id": reservation_id, "user_id": user["user_id"]})
    return {"ok": True}


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

    props = await db.properties.find({"user_id": uid}, {"_id": 0}).to_list(500)
    reservations = await db.reservations.find({"user_id": uid}, {"_id": 0}).to_list(2000)

    prop_map = {p["id"]: p for p in props}

    def parse(d):
        try:
            return date.fromisoformat(d)
        except Exception:
            return None

    arrivals_today = []
    departures_today = []
    revenue_month = 0.0
    booked_nights = 0

    for r in reservations:
        if r["status"] == "annulee":
            continue
        ci = parse(r.get("check_in"))
        co = parse(r.get("check_out"))
        pname = prop_map.get(r["property_id"], {}).get("name", "Logement")
        r_view = {**r, "property_name": pname}
        if r.get("check_in") == today_str:
            arrivals_today.append(r_view)
        if r.get("check_out") == today_str:
            departures_today.append(r_view)
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

    capacity_nights = max(len(props) * days_in_month, 1)
    occupancy = round(min(booked_nights / capacity_nights * 100, 100))

    upcoming = 0
    for r in reservations:
        ci = parse(r.get("check_in"))
        if ci and ci >= today and r["status"] in ("demande", "confirmee"):
            upcoming += 1

    return {
        "occupancy_rate": occupancy,
        "revenue_month": round(revenue_month),
        "total_properties": len(props),
        "upcoming_count": upcoming,
        "arrivals_today": arrivals_today,
        "departures_today": departures_today,
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


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
