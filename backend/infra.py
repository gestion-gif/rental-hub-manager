"""Socle applicatif : environnement, MongoDB, app FastAPI, logs, adaptateurs canaux."""
import os
import uuid
import logging
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter
from motor.motor_asyncio import AsyncIOMotorClient

from lodgify import LodgifyAdapter
from channex import ChannexAdapter
from helpers import now_utc

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


async def _sync_log(user_id: str, kind: str, status: str, message: str = "", provider: str = "channex"):
    """Persist a synchronization log entry (SyncLog data-model)."""
    await db.sync_logs.insert_one({
        "id": str(uuid.uuid4()), "user_id": user_id, "provider": provider,
        "type": kind, "status": status, "message": message[:1000],
        "date": now_utc().isoformat(),
    })


async def get_channel_adapter(user_id: str):
    doc = await db.channel_settings.find_one({"user_id": user_id}, {"_id": 0})
    if not doc or not doc.get("api_key"):
        return None, None
    return LodgifyAdapter(doc["api_key"]), doc


async def get_channex_adapter(user_id: str):
    doc = await db.channex_settings.find_one({"user_id": user_id}, {"_id": 0})
    if not doc or not doc.get("api_key"):
        return None, None
    return ChannexAdapter(doc["api_key"], doc.get("environment", "staging")), doc
