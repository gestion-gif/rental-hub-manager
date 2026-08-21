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
    ("GET", "/api/interventions"),
    ("POST", "/api/interventions"),
    ("PUT", "/api/interventions/x"),
    ("DELETE", "/api/interventions/x"),
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
                  "upcoming_count", "arrivals_today", "departures_today",
                  "current_stays"):
            assert k in d, f"missing {k}"
        assert isinstance(d["arrivals_today"], list)
        assert isinstance(d["departures_today"], list)
        assert isinstance(d["current_stays"], list)
        assert any(x["guest_name"] == "TEST_Arrival" for x in d["arrivals_today"])
        assert any(x["guest_name"] == "TEST_Departure" for x in d["departures_today"])
        # Field enrichment on arrivals/departures items
        for item in d["arrivals_today"] + d["departures_today"]:
            for f in ("property_name", "guest_name", "check_in", "check_out",
                      "guests", "platform", "status"):
                assert f in item, f"arrival/departure item missing {f}"


class TestDashboardCurrentStays:
    """current_stays: reservations where check_in <= today < check_out (annulee excluded)."""

    def test_current_stays_full_scenario(self, api_client, sample_property):
        today = date.today()
        pid = sample_property["id"]

        # 1) Active-now (started yesterday, ends in 3 days)
        active = api_client.post(f"{BASE_URL}/api/reservations", json={
            "property_id": pid,
            "guest_name": "TEST_ActiveNow",
            "guest_email": "active@t.com",
            "platform": "Airbnb",
            "check_in": (today - timedelta(days=2)).isoformat(),
            "check_out": (today + timedelta(days=3)).isoformat(),
            "guests": 3,
            "total_price": 500,
            "status": "confirmee",
        }).json()
        # 2) Arriving today
        arriving = api_client.post(f"{BASE_URL}/api/reservations", json={
            "property_id": pid,
            "guest_name": "TEST_ArrivesToday",
            "platform": "Booking.com",
            "check_in": today.isoformat(),
            "check_out": (today + timedelta(days=2)).isoformat(),
            "guests": 2,
            "total_price": 300,
            "status": "confirmee",
        }).json()
        # 3) Departing today
        departing = api_client.post(f"{BASE_URL}/api/reservations", json={
            "property_id": pid,
            "guest_name": "TEST_DepartsToday",
            "platform": "Direct",
            "check_in": (today - timedelta(days=4)).isoformat(),
            "check_out": today.isoformat(),
            "guests": 4,
            "total_price": 700,
            "status": "depart",
        }).json()
        # 4) Cancelled but would otherwise be active-now -> EXCLUDED everywhere
        cancelled = api_client.post(f"{BASE_URL}/api/reservations", json={
            "property_id": pid,
            "guest_name": "TEST_CancelledActive",
            "platform": "Airbnb",
            "check_in": (today - timedelta(days=1)).isoformat(),
            "check_out": (today + timedelta(days=2)).isoformat(),
            "guests": 1,
            "total_price": 200,
            "status": "annulee",
        }).json()
        # 5) Future -> not in current_stays
        future = api_client.post(f"{BASE_URL}/api/reservations", json={
            "property_id": pid,
            "guest_name": "TEST_Future",
            "platform": "Vrbo",
            "check_in": (today + timedelta(days=5)).isoformat(),
            "check_out": (today + timedelta(days=8)).isoformat(),
            "guests": 2,
            "total_price": 400,
            "status": "confirmee",
        }).json()

        try:
            r = api_client.get(f"{BASE_URL}/api/dashboard")
            assert r.status_code == 200
            d = r.json()

            current = d["current_stays"]
            names = {x["guest_name"] for x in current}
            # Active-now AND arriving-today (checkin<=today<checkout) must be in current
            assert "TEST_ActiveNow" in names
            assert "TEST_ArrivesToday" in names
            # Departing-today excluded (today == checkout, not < checkout)
            assert "TEST_DepartsToday" not in names
            # Cancelled excluded even though it overlaps
            assert "TEST_CancelledActive" not in names
            # Future excluded
            assert "TEST_Future" not in names

            # arrivals_today: only TEST_ArrivesToday (and TEST_ActiveNow started earlier -> not today)
            arrivals_names = {x["guest_name"] for x in d["arrivals_today"]}
            assert "TEST_ArrivesToday" in arrivals_names
            assert "TEST_ActiveNow" not in arrivals_names
            assert "TEST_CancelledActive" not in arrivals_names

            # departures_today: only TEST_DepartsToday
            dep_names = {x["guest_name"] for x in d["departures_today"]}
            assert "TEST_DepartsToday" in dep_names
            assert "TEST_CancelledActive" not in dep_names

            # Verify enriched fields on every current_stays item
            required = ("property_name", "guest_name", "check_in", "check_out",
                        "guests", "platform", "status")
            for item in current:
                for f in required:
                    assert f in item, f"current_stays item missing {f}"
                assert item["status"] != "annulee"
                assert item["property_name"] == sample_property["name"]
                # sanity: check_in <= today < check_out
                assert item["check_in"] <= today.isoformat() < item["check_out"]

            # Specific value checks on the ActiveNow entry
            active_item = next(x for x in current if x["guest_name"] == "TEST_ActiveNow")
            assert active_item["platform"] == "Airbnb"
            assert active_item["guests"] == 3
            assert active_item["property_name"] == sample_property["name"]

            # current_stays is sorted by check_out ascending
            checkouts = [x["check_out"] for x in current]
            assert checkouts == sorted(checkouts), f"current_stays not sorted by check_out: {checkouts}"

            # Regression: all top-level keys still present and typed correctly
            assert isinstance(d["occupancy_rate"], int)
            assert isinstance(d["revenue_month"], (int, float))
            assert isinstance(d["total_properties"], int)
            assert isinstance(d["upcoming_count"], int)
            assert d["total_properties"] >= 1
            # future confirmed reservation counts toward upcoming
            assert d["upcoming_count"] >= 1
        finally:
            for res in (active, arriving, departing, cancelled, future):
                api_client.delete(f"{BASE_URL}/api/reservations/{res['id']}")


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
CORE_KEYS = ("demande", "confirmee", "arrivee", "depart", "annulee")


