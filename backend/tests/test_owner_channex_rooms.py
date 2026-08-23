"""Iteration 20 — Casanéo backend tests

Covers:
 1) Owner statement over month OR range (period_key / period_label / last_sent_at)
 2) Pending-send alert (defaults to previous month)
 3) Rooms / RatePlans / Availability CRUD (Channex-aligned model)
 4) Channex read-only foundation (staging, 0 properties)

NEVER calls /owner-statement/email or /owner-statement/email-all (real emails).
"""
import os
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")


def _base():
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if not url:
        fe_env = Path(__file__).parent.parent.parent / "frontend" / ".env"
        for line in fe_env.read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                url = line.split("=", 1)[1].strip().strip('"')
                break
    return (url or "").rstrip("/")


BASE_URL = _base()
QA_EMAIL = "qa.admin@casaneo.test"
QA_PASSWORD = "CasaneoQA2026!"


@pytest.fixture(scope="module")
def admin_client():
    """Login QA admin (member) and return a requests.Session with Bearer token."""
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": QA_EMAIL, "password": QA_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("session_token")
    assert tok
    s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="module")
def a_property_id(admin_client):
    """Pick the first property visible to QA admin."""
    r = admin_client.get(f"{BASE_URL}/api/properties", timeout=30)
    assert r.status_code == 200, r.text
    props = r.json()
    if isinstance(props, dict):
        props = props.get("properties") or []
    assert props, "QA admin has no property"
    return props[0]["id"]


