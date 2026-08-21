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
    ("GET", "/api/preferences"),
    ("PUT", "/api/preferences"),
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

# ---------------------------------------------------------------- Preferences
class TestPreferences:
    """Customizable status colors — new feature."""

    def test_get_returns_defaults_shape(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/preferences")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "status_colors" in data
        sc = data["status_colors"]
        for key in ("demande", "confirmee", "arrivee", "depart", "annulee"):
            assert key in sc, f"missing status key {key}"
            assert isinstance(sc[key], str) and sc[key].startswith("#")

    def test_put_partial_merges_with_defaults(self, api_client):
        r = api_client.put(f"{BASE_URL}/api/preferences",
                           json={"status_colors": {"demande": "#FF2D55"}})
        assert r.status_code == 200, r.text
        merged = r.json()["status_colors"]
        assert merged["demande"] == "#FF2D55"
        for key in ("confirmee", "arrivee", "depart", "annulee"):
            assert key in merged
        # GET reflects the change.
        r2 = api_client.get(f"{BASE_URL}/api/preferences")
        assert r2.status_code == 200
        assert r2.json()["status_colors"]["demande"] == "#FF2D55"

    def test_put_full_palette_and_persists(self, api_client):
        payload = {
            "status_colors": {
                "demande": "#FFCC00",
                "confirmee": "#30D158",
                "arrivee": "#0A84FF",
                "depart": "#5E5CE6",
                "annulee": "#FF453A",
            }
        }
        r = api_client.put(f"{BASE_URL}/api/preferences", json=payload)
        assert r.status_code == 200
        assert r.json()["status_colors"] == payload["status_colors"]
        r2 = api_client.get(f"{BASE_URL}/api/preferences")
        assert r2.json()["status_colors"] == payload["status_colors"]


def test_preferences_scoped_per_user(anon_client, test_user):
    """Colors saved by user B must not leak into user A's preferences."""
    import uuid as _uuid
    from datetime import datetime as _dt, timezone as _tz, timedelta as _td
    from motor.motor_asyncio import AsyncIOMotorClient
    import asyncio as _aio
    import requests as _rq

    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    _db = mongo[os.environ["DB_NAME"]]
    uid_b = f"user_TEST_prefiso_{_uuid.uuid4().hex[:8]}"
    tok_b = f"tst_prefiso_{_uuid.uuid4().hex}"

    async def seed():
        await _db.users.insert_one({
            "user_id": uid_b, "email": f"{uid_b}@t.test",
            "name": "IsoB", "picture": "",
            "created_at": _dt.now(_tz.utc).isoformat(),
        })
        await _db.user_sessions.insert_one({
            "session_token": tok_b, "user_id": uid_b,
            "created_at": _dt.now(_tz.utc),
            "expires_at": _dt.now(_tz.utc) + _td(days=1),
        })

    async def cleanup():
        await _db.preferences.delete_many({"user_id": uid_b})
        await _db.user_sessions.delete_many({"user_id": uid_b})
        await _db.users.delete_one({"user_id": uid_b})
        mongo.close()

    _loop = _aio.new_event_loop()
    _loop.run_until_complete(seed())
    try:
        # user A resets their preferences to default palette explicitly first.
        s_a = _rq.Session()
        s_a.headers.update({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {test_user['session_token']}",
        })
        s_a.put(f"{BASE_URL}/api/preferences", json={
            "status_colors": {
                "demande": "#FF9500", "confirmee": "#34C759",
                "arrivee": "#32ADE6", "depart": "#8E8E93", "annulee": "#FF3B30",
            }
        })
        # user B sets a distinctive value.
        s_b = _rq.Session()
        s_b.headers.update({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {tok_b}",
        })
        r_b = s_b.put(f"{BASE_URL}/api/preferences",
                      json={"status_colors": {"demande": "#123456"}})
        assert r_b.status_code == 200
        assert r_b.json()["status_colors"]["demande"] == "#123456"

        # user A should NOT see #123456.
        r_a = s_a.get(f"{BASE_URL}/api/preferences")
        assert r_a.status_code == 200
        assert r_a.json()["status_colors"]["demande"] != "#123456"
    finally:
        _loop.run_until_complete(cleanup())
        _loop.close()




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