class TestPreferences:
    """Customizable statuses + colors — new schema."""

    def test_get_returns_defaults_shape(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/preferences")
        assert r.status_code == 200, r.text
        data = r.json()
        # New schema: statuses[] + derived status_colors
        assert "statuses" in data and isinstance(data["statuses"], list)
        assert "status_colors" in data
        keys = [s["key"] for s in data["statuses"]]
        for k in CORE_KEYS:
            assert k in keys, f"missing core status {k}"
        for s in data["statuses"]:
            assert set(s.keys()) >= {"key", "label", "color"}
            assert s["color"].startswith("#")
        # Derived colors match statuses
        for s in data["statuses"]:
            assert data["status_colors"][s["key"]] == s["color"]

    def test_put_partial_merges_with_defaults(self, api_client):
        r = api_client.put(f"{BASE_URL}/api/preferences",
                           json={"status_colors": {"demande": "#FF2D55"}})
        assert r.status_code == 200, r.text
        merged = r.json()["status_colors"]
        assert merged["demande"] == "#FF2D55"
        for key in ("confirmee", "arrivee", "depart", "annulee"):
            assert key in merged

    def test_put_custom_status_persists_and_core_retained(self, api_client):
        payload = {"statuses": [
            {"key": "demande", "label": "Demande", "color": "#FF9500"},
            {"key": "confirmee", "label": "Confirmée", "color": "#34C759"},
            {"key": "arrivee", "label": "Arrivée", "color": "#32ADE6"},
            {"key": "depart", "label": "Départ", "color": "#8E8E93"},
            {"key": "annulee", "label": "Annulée", "color": "#FF3B30"},
            {"key": "custom_x", "label": "Ménage", "color": "#AF52DE"},
        ]}
        r = api_client.put(f"{BASE_URL}/api/preferences", json=payload)
        assert r.status_code == 200, r.text
        keys = [s["key"] for s in r.json()["statuses"]]
        assert "custom_x" in keys
        # GET reflects it
        r2 = api_client.get(f"{BASE_URL}/api/preferences")
        assert r2.status_code == 200
        got = {s["key"]: s for s in r2.json()["statuses"]}
        assert got["custom_x"]["label"] == "Ménage"
        assert got["custom_x"]["color"] == "#AF52DE"

    def test_core_keys_always_retained_even_if_omitted(self, api_client):
        """Payload with only a custom status — core 5 must be auto-preserved."""
        payload = {"statuses": [
            {"key": "custom_only", "label": "Perso", "color": "#000000"},
        ]}
        r = api_client.put(f"{BASE_URL}/api/preferences", json=payload)
        assert r.status_code == 200, r.text
        keys = {s["key"] for s in r.json()["statuses"]}
        for k in CORE_KEYS:
            assert k in keys, f"core {k} was wiped"
        assert "custom_only" in keys


class TestCustomStatusPatch:
    """PATCH /reservations/{id}/status must accept user-defined status keys."""

    def test_patch_accepts_custom_status_from_preferences(self, api_client, sample_property):
        # Register a custom status
        api_client.put(f"{BASE_URL}/api/preferences", json={"statuses": [
            {"key": "custom_menage", "label": "Ménage", "color": "#AF52DE"},
        ]})
        today = date.today().isoformat()
        res = api_client.post(f"{BASE_URL}/api/reservations", json={
            "property_id": sample_property["id"],
            "guest_name": "TEST_CustomPatch",
            "check_in": today,
            "check_out": (date.today() + timedelta(days=1)).isoformat(),
            "status": "confirmee",
        }).json()
        rid = res["id"]
        try:
            r = api_client.patch(f"{BASE_URL}/api/reservations/{rid}/status",
                                 json={"status": "custom_menage"})
            assert r.status_code == 200, r.text
            assert r.json()["status"] == "custom_menage"
            # Unknown key rejected
            r = api_client.patch(f"{BASE_URL}/api/reservations/{rid}/status",
                                 json={"status": "does_not_exist"})
            assert r.status_code == 400
        finally:
            api_client.delete(f"{BASE_URL}/api/reservations/{rid}")

    def test_patch_unknown_reservation_still_404(self, api_client):
        api_client.put(f"{BASE_URL}/api/preferences", json={"statuses": [
            {"key": "custom_menage", "label": "Ménage", "color": "#AF52DE"},
        ]})
        r = api_client.patch(f"{BASE_URL}/api/reservations/nope/status",
                             json={"status": "custom_menage"})
        assert r.status_code == 404


class TestPropertyRichFields:
    """New property fields (owner/surface/address/rooms/amenities/description)."""

    def test_create_and_reput_preserves_all_fields(self, api_client):
        payload = {
            "name": "TEST_Rich",
            "location": "Nice",
            "base_price": 150,
            "capacity": 6,
            "bedrooms": 3,
            "owner": "M. Dupont",
            "surface": 85.5,
            "address": "12 rue de la Mer",
            "postal_code": "06000",
            "city": "Nice",
            "description": "Belle villa avec vue mer",
            "rooms": ["Salon", "Cuisine", "Chambre 1", "Chambre 2"],
            "amenities": ["Wifi", "Piscine", "Parking"],
            "seasons": [{"name": "Haute", "start_date": "2026-07-01",
                         "end_date": "2026-08-31", "price": 250}],
            "ical_links": [{"platform": "Airbnb", "url": "https://x.ics"}],
        }
        r = api_client.post(f"{BASE_URL}/api/properties", json=payload)
        assert r.status_code == 200, r.text
        prop = r.json()
        pid = prop["id"]
        try:
            # All new fields returned by POST
            for k in ("owner", "surface", "address", "postal_code", "city",
                      "description", "rooms", "amenities"):
                assert prop[k] == payload[k], f"POST {k} mismatch: {prop[k]!r}"

            # GET verifies persistence
            got = api_client.get(f"{BASE_URL}/api/properties/{pid}").json()
            assert got["owner"] == "M. Dupont"
            assert got["surface"] == 85.5
            assert got["rooms"] == payload["rooms"]
            assert got["amenities"] == payload["amenities"]
            assert got["description"] == payload["description"]

            # PUT full object with only seasons changed — rich fields must remain
            payload2 = dict(payload)
            payload2["seasons"] = payload["seasons"] + [
                {"name": "Basse", "start_date": "2026-01-01",
                 "end_date": "2026-03-31", "price": 100}
            ]
            r = api_client.put(f"{BASE_URL}/api/properties/{pid}", json=payload2)
            assert r.status_code == 200
            updated = r.json()
            assert len(updated["seasons"]) == 2
            # Verify rich fields NOT wiped
            assert updated["owner"] == "M. Dupont"
            assert updated["surface"] == 85.5
            assert updated["rooms"] == payload["rooms"]
            assert updated["amenities"] == payload["amenities"]

            got2 = api_client.get(f"{BASE_URL}/api/properties/{pid}").json()
            assert got2["owner"] == "M. Dupont"
            assert got2["amenities"] == payload["amenities"]
        finally:
            api_client.delete(f"{BASE_URL}/api/properties/{pid}")

    def test_defaults_applied_when_new_fields_omitted(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/properties",
                            json={"name": "TEST_MinFields"})
        assert r.status_code == 200
        prop = r.json()
        try:
            assert prop["owner"] == ""
            assert prop["surface"] == 0
            assert prop["rooms"] == []
            assert prop["amenities"] == []
            assert prop["description"] == ""
        finally:
            api_client.delete(f"{BASE_URL}/api/properties/{prop['id']}")


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


# ---------------------------------------------------------------- Interventions
class TestInterventions:
    """CRUD for interventions (menage / intervention technique)."""

    def test_interventions_full_crud(self, api_client, sample_property):
        today = date.today()
        pid = sample_property["id"]

        # LIST empty (may contain items from other tests, so just check type)
        r = api_client.get(f"{BASE_URL}/api/interventions")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

        # CREATE menage
        payload = {
            "property_id": pid,
            "kind": "menage",
            "date": (today + timedelta(days=2)).isoformat(),
            "description": "TEST_Menage complet",
            "intervenant": "TEST_Alice",
        }
        r = api_client.post(f"{BASE_URL}/api/interventions", json=payload)
        assert r.status_code == 200, r.text
        iv = r.json()
        assert "id" in iv
        assert "user_id" in iv
        assert "_id" not in iv
        assert iv["kind"] == "menage"
        assert iv["property_id"] == pid
        assert iv["description"] == "TEST_Menage complet"
        assert iv["intervenant"] == "TEST_Alice"
        assert iv["date"] == payload["date"]
        iv_id = iv["id"]

        # CREATE intervention technique
        payload2 = {
            "property_id": pid,
            "kind": "intervention",
            "date": (today + timedelta(days=5)).isoformat(),
            "description": "TEST_Plomberie",
            "intervenant": "TEST_Bob",
        }
        r2 = api_client.post(f"{BASE_URL}/api/interventions", json=payload2)
        assert r2.status_code == 200
        iv2 = r2.json()
        iv2_id = iv2["id"]

        try:
            # LIST includes both, sorted by date asc
            r = api_client.get(f"{BASE_URL}/api/interventions")
            items = [x for x in r.json() if x["id"] in (iv_id, iv2_id)]
            assert len(items) == 2
            # Filter by property_id
            r = api_client.get(f"{BASE_URL}/api/interventions?property_id={pid}")
            ids = {x["id"] for x in r.json()}
            assert iv_id in ids and iv2_id in ids
            for x in r.json():
                assert "_id" not in x
                assert x["property_id"] == pid

            # Filter to a bogus property_id returns none of ours
            r = api_client.get(f"{BASE_URL}/api/interventions?property_id=nope-xyz")
            assert r.status_code == 200
            ids = {x["id"] for x in r.json()}
            assert iv_id not in ids and iv2_id not in ids

            # PUT full update
            payload["description"] = "TEST_Menage updated"
            payload["intervenant"] = "TEST_Charlie"
            r = api_client.put(f"{BASE_URL}/api/interventions/{iv_id}", json=payload)
            assert r.status_code == 200
            updated = r.json()
            assert updated["description"] == "TEST_Menage updated"
            assert updated["intervenant"] == "TEST_Charlie"
            assert "_id" not in updated

            # PUT unknown -> 404
            r = api_client.put(f"{BASE_URL}/api/interventions/nope",
                               json=payload)
            assert r.status_code == 404
        finally:
            # DELETE
            r = api_client.delete(f"{BASE_URL}/api/interventions/{iv_id}")
            assert r.status_code == 200
            r = api_client.delete(f"{BASE_URL}/api/interventions/{iv2_id}")
            assert r.status_code == 200

            # verify deletion
            r = api_client.get(f"{BASE_URL}/api/interventions")
            ids = {x["id"] for x in r.json()}
            assert iv_id not in ids and iv2_id not in ids


def test_interventions_scoped_per_user(anon_client, test_user, api_client, sample_property):
    """User B must not see user A's interventions."""
    import uuid as _uuid
    from datetime import datetime as _dt, timezone as _tz, timedelta as _td
    from motor.motor_asyncio import AsyncIOMotorClient
    import asyncio as _aio
    import requests as _rq

    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    _db = mongo[os.environ["DB_NAME"]]
    uid_b = f"user_TEST_ivsco_{_uuid.uuid4().hex[:8]}"
    tok_b = f"tst_ivsco_{_uuid.uuid4().hex}"

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
        await _db.interventions.delete_many({"user_id": uid_b})
        await _db.user_sessions.delete_many({"user_id": uid_b})
        await _db.users.delete_one({"user_id": uid_b})
        mongo.close()

    _loop = _aio.new_event_loop()
    _loop.run_until_complete(seed())
    try:
        # user A creates intervention
        r_a = api_client.post(f"{BASE_URL}/api/interventions", json={
            "property_id": sample_property["id"],
            "kind": "menage",
            "date": (date.today() + timedelta(days=1)).isoformat(),
            "description": "TEST_A only",
            "intervenant": "A",
        })
        assert r_a.status_code == 200
        iv_a_id = r_a.json()["id"]

        # user B lists -> must not see it
        s_b = _rq.Session()
        s_b.headers.update({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {tok_b}",
        })
        r_b = s_b.get(f"{BASE_URL}/api/interventions")
        assert r_b.status_code == 200
        assert all(x["id"] != iv_a_id for x in r_b.json())

        # user B PUT on A's id -> 404
        r_b2 = s_b.put(f"{BASE_URL}/api/interventions/{iv_a_id}", json={
            "property_id": sample_property["id"],
            "kind": "menage",
            "date": (date.today() + timedelta(days=1)).isoformat(),
            "description": "hijack",
            "intervenant": "B",
        })
        assert r_b2.status_code == 404

        api_client.delete(f"{BASE_URL}/api/interventions/{iv_a_id}")
    finally:
        _loop.run_until_complete(cleanup())
        _loop.close()


# ---------------------------------------------------------------- Dashboard interventions
class TestDashboardInterventions:
    """dashboard.interventions = today/future only, enriched with property_name, sorted asc."""

    def test_dashboard_interventions_filter_and_enrichment(self, api_client, sample_property):
        today = date.today()
        pid = sample_property["id"]
        pname = sample_property["name"]

        # Past intervention (must be excluded)
        r_past = api_client.post(f"{BASE_URL}/api/interventions", json={
            "property_id": pid,
            "kind": "menage",
            "date": (today - timedelta(days=2)).isoformat(),
            "description": "TEST_PAST",
            "intervenant": "Past",
        })
        assert r_past.status_code == 200
        past_id = r_past.json()["id"]

        # Today (included)
        r_today = api_client.post(f"{BASE_URL}/api/interventions", json={
            "property_id": pid,
            "kind": "intervention",
            "date": today.isoformat(),
            "description": "TEST_TODAY",
            "intervenant": "Today",
        })
        assert r_today.status_code == 200
        today_id = r_today.json()["id"]

        # Future+ (included, sorted after today)
        r_fut = api_client.post(f"{BASE_URL}/api/interventions", json={
            "property_id": pid,
            "kind": "menage",
            "date": (today + timedelta(days=7)).isoformat(),
            "description": "TEST_FUTURE",
            "intervenant": "Future",
        })
        assert r_fut.status_code == 200
        fut_id = r_fut.json()["id"]

        try:
            r = api_client.get(f"{BASE_URL}/api/dashboard")
            assert r.status_code == 200
            d = r.json()
            assert "interventions" in d
            ivs = d["interventions"]
            assert isinstance(ivs, list)
            our_ivs = [x for x in ivs if x.get("id") in (past_id, today_id, fut_id)]
            our_ids = {x["id"] for x in our_ivs}
            # Past must be excluded, today+future included
            assert past_id not in our_ids
            assert today_id in our_ids
            assert fut_id in our_ids
            # Enriched with property_name
            for x in our_ivs:
                assert x.get("property_name") == pname
                assert "_id" not in x
                assert "kind" in x and "date" in x
            # Sorted asc by date globally (spot-check our two)
            dates = [x["date"] for x in ivs]
            assert dates == sorted(dates), f"interventions not sorted by date asc: {dates}"

            # Regression: other dashboard fields still present
            for k in ("occupancy_rate", "revenue_month", "total_properties",
                      "upcoming_count", "current_stays", "arrivals_today",
                      "departures_today"):
                assert k in d, f"missing regression field {k}"
        finally:
            for _id in (past_id, today_id, fut_id):
                api_client.delete(f"{BASE_URL}/api/interventions/{_id}")


# ---------------------------------------------------------------- Address complement
class TestPropertyAddressComplement:
    def test_address_complement_persists_and_full_put_preserves_all_fields(self, api_client):
        payload = {
            "name": "TEST_AddrCompl",
            "location": "Nice",
            "base_price": 120,
            "capacity": 4,
            "bedrooms": 2,
            "owner": "M. Test",
            "surface": 72.0,
            "address": "10 rue X",
            "postal_code": "06000",
            "city": "Nice",
            "address_complement": "Bat B, 3e etage",
            "rooms": ["Salon", "Parking", "WC"],
            "amenities": ["Wifi", "Bouilloire", "Grille-pain"],
        }
        r = api_client.post(f"{BASE_URL}/api/properties", json=payload)
        assert r.status_code == 200, r.text
        prop = r.json()
        pid = prop["id"]
        try:
            assert prop["address_complement"] == "Bat B, 3e etage"
            # GET verify persistence
            got = api_client.get(f"{BASE_URL}/api/properties/{pid}").json()
            assert got["address_complement"] == "Bat B, 3e etage"
            assert got["rooms"] == payload["rooms"]
            assert got["amenities"] == payload["amenities"]
            assert got["owner"] == "M. Test"
            assert got["surface"] == 72.0

            # Full PUT (as detail screen sends) — nothing must be wiped
            payload2 = dict(payload)
            payload2["description"] = "updated desc"
            r = api_client.put(f"{BASE_URL}/api/properties/{pid}", json=payload2)
            assert r.status_code == 200
            updated = r.json()
            assert updated["address_complement"] == "Bat B, 3e etage"
            assert updated["rooms"] == payload["rooms"]
            assert updated["amenities"] == payload["amenities"]
            assert updated["owner"] == "M. Test"
            assert updated["surface"] == 72.0
            assert updated["description"] == "updated desc"

            got2 = api_client.get(f"{BASE_URL}/api/properties/{pid}").json()
            assert got2["address_complement"] == "Bat B, 3e etage"
            assert got2["rooms"] == payload["rooms"]
            assert got2["amenities"] == payload["amenities"]
        finally:
            api_client.delete(f"{BASE_URL}/api/properties/{pid}")

    def test_address_complement_defaults_to_empty(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/properties",
                            json={"name": "TEST_NoAddrCompl"})
        assert r.status_code == 200
        prop = r.json()
        try:
            assert prop["address_complement"] == ""
        finally:
            api_client.delete(f"{BASE_URL}/api/properties/{prop['id']}")
