"""
Iteration 10 backend coverage:
- PATCH /api/reservations/{id}/paid (manual paid flag)
- POST/DELETE /api/reservations/{id}/payments (acomptes)
- GET /api/interventions purge des menages passes
- GET /api/dashboard applique la meme purge
- GET /api/reservations expose display_status/display_color
- 401 sans Authorization
"""
import os
import uuid
import asyncio
from datetime import datetime, timezone, timedelta, date

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

# BASE_URL from frontend .env (public backend URL)
_fe_env = Path(__file__).parent.parent.parent / "frontend" / ".env"
BASE_URL = None
for line in _fe_env.read_text().splitlines():
    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
        BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
        break
assert BASE_URL, "BASE_URL missing"

API = f"{BASE_URL}/api"


def _run_mongo(coro_factory):
    """Run a Motor coroutine in a fresh event loop with a fresh client (motor binds to loop)."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    try:
        return loop.run_until_complete(coro_factory(db))
    finally:
        client.close()
        loop.close()


# ---------------------------------------------------------------------------
# Session-scoped seed: user + session token + one reservation + interventions
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def seed():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    user_id = f"user_TEST_iter10_{uuid.uuid4().hex[:6]}"
    session_token = f"tst10_{uuid.uuid4().hex}"
    property_id = f"prop_{uuid.uuid4().hex[:8]}"
    reservation_id = str(uuid.uuid4())

    past_iso = "2025-01-01"
    future_iso = (date.today() + timedelta(days=30)).isoformat()
    today_iso = date.today().isoformat()

    loop = asyncio.new_event_loop()

    async def setup():
        await db.users.insert_one({
            "user_id": user_id,
            "email": f"TEST_{user_id}@local",
            "name": "T10",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await db.user_sessions.insert_one({
            "session_token": session_token,
            "user_id": user_id,
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        })
        await db.properties.insert_one({
            "id": property_id, "user_id": user_id, "name": "P1",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await db.reservations.insert_one({
            "id": reservation_id, "user_id": user_id, "property_id": property_id,
            "guest_name": "Test", "status": "confirmee",
            "check_in": "2026-12-01", "check_out": "2026-12-05",
            "total_price": 500, "source": "lodgify",
            "finance": {"total": 500, "_lodgify_paid": 0, "paid": 0, "due": 500, "currency": "EUR"},
            "markers": [], "payments": [],
        })
        # interventions: 1 menage passé (should be purged), 1 menage futur (keep),
        # 1 intervention passée (keep), 1 caution passée (keep), 1 remise_cles passée (keep)
        await db.interventions.insert_many([
            {"id": str(uuid.uuid4()), "user_id": user_id, "property_id": property_id,
             "kind": "menage", "date": past_iso, "description": "past cleaning", "done": False},
            {"id": str(uuid.uuid4()), "user_id": user_id, "property_id": property_id,
             "kind": "menage", "date": future_iso, "description": "future cleaning", "done": False},
            {"id": str(uuid.uuid4()), "user_id": user_id, "property_id": property_id,
             "kind": "intervention", "date": past_iso, "description": "past intervention", "done": False},
            {"id": str(uuid.uuid4()), "user_id": user_id, "property_id": property_id,
             "kind": "caution", "date": past_iso, "description": "past caution", "done": False},
            {"id": str(uuid.uuid4()), "user_id": user_id, "property_id": property_id,
             "kind": "remise_cles", "date": past_iso, "description": "past remise_cles", "done": False},
            # Additional menage exactly today should survive ( >= today )
            {"id": str(uuid.uuid4()), "user_id": user_id, "property_id": property_id,
             "kind": "menage", "date": today_iso, "description": "today cleaning", "done": False},
        ])

    async def teardown():
        await db.reservations.delete_many({"user_id": user_id})
        await db.properties.delete_many({"user_id": user_id})
        await db.interventions.delete_many({"user_id": user_id})
        await db.user_sessions.delete_many({"user_id": user_id})
        await db.users.delete_one({"user_id": user_id})
        client.close()

    loop.run_until_complete(setup())
    yield {
        "user_id": user_id, "session_token": session_token,
        "property_id": property_id, "reservation_id": reservation_id,
        "past_iso": past_iso, "future_iso": future_iso, "today_iso": today_iso,
    }
    loop.run_until_complete(teardown())
    loop.close()


@pytest.fixture
def api(seed):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {seed['session_token']}",
    })
    return s


# ---------------------------------------------------------------------------
# 1. PATCH /api/reservations/{id}/paid
# ---------------------------------------------------------------------------
class TestPatchPaid:
    def test_mark_paid_true(self, api, seed):
        rid = seed["reservation_id"]
        r = api.patch(f"{API}/reservations/{rid}/paid", json={"paid": True})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["finance"]["paid"] == 500
        assert d["finance"]["due"] == 0
        assert "paid" in (d.get("markers") or [])
        assert d.get("marker_color")  # non-null
        assert d.get("paid_manual") is True

    def test_mark_paid_false_no_payments(self, api, seed):
        rid = seed["reservation_id"]
        # Ensure no leftover payments
        r = api.patch(f"{API}/reservations/{rid}/paid", json={"paid": False})
        assert r.status_code == 200, r.text
        d = r.json()
        # With no acomptes and paid=false, paid must be 0, due=total
        assert d["finance"]["paid"] == 0
        assert d["finance"]["due"] == 500
        assert "paid" not in (d.get("markers") or [])
        assert d.get("paid_manual") is False


# ---------------------------------------------------------------------------
# 2. POST /api/reservations/{id}/payments  (acomptes)
# ---------------------------------------------------------------------------
class TestPayments:
    def test_first_acompte_partial(self, api, seed):
        rid = seed["reservation_id"]
        # Reset state
        api.patch(f"{API}/reservations/{rid}/paid", json={"paid": False})
        # Clear any pre-existing payments by deleting them
        cur = api.get(f"{API}/reservations", params={"property_id": seed["property_id"]}).json()
        this_res = next(x for x in cur if x["id"] == rid)
        for p in (this_res.get("payments") or []):
            api.delete(f"{API}/reservations/{rid}/payments/{p['id']}")

        r = api.post(f"{API}/reservations/{rid}/payments", json={"amount": 200})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["finance"]["paid"] == 200
        assert d["finance"]["due"] == 300
        assert "paid" not in (d.get("markers") or [])
        assert len(d.get("payments") or []) == 1

    def test_second_acompte_settles(self, api, seed):
        rid = seed["reservation_id"]
        r = api.post(f"{API}/reservations/{rid}/payments", json={"amount": 300})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["finance"]["paid"] == 500
        assert d["finance"]["due"] == 0
        assert "paid" in (d.get("markers") or [])
        assert len(d.get("payments") or []) == 2

    def test_amount_zero_400(self, api, seed):
        rid = seed["reservation_id"]
        r = api.post(f"{API}/reservations/{rid}/payments", json={"amount": 0})
        assert r.status_code == 400

    def test_amount_negative_400(self, api, seed):
        rid = seed["reservation_id"]
        r = api.post(f"{API}/reservations/{rid}/payments", json={"amount": -50})
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# 3. DELETE /api/reservations/{id}/payments/{payment_id}
# ---------------------------------------------------------------------------
class TestDeletePayment:
    def test_delete_recomputes(self, api, seed):
        rid = seed["reservation_id"]
        # Reset paid_manual and wipe payments to have a clean state (self-contained)
        api.patch(f"{API}/reservations/{rid}/paid", json={"paid": False})
        items = api.get(f"{API}/reservations", params={"property_id": seed["property_id"]}).json()
        this_res = next(x for x in items if x["id"] == rid)
        for p in (this_res.get("payments") or []):
            api.delete(f"{API}/reservations/{rid}/payments/{p['id']}")
        # Add two payments (200 + 300 = total 500)
        r1 = api.post(f"{API}/reservations/{rid}/payments", json={"amount": 200})
        assert r1.status_code == 200
        r2 = api.post(f"{API}/reservations/{rid}/payments", json={"amount": 300})
        assert r2.status_code == 200
        payments = r2.json().get("payments") or []
        assert len(payments) == 2
        # Delete the 300 one
        p_to_delete = next(p for p in payments if float(p["amount"]) == 300)
        r = api.delete(f"{API}/reservations/{rid}/payments/{p_to_delete['id']}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["finance"]["paid"] == 200
        assert d["finance"]["due"] == 300
        assert "paid" not in (d.get("markers") or [])
        # Cleanup: delete remaining
        for p in d.get("payments") or []:
            api.delete(f"{API}/reservations/{rid}/payments/{p['id']}")


# ---------------------------------------------------------------------------
# 4. GET /api/interventions — purge of past menage only
# ---------------------------------------------------------------------------
class TestInterventionsPurge:
    def test_past_menage_purged_others_kept(self, api, seed):
        r = api.get(f"{API}/interventions", params={"property_id": seed["property_id"]})
        assert r.status_code == 200, r.text
        items = r.json()
        past = seed["past_iso"]
        # No menage with date < today
        for it in items:
            if it.get("kind") == "menage":
                assert it["date"] >= seed["today_iso"], f"menage past leaked: {it}"
        # But past intervention/caution/remise_cles are still present
        kinds_past = {it["kind"] for it in items if it.get("date") == past}
        assert "intervention" in kinds_past
        assert "caution" in kinds_past
        assert "remise_cles" in kinds_past
        # Future menage still there
        assert any(it["kind"] == "menage" and it["date"] == seed["future_iso"] for it in items)
        # Today's menage kept (>= today)
        assert any(it["kind"] == "menage" and it["date"] == seed["today_iso"] for it in items)


# ---------------------------------------------------------------------------
# 5. GET /api/dashboard applies same purge
# ---------------------------------------------------------------------------
class TestDashboardPurge:
    def test_dashboard_purges_past_menage(self, api, seed):
        # Re-insert a past menage to check purge on this endpoint independently
        async def insert(db):
            await db.interventions.insert_one({
                "id": str(uuid.uuid4()), "user_id": seed["user_id"],
                "property_id": seed["property_id"], "kind": "menage",
                "date": "2024-06-01", "description": "another past cleaning", "done": False,
            })
        _run_mongo(insert)

        r = api.get(f"{API}/dashboard")
        assert r.status_code == 200, r.text
        d = r.json()
        # Interventions in dashboard are upcoming only
        for iv in d.get("interventions") or []:
            assert iv["date"] >= seed["today_iso"]

        # Verify DB actually purged
        async def find_past(db):
            return await db.interventions.find_one({
                "user_id": seed["user_id"], "kind": "menage", "date": "2024-06-01",
            })
        past = _run_mongo(find_past)
        assert past is None, "past menage should be purged by dashboard call"


# ---------------------------------------------------------------------------
# 6. GET /api/reservations exposes display_status/display_color
# ---------------------------------------------------------------------------
class TestReservationDisplay:
    def test_display_fields_present(self, api, seed):
        r = api.get(f"{API}/reservations")
        assert r.status_code == 200, r.text
        items = r.json()
        assert items, "expected at least one reservation"
        for it in items:
            assert "display_status" in it
            assert "display_color" in it
            assert it["display_color"], f"display_color missing on {it['id']}"
        # Our reservation is in future (Dec 2026), status confirmee, so display_status == 'confirmee'
        mine = next(it for it in items if it["id"] == seed["reservation_id"])
        assert mine["display_status"] == "confirmee"

    def test_display_annulee(self, api, seed):
        # Create a cancelled reservation
        rid = str(uuid.uuid4())
        async def insert(db):
            await db.reservations.insert_one({
                "id": rid, "user_id": seed["user_id"], "property_id": seed["property_id"],
                "guest_name": "Cancelled", "status": "annulee",
                "check_in": "2026-01-01", "check_out": "2026-01-05",
                "total_price": 100, "markers": [], "payments": [],
            })
        _run_mongo(insert)

        r = api.get(f"{API}/reservations")
        mine = next(it for it in r.json() if it["id"] == rid)
        assert mine["display_status"] == "annulee"


# ---------------------------------------------------------------------------
# 7. 401 without Authorization
# ---------------------------------------------------------------------------
class TestAuth401:
    endpoints = [
        ("GET", "/reservations"),
        ("PATCH", "/reservations/xxx/paid"),
        ("POST", "/reservations/xxx/payments"),
        ("DELETE", "/reservations/xxx/payments/yyy"),
        ("GET", "/interventions"),
        ("GET", "/dashboard"),
    ]

    def test_no_auth_returns_401(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        for method, path in self.endpoints:
            r = s.request(method, f"{API}{path}", json={} if method in ("PATCH", "POST") else None)
            assert r.status_code == 401, f"{method} {path} -> {r.status_code} (expected 401)"