# -----------------------------------------------------------------------------
# Owner statement — month / range / errors
# -----------------------------------------------------------------------------
class TestOwnerStatement:

    def test_month_period_key_and_label(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/owner-statement", params={"month": "2026-07"}, timeout=45)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["period_key"] == "2026-07"
        assert d["period_label"] == "2026-07"
        assert d["month"] == "2026-07"
        # last_sent_at must exist on every statement (may be null)
        for s in d.get("statements", []):
            assert "last_sent_at" in s

    def test_range_period_key_and_label(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/owner-statement",
                             params={"start": "2026-06-01", "end": "2026-08-31"}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["period_key"] == "2026-06-01_2026-08-31"
        assert d["period_label"] == "01/06/2026 → 31/08/2026"

    def test_range_end_before_start_400(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/owner-statement",
                             params={"start": "2026-08-31", "end": "2026-06-01"}, timeout=30)
        assert r.status_code == 400
        assert "précède" in r.json().get("detail", "")

    def test_invalid_dates_400(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/owner-statement",
                             params={"start": "not-a-date", "end": "not-a-date"}, timeout=30)
        assert r.status_code == 400
        assert "invalides" in r.json().get("detail", "").lower()

    def test_invalid_month_400(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/owner-statement",
                             params={"month": "202607"}, timeout=30)
        assert r.status_code == 400
        assert "invalide" in r.json().get("detail", "").lower()


# -----------------------------------------------------------------------------
# Owner statement — pending-send alert
# -----------------------------------------------------------------------------
class TestPendingSend:

    def test_default_defaults_to_previous_month(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/owner-statement/pending-send", timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        # response shape
        for k in ("month", "period_key", "period_label", "count", "pending"):
            assert k in d, f"missing key {k}"
        assert isinstance(d["pending"], list)
        assert d["count"] == len(d["pending"])
        # each pending row must have the documented fields
        for row in d["pending"]:
            for k in ("property_name", "owner_name", "has_owner_email", "owner_revenue"):
                assert k in row, f"missing {k} in pending row"
            assert isinstance(row["has_owner_email"], bool)

    def test_explicit_month(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/owner-statement/pending-send",
                             params={"month": "2026-07"}, timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d["month"] == "2026-07"
        assert d["period_key"] == "2026-07"


# -----------------------------------------------------------------------------
# Rooms / RatePlans / Availability CRUD
# -----------------------------------------------------------------------------
@pytest.fixture(scope="class")
def room_and_rate(admin_client, a_property_id):
    """Create a TEST_ room + rate plan for the class, cleaned up on teardown."""
    created = {}
    r = admin_client.post(f"{BASE_URL}/api/properties/{a_property_id}/rooms",
                          json={"name": f"TEST_QA_Room_{uuid.uuid4().hex[:6]}",
                                "max_guests": 3, "count_of_rooms": 2}, timeout=30)
    assert r.status_code == 200, r.text
    room = r.json()
    created["room_id"] = room["id"]

    r = admin_client.post(f"{BASE_URL}/api/properties/{a_property_id}/rate-plans",
                          json={"name": f"TEST_QA_Rate_{uuid.uuid4().hex[:6]}",
                                "room_id": room["id"], "base_price": 95.5, "min_stay": 2},
                          timeout=30)
    assert r.status_code == 200, r.text
    rate = r.json()
    created["rate_id"] = rate["id"]

    yield {"property_id": a_property_id, "room": room, "rate": rate}

    # teardown — always try to delete (safe even if already deleted)
    admin_client.delete(f"{BASE_URL}/api/rate-plans/{created['rate_id']}", timeout=30)
    admin_client.delete(f"{BASE_URL}/api/rooms/{created['room_id']}", timeout=30)


class TestRoomsCRUD:

    def test_room_persists_via_list(self, admin_client, room_and_rate):
        pid = room_and_rate["property_id"]
        rid = room_and_rate["room"]["id"]
        r = admin_client.get(f"{BASE_URL}/api/properties/{pid}/rooms", timeout=30)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json().get("rooms", [])]
        assert rid in ids

    def test_update_room(self, admin_client, room_and_rate):
        rid = room_and_rate["room"]["id"]
        r = admin_client.put(f"{BASE_URL}/api/rooms/{rid}",
                             json={"name": "TEST_QA_Room_Updated",
                                   "max_guests": 4, "count_of_rooms": 2}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("name") == "TEST_QA_Room_Updated"
        assert r.json().get("max_guests") == 4

    def test_update_unknown_room_404(self, admin_client):
        r = admin_client.put(f"{BASE_URL}/api/rooms/does-not-exist",
                             json={"name": "x"}, timeout=30)
        assert r.status_code == 404

    def test_delete_unknown_room_404(self, admin_client):
        r = admin_client.delete(f"{BASE_URL}/api/rooms/does-not-exist", timeout=30)
        assert r.status_code == 404


class TestRatePlansCRUD:

    def test_rate_persists_via_list(self, admin_client, room_and_rate):
        pid = room_and_rate["property_id"]
        rpid = room_and_rate["rate"]["id"]
        r = admin_client.get(f"{BASE_URL}/api/properties/{pid}/rate-plans", timeout=30)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json().get("rate_plans", [])]
        assert rpid in ids

    def test_update_rate(self, admin_client, room_and_rate):
        rpid = room_and_rate["rate"]["id"]
        rid = room_and_rate["room"]["id"]
        r = admin_client.put(f"{BASE_URL}/api/rate-plans/{rpid}",
                             json={"name": "TEST_QA_Rate_Updated", "room_id": rid,
                                   "base_price": 110.0, "min_stay": 3}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d.get("name") == "TEST_QA_Rate_Updated"
        assert d.get("base_price") == 110.0
        assert d.get("min_stay") == 3

    def test_update_unknown_rate_404(self, admin_client):
        r = admin_client.put(f"{BASE_URL}/api/rate-plans/nope",
                             json={"name": "x"}, timeout=30)
        assert r.status_code == 404


class TestAvailability:

    def test_set_5_days(self, admin_client, room_and_rate):
        rid = room_and_rate["room"]["id"]
        r = admin_client.post(f"{BASE_URL}/api/rooms/{rid}/availability",
                              json={"date_from": "2026-09-01", "date_to": "2026-09-05",
                                    "is_available": True, "min_stay": 2}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True, "days": 5}

    def test_get_returns_5_days_with_min_stay(self, admin_client, room_and_rate):
        rid = room_and_rate["room"]["id"]
        r = admin_client.get(f"{BASE_URL}/api/rooms/{rid}/availability",
                             params={"start": "2026-09-01", "end": "2026-09-05"}, timeout=30)
        assert r.status_code == 200
        days = r.json().get("availability", [])
        assert len(days) == 5
        assert days[0]["date"] == "2026-09-01"
        assert days[-1]["date"] == "2026-09-05"
        assert all(d["is_available"] is True for d in days)
        assert all(d["min_stay"] == 2 for d in days)

    def test_bad_dates_400(self, admin_client, room_and_rate):
        rid = room_and_rate["room"]["id"]
        r = admin_client.post(f"{BASE_URL}/api/rooms/{rid}/availability",
                              json={"date_from": "not-a-date", "date_to": "not-a-date"}, timeout=30)
        assert r.status_code == 400

    def test_unknown_room_404(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/rooms/nope/availability",
                              json={"date_from": "2026-09-01", "date_to": "2026-09-02"}, timeout=30)
        assert r.status_code == 404


class TestRoomDeleteCleansAvailability:
    """Deleting a room must cascade-delete its availability + rate plans."""

    def test_cascade_cleanup(self, admin_client, a_property_id):
        # local room (independent of the module fixture) so we can DELETE it
        r = admin_client.post(f"{BASE_URL}/api/properties/{a_property_id}/rooms",
                              json={"name": "TEST_QA_RoomCascade", "max_guests": 2,
                                    "count_of_rooms": 1}, timeout=30)
        assert r.status_code == 200
        rid = r.json()["id"]
        admin_client.post(f"{BASE_URL}/api/rooms/{rid}/availability",
                          json={"date_from": "2026-10-01", "date_to": "2026-10-03",
                                "is_available": False}, timeout=30)
        admin_client.post(f"{BASE_URL}/api/properties/{a_property_id}/rate-plans",
                          json={"name": "TEST_QA_RateCascade", "room_id": rid,
                                "base_price": 50}, timeout=30)

        assert admin_client.delete(f"{BASE_URL}/api/rooms/{rid}", timeout=30).status_code == 200

        # availability empty
        av = admin_client.get(f"{BASE_URL}/api/rooms/{rid}/availability",
                              params={"start": "2026-10-01", "end": "2026-10-03"}, timeout=30)
        assert av.status_code == 200
        assert av.json().get("availability") == []


# -----------------------------------------------------------------------------
# Channex foundation (staging, 0 properties)
# -----------------------------------------------------------------------------
class TestChannex:

    def test_status_connected_staging(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/channex/status", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d.get("connected") is True
        assert d.get("environment") == "staging"
        assert d.get("properties_count") == 0

    def test_list_properties_empty(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/channex/properties", timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d.get("count") == 0
        assert d.get("properties") == []

    def test_import_zero(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/channex/import", timeout=90)
        assert r.status_code == 200
        d = r.json()
        assert d.get("ok") is True
        assert d.get("imported_properties") == 0
        assert d.get("imported_rooms") == 0
        assert d.get("imported_rate_plans") == 0

    def test_sync_logs_present(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/channex/sync-logs", timeout=30)
        assert r.status_code == 200
        logs = r.json().get("logs", [])
        assert isinstance(logs, list)
        # must contain at least one entry from previous calls (read_properties/import)
        assert len(logs) >= 1
        for log in logs:
            assert log.get("provider") == "channex"
