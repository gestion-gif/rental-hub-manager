"""Backend tests for the auto-charge (encaissement automatique carte Booking.com/Channex→Stripe) flow.

SAFETY: We create a fake reservation with an invalid channex_booking_id so the Channex call
returns 404 before any Stripe call is made — no real card is ever charged.

All auto-charge tests live in a SINGLE class so pytest-xdist `--dist loadscope` keeps them
on the SAME worker (they share the fake reservation state).
"""
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    fe_env = Path(__file__).parent.parent.parent / "frontend" / ".env"
    for line in fe_env.read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

FAKE_RES_ID = "test-ac-agent-1"
OWNER_UID = "user_e235f66c67c3"
PROP_ID = "fe0ca91b-7fa2-4051-af54-c337ff920e28"


@pytest.fixture(scope="class")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="class")
def headers():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "qa.admin@casaneo.test", "password": "CasaneoQA2026!"},
                      timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json().get("session_token")
    assert tok, "session_token missing"
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="class", autouse=True)
def seed_fake_reservation(mongo):
    mongo.reservations.delete_one({"id": FAKE_RES_ID})
    mongo.reservations.insert_one({
        "id": FAKE_RES_ID,
        "user_id": OWNER_UID,
        "property_id": PROP_ID,
        "guest_name": "Test Agent AC",
        "platform": "Booking.com",
        "source": "channex",
        "channex_booking_id": "00000000-0000-0000-0000-00000000dead",
        "check_in": "2026-09-20",
        "check_out": "2026-09-21",
        "status": "confirmee",
        "total_price": 100,
        "finance": {"total": 100, "paid": 0, "due": 100, "currency": "EUR"},
        "payments": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    yield
    mongo.reservations.delete_one({"id": FAKE_RES_ID})


class TestAutoCharge:
    """All auto-charge tests share a single fake reservation. Ordered on purpose."""

    # ---- TEST 1 : error chain -----------------------------------------------
    def test_01_first_attempt_returns_402_carte_indisponible(self, headers, mongo):
        r = requests.post(f"{BASE_URL}/api/reservations/{FAKE_RES_ID}/auto-charge",
                          headers=headers, timeout=60)
        assert r.status_code == 402, f"Expected 402, got {r.status_code}: {r.text}"
        detail = r.json().get("detail", "")
        assert isinstance(detail, str) and detail
        assert ("Carte indisponible" in detail or "Channex" in detail), \
            f"Unexpected French error: {detail}"
        doc = mongo.reservations.find_one({"id": FAKE_RES_ID}, {"_id": 0})
        ac = doc.get("auto_charge") or {}
        assert ac.get("status") == "error", f"auto_charge={ac}"
        assert int(ac.get("attempts") or 0) == 1
        assert ac.get("error")

    def test_02_second_attempt_increments_attempts(self, headers, mongo):
        r = requests.post(f"{BASE_URL}/api/reservations/{FAKE_RES_ID}/auto-charge",
                          headers=headers, timeout=60)
        assert r.status_code == 402
        doc = mongo.reservations.find_one({"id": FAKE_RES_ID}, {"_id": 0})
        ac = doc.get("auto_charge") or {}
        assert ac.get("status") == "error"
        assert int(ac.get("attempts") or 0) == 2, f"attempts={ac.get('attempts')}"

    # ---- TEST 2 : déjà encaissé ---------------------------------------------
    def test_03_status_done_returns_deja_encaisse(self, headers, mongo):
        mongo.reservations.update_one(
            {"id": FAKE_RES_ID},
            {"$set": {"auto_charge": {"status": "done", "attempts": 1,
                                      "at": datetime.now(timezone.utc).isoformat(),
                                      "amount": 100}}})
        r = requests.post(f"{BASE_URL}/api/reservations/{FAKE_RES_ID}/auto-charge",
                          headers=headers, timeout=60)
        assert r.status_code == 402
        detail = r.json().get("detail", "")
        assert "Déjà encaissé" in detail, f"Expected 'Déjà encaissé', got: {detail}"

    # ---- TEST 3 : aucun montant dû ------------------------------------------
    def test_04_due_zero_returns_no_amount_due(self, headers, mongo):
        mongo.reservations.update_one(
            {"id": FAKE_RES_ID},
            {"$set": {"finance.due": 0,
                      "auto_charge": {"status": "error", "attempts": 2,
                                      "at": datetime.now(timezone.utc).isoformat()}}})
        r = requests.post(f"{BASE_URL}/api/reservations/{FAKE_RES_ID}/auto-charge",
                          headers=headers, timeout=60)
        assert r.status_code == 402
        detail = r.json().get("detail", "")
        assert "Aucun montant dû" in detail, f"Expected 'Aucun montant dû', got: {detail}"

    # ---- TEST 4 : préférences auto_charge -----------------------------------
    def test_05_get_preferences_has_auto_charge_block(self, headers):
        r = requests.get(f"{BASE_URL}/api/preferences", headers=headers, timeout=30)
        assert r.status_code == 200
        ac = r.json().get("auto_charge")
        assert isinstance(ac, dict), f"auto_charge missing: {r.json()}"
        assert "enabled" in ac and "days_before" in ac, f"fields missing: {ac}"

    def test_06_update_auto_charge_days_before_45(self, headers):
        r = requests.put(f"{BASE_URL}/api/preferences", headers=headers,
                         json={"auto_charge": {"enabled": True, "days_before": 45}},
                         timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        r = requests.get(f"{BASE_URL}/api/preferences", headers=headers, timeout=30)
        ac = r.json().get("auto_charge") or {}
        assert ac.get("days_before") == 45, f"days_before={ac.get('days_before')}"
        assert ac.get("enabled") is True
        # Reset to safe defaults
        r = requests.put(f"{BASE_URL}/api/preferences", headers=headers,
                         json={"auto_charge": {"enabled": False, "days_before": 60}},
                         timeout=30)
        assert r.status_code == 200
        r = requests.get(f"{BASE_URL}/api/preferences", headers=headers, timeout=30)
        ac = r.json().get("auto_charge") or {}
        assert ac.get("enabled") is False
        assert ac.get("days_before") == 60

    # ---- TEST 5 : régression ------------------------------------------------
    def test_07_list_reservations_ok(self, headers):
        r = requests.get(f"{BASE_URL}/api/reservations", headers=headers, timeout=60)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_08_channex_status_connected_production(self, headers):
        r = requests.get(f"{BASE_URL}/api/channex/status", headers=headers, timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        s = r.json()
        assert s.get("connected") is True, f"channex status: {s}"
        assert s.get("environment") == "production", f"environment={s.get('environment')}"
