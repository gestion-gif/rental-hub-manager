"""Tests for /api/notifications (AI drafts pending validation) + refactor regression.

Scope:
 - GET /api/notifications returns only conversations with ai_draft set and
   ai_draft_validated != true, scoped by user_id.
 - GET /api/notifications/count returns the correct count.
 - Member session with role 'cleaning' (kind:member) is gated → {count:0, items:[]}.
 - Multi-user isolation: another user's conversation must not appear.
 - Regression after helpers.py extraction: /api/properties, /api/reservations,
   /api/preferences, /api/dashboard work for the test owner.

DOES NOT call any endpoint that talks to Lodgify. Conversations, members
and sessions are inserted directly into Mongo and cleaned up at teardown.
"""
import os
import uuid
import asyncio
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


def _read_base_url():
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if not url:
        fe = Path(__file__).parent.parent.parent / "frontend" / ".env"
        for line in fe.read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                url = line.split("=", 1)[1].strip().strip('"')
                break
    return (url or "").rstrip("/")


BASE_URL = _read_base_url()


# ---------------------------------------------------------------------------
# Fixture: two owners + one 'cleaning' member scoped to owner1
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def notif_ctx():
    """Seed owner1, owner2, one cleaning member of owner1, plus 4 conversations.

    Returns tokens + ids and cleans everything up (prefix TEST_) afterwards.
    """
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    loop = asyncio.new_event_loop()

    owner1_id = f"user_TEST_{uuid.uuid4().hex[:8]}"
    owner2_id = f"user_TEST_{uuid.uuid4().hex[:8]}"
    owner1_token = f"tst_{uuid.uuid4().hex}"
    owner2_token = f"tst_{uuid.uuid4().hex}"
    member_id = f"mbr_TEST_{uuid.uuid4().hex[:8]}"
    member_token = f"tst_{uuid.uuid4().hex}"
    prop1_id = f"prop_TEST_{uuid.uuid4().hex[:8]}"

    now = datetime.now(timezone.utc)
    future = now + timedelta(days=7)

    async def setup():
        await db.users.insert_many([
            {"user_id": owner1_id, "email": f"TEST_o1_{uuid.uuid4().hex[:4]}@sp.test",
             "name": "TEST Owner1", "created_at": now.isoformat()},
            {"user_id": owner2_id, "email": f"TEST_o2_{uuid.uuid4().hex[:4]}@sp.test",
             "name": "TEST Owner2", "created_at": now.isoformat()},
        ])
        await db.user_sessions.insert_many([
            {"session_token": owner1_token, "user_id": owner1_id,
             "created_at": now, "expires_at": future},
            {"session_token": owner2_token, "user_id": owner2_id,
             "created_at": now, "expires_at": future},
            # Member session (kind=member) bound to owner1
            {"session_token": member_token, "user_id": owner1_id, "kind": "member",
             "member_id": member_id, "created_at": now, "expires_at": future},
        ])
        # Cleaning member of owner1
        await db.members.insert_one({
            "id": member_id, "user_id": owner1_id, "email": "TEST_cleaner@sp.test",
            "first_name": "TEST", "last_name": "Cleaner", "role": "cleaning",
            "active": True, "permissions": [], "property_ids": [prop1_id],
        })
        # A property for owner1 (so member scope + owner endpoints work)
        await db.properties.insert_one({
            "id": prop1_id, "user_id": owner1_id, "name": "TEST Villa",
            "location": "TestCity", "base_price": 100, "capacity": 4, "bedrooms": 2,
            "seasons": [], "ical_links": [], "created_at": now.isoformat(),
        })
        # Conversations:
        #  A) owner1 - ai_draft set, not validated → should APPEAR
        #  B) owner1 - ai_draft set but validated=true → should NOT appear
        #  C) owner1 - no ai_draft (empty string) → should NOT appear
        #  D) owner2 - ai_draft set, not validated → belongs to owner2 only
        await db.conversations.insert_many([
            {"user_id": owner1_id, "thread_uid": "TEST_thread_A",
             "guest_name": "Alice", "property_name": "TEST Villa", "source": "Airbnb",
             "ai_draft": "Bonjour Alice, merci pour votre message.",
             "ai_draft_validated": False,
             "ai_draft_at": (now - timedelta(minutes=5)).isoformat(),
             "property_id": prop1_id},
            {"user_id": owner1_id, "thread_uid": "TEST_thread_B",
             "guest_name": "Bob", "property_name": "TEST Villa", "source": "Booking",
             "ai_draft": "Déjà validé", "ai_draft_validated": True,
             "ai_draft_at": (now - timedelta(minutes=10)).isoformat(),
             "property_id": prop1_id},
            {"user_id": owner1_id, "thread_uid": "TEST_thread_C",
             "guest_name": "Carol", "property_name": "TEST Villa", "source": "Direct",
             "ai_draft": "", "ai_draft_validated": False,
             "property_id": prop1_id},
            {"user_id": owner2_id, "thread_uid": "TEST_thread_D",
             "guest_name": "Dan", "property_name": "Autre", "source": "Airbnb",
             "ai_draft": "Ne doit pas fuiter", "ai_draft_validated": False,
             "ai_draft_at": now.isoformat()},
        ])

    async def teardown():
        await db.conversations.delete_many({"thread_uid": {"$regex": "^TEST_"}})
        await db.properties.delete_many({"id": prop1_id})
        await db.members.delete_one({"id": member_id})
        await db.user_sessions.delete_many(
            {"session_token": {"$in": [owner1_token, owner2_token, member_token]}})
        await db.users.delete_many({"user_id": {"$in": [owner1_id, owner2_id]}})
        client.close()

    loop.run_until_complete(setup())
    yield {
        "owner1_id": owner1_id, "owner2_id": owner2_id,
        "owner1_token": owner1_token, "owner2_token": owner2_token,
        "member_token": member_token, "prop1_id": prop1_id,
    }
    loop.run_until_complete(teardown())
    loop.close()


