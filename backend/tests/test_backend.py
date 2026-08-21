"""Backend integration tests for StayPilot."""
import os
from datetime import date, timedelta

import pytest

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://rental-hub-manager.preview.emergentagent.com",
).rstrip("/")


# ---------------------------------------------------------------- Auth guard --
PROTECTED = [
    ("GET", "/api/auth/me"),
    ("GET", "/api/properties"),
    ("POST", "/api/properties"),
    ("GET", "/api/properties/x"),
    ("PUT", "/api/properties/x"),
    ("DELETE", "/api/properties/x"),
    ("GET", "/api/reservations"),
    ("POST", "/api/reservations"),
    ("PUT", "/api/reservations/x"),
    ("PATCH", "/api/reservations/x/status"),
    ("DELETE", "/api/reservations/x"),
    ("GET", "/api/dashboard"),
    ("POST", "/api/ai/guest-reply"),
    ("POST", "/api/ai/pricing-suggestion"),
]


@pytest.mark.parametrize("method,path", PROTECTED)
def test_endpoints_require_auth(anon_client, method, path):
    r = anon_client.request(method, f"{BASE_URL}{path}", json={})
    assert r.status_code == 401, f"{method} {path} -> {r.status_code} (expected 401)"


def test_auth_session_bad_id(anon_client):
    r = anon_client.post(f"{BASE_URL}/api/auth/session", json={"session_id": "invalid_session_xyz"})
    assert r.status_code == 401


# ---------------------------------------------------------------- Auth /me ----
def test_auth_me_returns_user(api_client, test_user):
    r = api_client.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 200
    data = r.json()
    assert data["user_id"] == test_user["user_id"]
    assert data["email"] == test_user["email"]


