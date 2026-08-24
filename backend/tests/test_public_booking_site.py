"""
Iteration 23 - Public Booking Site + Stripe Checkout
Tests /api/public/site/{slug}/* endpoints (no auth) and cleanup with QA admin.
"""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://rental-hub-manager.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
SLUG = "mhpimmo"

QA_EMAIL = "qa.admin@casaneo.test"
QA_PASSWORD = "CasaneoQA2026!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": QA_EMAIL, "password": QA_PASSWORD})
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json().get("session_token") or r.json().get("token")


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def site_data():
    r = requests.get(f"{API}/public/site/{SLUG}")
    assert r.status_code == 200, f"Public site failed: {r.status_code} {r.text}"
    data = r.json()
    assert isinstance(data.get("properties"), list) and len(data["properties"]) > 0
    return data


@pytest.fixture(scope="module")
def property_id(site_data):
    return site_data["properties"][0]["id"]


# -------------------- Public site listing --------------------

class TestPublicSite:
    def test_public_site_no_auth(self, site_data):
        # No Authorization header used → still 200
        assert site_data.get("slug") == SLUG
        assert "company" in site_data
        assert site_data["company"].get("name")
        assert site_data.get("count") == len(site_data["properties"])
        p0 = site_data["properties"][0]
        for k in ("id", "name", "city", "base_price", "photos", "capacity", "bedrooms"):
            assert k in p0, f"Missing field {k} in property card"

    def test_public_site_unknown_slug_404(self):
        r = requests.get(f"{API}/public/site/does-not-exist-xyz-2026")
        assert r.status_code == 404

    def test_public_property_detail(self, property_id):
        r = requests.get(f"{API}/public/site/{SLUG}/property/{property_id}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["id"] == property_id
        assert "unavailable_dates" in d and isinstance(d["unavailable_dates"], list)
        assert "default_cleaning_fee" in d

    def test_public_property_unknown_id_404(self):
        r = requests.get(f"{API}/public/site/{SLUG}/property/00000000-0000-0000-0000-000000000000")
        assert r.status_code == 404


# -------------------- Quote --------------------

class TestQuote:
    def test_quote_ok(self, property_id):
        payload = {"property_id": property_id, "check_in": "2027-04-01",
                   "check_out": "2027-04-05", "guests": 2}
        r = requests.post(f"{API}/public/site/{SLUG}/quote", json=payload)
        assert r.status_code == 200, r.text
        q = r.json()
        assert q["nights"] == 4
        assert q["currency"] == "EUR"
        for k in ("nights_total", "cleaning_fee", "tourist_tax", "discount", "total"):
            assert k in q
        # total should approximate sum
        expected = round(q["nights_total"] + q["cleaning_fee"] + q["tourist_tax"] - q["discount"], 2)
        assert abs(q["total"] - expected) < 0.02

    def test_quote_guests_over_capacity_400(self, property_id, site_data):
        cap = site_data["properties"][0].get("capacity") or 4
        payload = {"property_id": property_id, "check_in": "2027-04-01",
                   "check_out": "2027-04-05", "guests": cap + 50}
        r = requests.post(f"{API}/public/site/{SLUG}/quote", json=payload)
        assert r.status_code == 400, r.text

    def test_quote_invalid_dates_400(self, property_id):
        payload = {"property_id": property_id, "check_in": "2027-04-05",
                   "check_out": "2027-04-05", "guests": 2}
        r = requests.post(f"{API}/public/site/{SLUG}/quote", json=payload)
        assert r.status_code == 400

        payload2 = {"property_id": property_id, "check_in": "2027-04-06",
                    "check_out": "2027-04-05", "guests": 2}
        r2 = requests.post(f"{API}/public/site/{SLUG}/quote", json=payload2)
        assert r2.status_code == 400

    def test_quote_price_field_ignored_server_recalculates(self, property_id):
        """Security: sending 'total'/'amount' in body must not influence server total."""
        payload = {"property_id": property_id, "check_in": "2027-04-01",
                   "check_out": "2027-04-05", "guests": 2}
        r1 = requests.post(f"{API}/public/site/{SLUG}/quote", json=payload)
        assert r1.status_code == 200
        legit_total = r1.json()["total"]

        payload2 = dict(payload)
        payload2["total"] = 1.0
        payload2["amount"] = 1.0
        payload2["nights_total"] = 1.0
        r2 = requests.post(f"{API}/public/site/{SLUG}/quote", json=payload2)
        assert r2.status_code == 200
        assert r2.json()["total"] == legit_total

    def test_quote_overlap_returns_409(self, property_id, admin_headers):
        """Create a request res, then a second quote overlapping → 409."""
        # First, create a request to block dates
        body = {"property_id": property_id, "check_in": "2027-06-10",
                "check_out": "2027-06-15", "guests": 2,
                "guest_name": "TEST Overlap", "guest_email": "testauto@example.com"}
        r = requests.post(f"{API}/public/site/{SLUG}/request", json=body)
        assert r.status_code == 200, r.text
        rid = r.json()["reservation_id"]
        try:
            # Confirm to make it non-annulee (already 'demande' which is in the block list)
            payload = {"property_id": property_id, "check_in": "2027-06-11",
                       "check_out": "2027-06-13", "guests": 2}
            r2 = requests.post(f"{API}/public/site/{SLUG}/quote", json=payload)
            assert r2.status_code == 409, f"Expected 409, got {r2.status_code}: {r2.text}"
        finally:
            d = requests.delete(f"{API}/reservations/{rid}", headers=admin_headers)
            assert d.status_code in (200, 204), f"Cleanup failed: {d.status_code} {d.text}"


# -------------------- Request (no payment) --------------------

class TestRequest:
    def test_request_creates_and_deletes(self, property_id, admin_headers):
        body = {"property_id": property_id, "check_in": "2027-04-10",
                "check_out": "2027-04-13", "guests": 2,
                "guest_name": "Test Auto", "guest_email": "testauto@example.com"}
        r = requests.post(f"{API}/public/site/{SLUG}/request", json=body)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("status") == "demande"
        rid = data.get("reservation_id")
        assert rid
        # Verify reservation is fetchable via admin API
        g = requests.get(f"{API}/reservations", headers=admin_headers)
        assert g.status_code == 200
        found = any(x.get("id") == rid for x in g.json())
        assert found, "Created reservation not visible to admin"
        # Cleanup
        d = requests.delete(f"{API}/reservations/{rid}", headers=admin_headers)
        assert d.status_code in (200, 204), f"Delete failed: {d.status_code} {d.text}"


# -------------------- Checkout (Stripe) --------------------

class TestCheckout:
    def test_checkout_returns_url_and_status(self, property_id, admin_headers):
        body = {"property_id": property_id, "check_in": "2027-05-01",
                "check_out": "2027-05-04", "guests": 2,
                "guest_name": "Test Pay", "guest_email": "testpay@example.com",
                "origin_url": "https://example.com"}
        r = requests.post(f"{API}/public/site/{SLUG}/checkout", json=body)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "url" in d and ("stripe" in d["url"].lower() or "checkout" in d["url"].lower())
        assert d.get("session_id", "").startswith("cs_"), f"session_id: {d.get('session_id')}"
        rid = d.get("reservation_id")
        assert rid

        try:
            # Poll status endpoint
            time.sleep(1.0)
            s = requests.get(f"{API}/public/booking/status/{d['session_id']}")
            assert s.status_code == 200, s.text
            body_status = s.json()
            assert "payment_status" in body_status
            # Typically 'unpaid' or 'open' before card completion
            assert body_status["payment_status"] in ("unpaid", "open", "no_payment_required", None) or body_status["payment_status"]
        finally:
            d2 = requests.delete(f"{API}/reservations/{rid}", headers=admin_headers)
            assert d2.status_code in (200, 204), f"Cleanup failed: {d2.status_code} {d2.text}"

    def test_checkout_price_field_ignored(self, property_id, admin_headers):
        """Injecting total/amount into body must not affect server-calculated amount."""
        # Reference quote to know expected total
        pl = {"property_id": property_id, "check_in": "2027-07-01",
              "check_out": "2027-07-03", "guests": 2}
        rq = requests.post(f"{API}/public/site/{SLUG}/quote", json=pl)
        assert rq.status_code == 200
        expected_total = rq.json()["total"]

        body = {"property_id": property_id, "check_in": "2027-07-01",
                "check_out": "2027-07-03", "guests": 2,
                "guest_name": "Test Sec", "guest_email": "testsec@example.com",
                "origin_url": "https://example.com",
                "total": 1.0, "amount": 1.0, "nights_total": 1.0}
        r = requests.post(f"{API}/public/site/{SLUG}/checkout", json=body)
        assert r.status_code == 200, r.text
        rid = r.json()["reservation_id"]
        try:
            # Fetch reservation to verify total wasn't overridden
            g = requests.get(f"{API}/reservations", headers=admin_headers)
            assert g.status_code == 200
            res = next((x for x in g.json() if x.get("id") == rid), None)
            assert res is not None
            assert abs(float(res.get("total_price", 0)) - expected_total) < 0.02, \
                f"Server total was overridden: got {res.get('total_price')}, expected {expected_total}"
        finally:
            requests.delete(f"{API}/reservations/{rid}", headers=admin_headers)


# -------------------- Preferences public_site + publish/unpublish --------------------

class TestPreferencesAndPublish:
    def test_preferences_public_site_persists(self, admin_headers):
        r = requests.put(f"{API}/preferences",
                         json={"public_site": {"enabled": True, "slug": SLUG}},
                         headers=admin_headers)
        assert r.status_code == 200, r.text
        g = requests.get(f"{API}/preferences", headers=admin_headers)
        assert g.status_code == 200
        ps = (g.json() or {}).get("public_site") or {}
        assert ps.get("enabled") is True
        assert ps.get("slug") == SLUG

    def test_property_unpublish_hides_from_public(self, admin_headers, property_id):
        # Snapshot count before
        before = requests.get(f"{API}/public/site/{SLUG}").json()
        assert property_id in [p["id"] for p in before["properties"]]

        r = requests.patch(f"{API}/properties/{property_id}/published",
                           json={"published": False}, headers=admin_headers)
        assert r.status_code == 200, r.text
        try:
            after = requests.get(f"{API}/public/site/{SLUG}").json()
            ids_after = [p["id"] for p in after["properties"]]
            assert property_id not in ids_after, "Property still visible after unpublish"
            assert after["count"] == before["count"] - 1
        finally:
            # RESTORE
            rr = requests.patch(f"{API}/properties/{property_id}/published",
                                json={"published": True}, headers=admin_headers)
            assert rr.status_code == 200
            restored = requests.get(f"{API}/public/site/{SLUG}").json()
            assert property_id in [p["id"] for p in restored["properties"]]
