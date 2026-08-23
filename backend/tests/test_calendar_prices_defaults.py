"""
Regression tests for Casanéo iteration 15:
- POST /api/auth/login with QA admin credentials
- GET /api/properties returns default_cleaning_fee/default_tourist_tax
- PUT /api/properties/{id} persists default_cleaning_fee/default_tourist_tax
- PUT /api/properties/{id} with an inserted 'promo season' (head of seasons list)
  persists and reflects via GET
"""

import os
import time
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

# Base URL — take from frontend .env (public preview URL used by the user)
BASE_URL = None
fe_env = Path(__file__).parent.parent.parent / "frontend" / ".env"
for line in fe_env.read_text().splitlines():
    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
        BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
        break
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"

QA_EMAIL = "qa.admin@casaneo.test"
QA_PASSWORD = "CasaneoQA2026!"


@pytest.fixture(scope="module")
def qa_session():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": QA_EMAIL, "password": QA_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("session_token"), "missing session_token"
    assert data["user"]["email"] == QA_EMAIL
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {data['session_token']}",
    })
    return s


# --- LOGIN ------------------------------------------------------------------
def test_login_ok():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": QA_EMAIL, "password": QA_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200
    j = r.json()
    assert j["user"]["role"] == "member"
    assert j["user"]["email"] == QA_EMAIL
    assert len(j["session_token"]) >= 20


def test_login_bad_password_401():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": QA_EMAIL, "password": "wrongpass"},
        timeout=15,
    )
    assert r.status_code == 401


# --- PROPERTIES -------------------------------------------------------------
def test_get_properties_returns_defaults_keys(qa_session):
    r = qa_session.get(f"{BASE_URL}/api/properties", timeout=15)
    assert r.status_code == 200
    items = r.json()
    assert isinstance(items, list) and len(items) >= 1
    # QA admin is attached to owner mhpimmo with 24 properties per credentials note
    for p in items:
        assert "id" in p and "name" in p
        # Fields may be missing on older docs; but should be numeric when present
        for k in ("default_cleaning_fee", "default_tourist_tax"):
            if k in p:
                assert isinstance(p[k], (int, float))


def test_put_property_preserves_default_fees(qa_session):
    props = qa_session.get(f"{BASE_URL}/api/properties", timeout=15).json()
    assert len(props) >= 1
    target = props[0]
    pid = target["id"]

    # Snapshot original values so we can restore them
    orig_cleaning = target.get("default_cleaning_fee", 0) or 0
    orig_tax = target.get("default_tourist_tax", 0) or 0

    # Build minimal body that PropertyIn accepts
    body = {
        "name": target.get("name", "TEST"),
        "location": target.get("location", ""),
        "image_url": target.get("image_url", ""),
        "base_price": target.get("base_price", 0) or 0,
        "capacity": target.get("capacity", 2) or 2,
        "bedrooms": target.get("bedrooms", 1) or 1,
        "owner": target.get("owner", ""),
        "surface": target.get("surface", 0) or 0,
        "address": target.get("address", ""),
        "postal_code": target.get("postal_code", ""),
        "city": target.get("city", ""),
        "address_complement": target.get("address_complement", ""),
        "description": target.get("description", ""),
        "rooms": target.get("rooms", []) or [],
        "amenities": target.get("amenities", []) or [],
        "seasons": target.get("seasons", []) or [],
        "ical_links": target.get("ical_links", []) or [],
        "welcome_book_url": target.get("welcome_book_url", ""),
        "management_fee_pct": target.get("management_fee_pct", 0) or 0,
        "default_cleaning_fee": 77.5,
        "default_tourist_tax": 3.25,
    }

    r = qa_session.put(f"{BASE_URL}/api/properties/{pid}", json=body, timeout=15)
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["default_cleaning_fee"] == 77.5
    assert updated["default_tourist_tax"] == 3.25

    # Verify persistence via GET
    got = qa_session.get(f"{BASE_URL}/api/properties/{pid}", timeout=15).json()
    assert got["default_cleaning_fee"] == 77.5
    assert got["default_tourist_tax"] == 3.25

    # Restore
    body["default_cleaning_fee"] = float(orig_cleaning)
    body["default_tourist_tax"] = float(orig_tax)
    r2 = qa_session.put(f"{BASE_URL}/api/properties/{pid}", json=body, timeout=15)
    assert r2.status_code == 200


def test_put_property_promo_season_persists_and_prime(qa_session):
    """Simulate the frontend 'Tarif spécial' flow: put a promo season at the
    head of seasons so it wins over any overlapping season."""
    props = qa_session.get(f"{BASE_URL}/api/properties", timeout=15).json()
    target = props[0]
    pid = target["id"]
    orig_seasons = target.get("seasons", []) or []

    promo = {
        "id": f"promo_TEST_{int(time.time())}",
        "name": "TEST_PromoAgent",
        "start_date": "2030-01-10",
        "end_date": "2030-01-15",
        "price": 999,
    }

    body = {
        "name": target["name"],
        "location": target.get("location", ""),
        "image_url": target.get("image_url", ""),
        "base_price": target.get("base_price", 0) or 0,
        "capacity": target.get("capacity", 2) or 2,
        "bedrooms": target.get("bedrooms", 1) or 1,
        "owner": target.get("owner", ""),
        "surface": target.get("surface", 0) or 0,
        "address": target.get("address", ""),
        "postal_code": target.get("postal_code", ""),
        "city": target.get("city", ""),
        "address_complement": target.get("address_complement", ""),
        "description": target.get("description", ""),
        "rooms": target.get("rooms", []) or [],
        "amenities": target.get("amenities", []) or [],
        "seasons": [promo] + orig_seasons,
        "ical_links": target.get("ical_links", []) or [],
        "welcome_book_url": target.get("welcome_book_url", ""),
        "management_fee_pct": target.get("management_fee_pct", 0) or 0,
        "default_cleaning_fee": target.get("default_cleaning_fee", 0) or 0,
        "default_tourist_tax": target.get("default_tourist_tax", 0) or 0,
    }
    r = qa_session.put(f"{BASE_URL}/api/properties/{pid}", json=body, timeout=15)
    assert r.status_code == 200
    updated = r.json()
    assert isinstance(updated.get("seasons"), list) and len(updated["seasons"]) >= 1
    assert updated["seasons"][0]["id"] == promo["id"], "promo must be first"
    assert updated["seasons"][0]["price"] == 999

    # GET verification
    got = qa_session.get(f"{BASE_URL}/api/properties/{pid}", timeout=15).json()
    assert got["seasons"][0]["id"] == promo["id"]
    assert got["seasons"][0]["name"] == "TEST_PromoAgent"

    # Cleanup: remove promo from seasons
    body["seasons"] = orig_seasons
    r2 = qa_session.put(f"{BASE_URL}/api/properties/{pid}", json=body, timeout=15)
    assert r2.status_code == 200
    final = qa_session.get(f"{BASE_URL}/api/properties/{pid}", timeout=15).json()
    assert not any(s.get("id") == promo["id"] for s in (final.get("seasons") or []))


def test_unauthenticated_properties_401():
    r = requests.get(f"{BASE_URL}/api/properties", timeout=15)
    assert r.status_code in (401, 403)
