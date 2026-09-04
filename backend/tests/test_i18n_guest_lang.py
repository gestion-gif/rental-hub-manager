"""
Tests for Casanéo Terrain i18n feature — guest_lang persistence.
- TEST 3: create reservation with guest_lang='en' via /api/reservations
- TEST 5: create reservation via /api/public/site/{slug}/request with lang='en'
- REGRESSION: dashboard/cleaning endpoints stay 200
"""
import os
import pytest
import requests
from datetime import date, timedelta

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://rental-hub-manager.preview.emergentagent.com").rstrip("/")
DEMO_EMAIL = "demo.stores@casaneo.app"
DEMO_PASSWORD = "CasaneoDemo2026!"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth_token(session):
    r = session.post(f"{BASE_URL}/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:300]}"
    token = r.json().get("session_token")
    assert token
    return token


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# === REGRESSION ===
def test_dashboard_200(session, auth_headers):
    r = session.get(f"{BASE_URL}/api/dashboard", headers=auth_headers, timeout=30)
    assert r.status_code == 200


def test_cleaning_schedule_200(session, auth_headers):
    r = session.get(f"{BASE_URL}/api/cleaning-schedule", headers=auth_headers, timeout=30)
    assert r.status_code == 200


# === TEST 3: guest_lang via /api/reservations ===
class TestReservationGuestLang:
    _created_ids = []

    def test_list_properties(self, session, auth_headers):
        r = session.get(f"{BASE_URL}/api/properties", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        props = r.json()
        assert isinstance(props, list) and len(props) > 0, "demo seed must have properties"
        TestReservationGuestLang._property_id = props[0]["id"]

    def test_create_reservation_with_guest_lang_en(self, session, auth_headers):
        pid = TestReservationGuestLang._property_id
        ci = (date.today() + timedelta(days=180)).isoformat()
        co = (date.today() + timedelta(days=183)).isoformat()
        payload = {
            "property_id": pid,
            "guest_first_name": "TEST",
            "guest_last_name": "I18nEN",
            "guest_name": "TEST I18nEN",
            "guest_email": "delivered@resend.dev",
            "guest_phone": "",
            "guest_lang": "en",
            "platform": "Direct",
            "check_in": ci,
            "check_out": co,
            "guests": 2,
            "nights_total": 300,
            "cleaning_fee": 50,
            "tourist_tax": 0,
            "total_price": 350,
            "status": "confirmee",
            "notes": "TEST i18n EN",
            "internal_note": ""
        }
        r = session.post(f"{BASE_URL}/api/reservations", headers=auth_headers, json=payload, timeout=30)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text[:400]}"
        body = r.json()
        rid = body.get("id")
        assert rid, "reservation must have id"
        TestReservationGuestLang._created_ids.append(rid)
        # GET verify persistence
        r2 = session.get(f"{BASE_URL}/api/reservations", headers=auth_headers, timeout=30)
        assert r2.status_code == 200
        found = next((x for x in r2.json() if x.get("id") == rid), None)
        assert found is not None, "created reservation not found via GET"
        assert found.get("guest_lang") == "en", f"guest_lang not persisted: {found.get('guest_lang')}"

    def test_zzz_cleanup_reservations(self, session, auth_headers):
        for rid in TestReservationGuestLang._created_ids:
            r = session.delete(f"{BASE_URL}/api/reservations/{rid}", headers=auth_headers, timeout=30)
            assert r.status_code in (200, 204), f"cleanup failed for {rid}: {r.status_code} {r.text[:200]}"


# === TEST 5: public site request with lang='en' → guest_lang='en' ===
class TestPublicSiteLangEN:
    _created_id = None
    _slug = None
    _property_id = None

    def test_default_site(self, session):
        r = session.get(f"{BASE_URL}/api/public/default-site", timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        body = r.json()
        slug = body.get("slug") or body.get("site", {}).get("slug")
        assert slug, f"no slug in response: {body}"
        TestPublicSiteLangEN._slug = slug

    def test_site_has_properties(self, session):
        slug = TestPublicSiteLangEN._slug
        r = session.get(f"{BASE_URL}/api/public/site/{slug}", timeout=30)
        assert r.status_code == 200
        body = r.json()
        props = body.get("properties") or []
        assert len(props) > 0, "public site must expose at least one property"
        TestPublicSiteLangEN._property_id = props[0]["id"]

    def test_post_request_lang_en_and_verify_mongo(self, session):
        # Public site belongs to a different owner than the demo — verify persistence via Mongo.
        from pymongo import MongoClient
        with open('/app/backend/.env') as f:
            env = dict(l.strip().split('=', 1) for l in f if '=' in l and not l.startswith('#'))
        mc = MongoClient(env['MONGO_URL'].strip('"'))
        db = mc[env['DB_NAME'].strip('"')]

        slug = TestPublicSiteLangEN._slug
        pid = TestPublicSiteLangEN._property_id
        # Use far-future dates to avoid collision with seed data
        for offset in [400, 500, 600, 700]:
            ci = (date.today() + timedelta(days=offset)).isoformat()
            co = (date.today() + timedelta(days=offset + 3)).isoformat()
            payload = {
                "property_id": pid, "check_in": ci, "check_out": co, "guests": 2,
                "guest_name": "TEST PublicEN", "guest_email": "delivered@resend.dev",
                "guest_phone": "+33600000000", "lang": "en", "message": "TEST public EN",
            }
            r = session.post(f"{BASE_URL}/api/public/site/{slug}/request", json=payload, timeout=45)
            if r.status_code == 200:
                break
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        rid = r.json().get("reservation_id")
        assert rid
        TestPublicSiteLangEN._created_id = rid
        doc = db.reservations.find_one({"id": rid}, {"_id": 0, "guest_lang": 1, "status": 1})
        assert doc is not None, "reservation not persisted in mongo"
        assert doc.get("guest_lang") == "en", f"guest_lang not persisted: {doc}"
        # cleanup directly (owner is not demo)
        db.reservations.delete_one({"id": rid})
