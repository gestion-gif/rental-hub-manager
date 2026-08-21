import os
import uuid
import asyncio
from datetime import datetime, timezone, timedelta

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL"
) else None

# fall back to reading frontend/.env for BASE_URL if backend .env doesn't have it
if not BASE_URL:
    fe_env = Path(__file__).parent.parent.parent / "frontend" / ".env"
    for line in fe_env.read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
def test_user(event_loop):
    """Create a fake user + session_token directly in Mongo, bypassing Google OAuth."""
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    user_id = f"user_TEST_{uuid.uuid4().hex[:8]}"
    email = f"TEST_{uuid.uuid4().hex[:6]}@staypilot.test"
    session_token = f"tst_{uuid.uuid4().hex}"

    async def setup():
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": "Test User",
            "picture": "",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await db.user_sessions.insert_one({
            "session_token": session_token,
            "user_id": user_id,
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        })

    async def teardown():
        await db.reservations.delete_many({"user_id": user_id})
        await db.properties.delete_many({"user_id": user_id})
        await db.user_sessions.delete_many({"user_id": user_id})
        await db.users.delete_one({"user_id": user_id})
        client.close()

    event_loop.run_until_complete(setup())
    yield {"user_id": user_id, "email": email, "session_token": session_token}
    event_loop.run_until_complete(teardown())


@pytest.fixture
def api_client(test_user):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {test_user['session_token']}",
    })
    return s


@pytest.fixture
def anon_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s