def _client(token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json",
                      "Authorization": f"Bearer {token}"})
    return s


# ---------------------------------------------------------------------------
# Notifications tests
# ---------------------------------------------------------------------------
class TestNotifications:
    def test_owner_sees_only_pending_drafts(self, notif_ctx):
        c = _client(notif_ctx["owner1_token"])
        r = c.get(f"{BASE_URL}/api/notifications")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "count" in data and "items" in data
        thread_uids = [it["thread_uid"] for it in data["items"]]
        # A is the only owner1 conv with ai_draft set and not validated
        assert "TEST_thread_A" in thread_uids
        # Validated / empty-draft conversations must not appear
        assert "TEST_thread_B" not in thread_uids
        assert "TEST_thread_C" not in thread_uids
        # Owner2's conversation must not leak
        assert "TEST_thread_D" not in thread_uids
        # count matches items length
        assert data["count"] == len(data["items"])
        # Item shape sanity
        item_a = next(it for it in data["items"] if it["thread_uid"] == "TEST_thread_A")
        assert item_a["guest_name"] == "Alice"
        assert item_a["ai_draft"].startswith("Bonjour Alice")
        assert item_a.get("ai_draft_at")

    def test_owner_count_matches(self, notif_ctx):
        c = _client(notif_ctx["owner1_token"])
        r = c.get(f"{BASE_URL}/api/notifications/count")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "count" in data
        # We seeded exactly one pending draft for owner1
        assert data["count"] == 1

    def test_other_user_isolation(self, notif_ctx):
        """Owner2 should only see their own conversation (thread_D)."""
        c = _client(notif_ctx["owner2_token"])
        r = c.get(f"{BASE_URL}/api/notifications")
        assert r.status_code == 200, r.text
        data = r.json()
        thread_uids = [it["thread_uid"] for it in data["items"]]
        assert "TEST_thread_D" in thread_uids
        for forbidden in ("TEST_thread_A", "TEST_thread_B", "TEST_thread_C"):
            assert forbidden not in thread_uids

        r2 = c.get(f"{BASE_URL}/api/notifications/count")
        assert r2.status_code == 200
        assert r2.json()["count"] == 1

    def test_cleaning_member_gate(self, notif_ctx):
        """Member with role='cleaning' must receive {count:0, items:[]}."""
        c = _client(notif_ctx["member_token"])
        r = c.get(f"{BASE_URL}/api/notifications")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data == {"count": 0, "items": []}

        r2 = c.get(f"{BASE_URL}/api/notifications/count")
        assert r2.status_code == 200
        assert r2.json() == {"count": 0}

    def test_notifications_requires_auth(self, notif_ctx):
        s = requests.Session()
        r = s.get(f"{BASE_URL}/api/notifications")
        assert r.status_code == 401
        r2 = s.get(f"{BASE_URL}/api/notifications/count")
        assert r2.status_code == 401


# ---------------------------------------------------------------------------
# Regression after helpers.py refactor
# ---------------------------------------------------------------------------
class TestRefactorRegression:
    def test_properties_list(self, notif_ctx):
        c = _client(notif_ctx["owner1_token"])
        r = c.get(f"{BASE_URL}/api/properties")
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list)
        assert any(p["id"] == notif_ctx["prop1_id"] for p in items), \
            "Seeded TEST Villa must be listed for its owner"

    def test_reservations_list(self, notif_ctx):
        c = _client(notif_ctx["owner1_token"])
        r = c.get(f"{BASE_URL}/api/reservations")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_preferences_default_shape(self, notif_ctx):
        c = _client(notif_ctx["owner1_token"])
        r = c.get(f"{BASE_URL}/api/preferences")
        assert r.status_code == 200, r.text
        data = r.json()
        # Must include the 4 keys built by helpers._build_*
        for k in ("statuses", "status_colors", "commission_rates", "payment_methods"):
            assert k in data, f"Missing key {k}"
        # Core statuses preserved after refactor
        keys = {s["key"] for s in data["statuses"]}
        assert {"demande", "confirmee", "arrivee", "depart", "annulee"}.issubset(keys)

    def test_dashboard_shape(self, notif_ctx):
        c = _client(notif_ctx["owner1_token"])
        r = c.get(f"{BASE_URL}/api/dashboard")
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("occupancy_rate", "total_properties", "upcoming_count",
                  "current_stays", "arrivals_today", "departures_today",
                  "interventions"):
            assert k in data, f"Missing dashboard key {k}"
        # Owner sees revenue_month (permission granted by default)
        assert "revenue_month" in data
        # At least the seeded TEST Villa
        assert data["total_properties"] >= 1