# ---------------------------------------------------------------- Properties -
class TestProperties:
    def test_list_empty(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/properties")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_full_crud_with_nested(self, api_client):
        payload = {
            "name": "TEST_Villa",
            "location": "Nice",
            "base_price": 120,
            "capacity": 4,
            "bedrooms": 2,
            "seasons": [
                {"name": "Haute", "start_date": "2025-07-01", "end_date": "2025-08-31", "price": 200}
            ],
            "ical_links": [{"platform": "Airbnb", "url": "https://airbnb.com/x.ics"}],
        }
        r = api_client.post(f"{BASE_URL}/api/properties", json=payload)
        assert r.status_code == 200, r.text
        prop = r.json()
        pid = prop["id"]
        assert prop["name"] == "TEST_Villa"
        assert len(prop["seasons"]) == 1
        assert len(prop["ical_links"]) == 1
        assert "_id" not in prop

        # GET verify persistence
        r = api_client.get(f"{BASE_URL}/api/properties/{pid}")
        assert r.status_code == 200
        assert r.json()["id"] == pid

        # PUT update seasons & ical_links
        payload["name"] = "TEST_Villa_v2"
        payload["seasons"].append(
            {"name": "Basse", "start_date": "2025-01-01", "end_date": "2025-03-31", "price": 80}
        )
        r = api_client.put(f"{BASE_URL}/api/properties/{pid}", json=payload)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Villa_v2"
        assert len(r.json()["seasons"]) == 2

        # GET re-verify
        r = api_client.get(f"{BASE_URL}/api/properties/{pid}")
        assert len(r.json()["seasons"]) == 2

        # DELETE
        r = api_client.delete(f"{BASE_URL}/api/properties/{pid}")
        assert r.status_code == 200
        r = api_client.get(f"{BASE_URL}/api/properties/{pid}")
        assert r.status_code == 404

    def test_get_nonexistent(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/properties/does-not-exist")
        assert r.status_code == 404


# ---------------------------------------------------------------- Reservations
@pytest.fixture
def sample_property(api_client):
    r = api_client.post(f"{BASE_URL}/api/properties", json={
        "name": "TEST_ResProp", "location": "Paris", "base_price": 100,
        "capacity": 2, "bedrooms": 1,
    })
    assert r.status_code == 200
    return r.json()


class TestReservations:
    def test_reservation_crud_and_filters(self, api_client, sample_property):
        today = date.today().isoformat()
        tomorrow = (date.today() + timedelta(days=3)).isoformat()
        payload = {
            "property_id": sample_property["id"],
            "guest_name": "TEST_Alice",
            "guest_email": "alice@test.com",
            "platform": "Airbnb",
            "check_in": today,
            "check_out": tomorrow,
            "guests": 2,
            "total_price": 300,
            "status": "confirmee",
        }
        r = api_client.post(f"{BASE_URL}/api/reservations", json=payload)
        assert r.status_code == 200, r.text
        res = r.json()
        rid = res["id"]

        # Filters
        r = api_client.get(f"{BASE_URL}/api/reservations?status=confirmee")
        assert r.status_code == 200
        assert any(x["id"] == rid for x in r.json())

        r = api_client.get(f"{BASE_URL}/api/reservations?property_id={sample_property['id']}")
        assert any(x["id"] == rid for x in r.json())

        # PUT full update
        payload["guest_name"] = "TEST_Bob"
        r = api_client.put(f"{BASE_URL}/api/reservations/{rid}", json=payload)
        assert r.status_code == 200
        assert r.json()["guest_name"] == "TEST_Bob"

        # PATCH status
        r = api_client.patch(f"{BASE_URL}/api/reservations/{rid}/status",
                             json={"status": "arrivee"})
        assert r.status_code == 200
        assert r.json()["status"] == "arrivee"

        # invalid status
        r = api_client.patch(f"{BASE_URL}/api/reservations/{rid}/status",
                             json={"status": "bogus"})
        assert r.status_code == 400

        # DELETE
        r = api_client.delete(f"{BASE_URL}/api/reservations/{rid}")
        assert r.status_code == 200

    def test_reservation_update_nonexistent(self, api_client):
        r = api_client.patch(f"{BASE_URL}/api/reservations/nope/status",
                             json={"status": "confirmee"})
        assert r.status_code == 404


# ---------------------------------------------------------------- Dashboard --
class TestDashboard:
    def test_dashboard_shape(self, api_client, sample_property):
        today = date.today().isoformat()
        api_client.post(f"{BASE_URL}/api/reservations", json={
            "property_id": sample_property["id"],
            "guest_name": "TEST_Arrival",
            "check_in": today,
            "check_out": (date.today() + timedelta(days=2)).isoformat(),
            "total_price": 200,
            "status": "confirmee",
        })
        api_client.post(f"{BASE_URL}/api/reservations", json={
            "property_id": sample_property["id"],
            "guest_name": "TEST_Departure",
            "check_in": (date.today() - timedelta(days=3)).isoformat(),
            "check_out": today,
            "total_price": 150,
            "status": "depart",
        })
        r = api_client.get(f"{BASE_URL}/api/dashboard")
        assert r.status_code == 200
        d = r.json()
        for k in ("occupancy_rate", "revenue_month", "total_properties",
                  "upcoming_count", "arrivals_today", "departures_today"):
            assert k in d, f"missing {k}"
        assert isinstance(d["arrivals_today"], list)
        assert isinstance(d["departures_today"], list)
        assert any(x["guest_name"] == "TEST_Arrival" for x in d["arrivals_today"])
        assert any(x["guest_name"] == "TEST_Departure" for x in d["departures_today"])


# ---------------------------------------------------------------- AI ---------
class TestAI:
    def test_guest_reply(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/ai/guest-reply", json={
            "guest_message": "Bonjour, le logement dispose-t-il d'une piscine ?",
            "tone": "chaleureux",
        }, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "reply" in body
        assert isinstance(body["reply"], str)
        assert len(body["reply"]) > 5

    def test_pricing_suggestion(self, api_client, sample_property):
        r = api_client.post(f"{BASE_URL}/api/ai/pricing-suggestion", json={
            "property_id": sample_property["id"],
            "period": "juillet 2025",
        }, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "suggestion" in body
        assert len(body["suggestion"]) > 5

    def test_pricing_suggestion_bad_property(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/ai/pricing-suggestion", json={
            "property_id": "does-not-exist",
            "period": "test",
        })
        assert r.status_code == 404


# ---------------------------------------------------------------- Isolation --
def test_data_isolation(api_client, anon_client, test_user):
    # Property created by test_user should not leak without token.
    r = api_client.post(f"{BASE_URL}/api/properties", json={"name": "TEST_Iso"})
    pid = r.json()["id"]
    try:
        r = anon_client.get(f"{BASE_URL}/api/properties/{pid}")
        assert r.status_code == 401
    finally:
        api_client.delete(f"{BASE_URL}/api/properties/{pid}")


def test_logout(anon_client, test_user):
    """Use a dedicated throwaway session so we don't invalidate the shared fixture."""
    import uuid as _uuid
    from datetime import datetime as _dt, timezone as _tz, timedelta as _td
    from motor.motor_asyncio import AsyncIOMotorClient
    import asyncio as _aio

    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    _db = mongo[os.environ["DB_NAME"]]
    tok = f"tst_logout_{_uuid.uuid4().hex}"

    async def _seed():
        await _db.user_sessions.insert_one({
            "session_token": tok,
            "user_id": test_user["user_id"],
            "created_at": _dt.now(_tz.utc),
            "expires_at": _dt.now(_tz.utc) + _td(days=1),
        })

    _aio.get_event_loop().run_until_complete(_seed()) if False else _aio.new_event_loop().run_until_complete(_seed())
    anon_client.headers.update({"Authorization": f"Bearer {tok}"})
    r = anon_client.post(f"{BASE_URL}/api/auth/logout")
    assert r.status_code == 200
    r = anon_client.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 401
    mongo.close()
