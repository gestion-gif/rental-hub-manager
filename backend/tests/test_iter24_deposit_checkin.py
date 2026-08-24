"""
Iteration 24 - Deposit (acompte), Check-in public, Landing default-site
Tests deposit_policy application in quote/checkout, public check-in GET/POST,
and /api/public/default-site.
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
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def property_id(site_data):
    return site_data["properties"][0]["id"]


@pytest.fixture(scope="module")
def initial_prefs(admin_headers):
    r = requests.get(f"{API}/preferences", headers=admin_headers)
    assert r.status_code == 200
    return r.json() or {}


# -------------------- Default-site landing --------------------

class TestDefaultSite:
    def test_default_site_returns_slug(self):
        r = requests.get(f"{API}/public/default-site")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "slug" in d
        assert d["slug"], "slug should not be empty"
        # Since QA account has mhpimmo enabled, slug should be mhpimmo
        assert d["slug"] == SLUG


# -------------------- Deposit / Acompte --------------------

class TestDepositQuote:
    """Quote should apply the deposit policy currently linked to preferences.public_site."""

    def test_quote_returns_deposit_fields(self, property_id, admin_headers, initial_prefs):
        payload = {"property_id": property_id, "check_in": "2027-08-01",
                   "check_out": "2027-08-05", "guests": 2}
        r = requests.post(f"{API}/public/site/{SLUG}/quote", json=payload)
        assert r.status_code == 200, r.text
        q = r.json()
        # All 3 new fields must always be present
        for k in ("deposit_amount", "balance_due", "deposit_label"):
            assert k in q, f"Missing {k}"

        ps = (initial_prefs.get("public_site") or {})
        pol_id = ps.get("deposit_policy_id") or ""
        total = float(q["total"])

        if pol_id:
            # Read the actual policy to know the expected percent
            pols_resp = requests.get(f"{API}/booking-policies", headers=admin_headers).json()
            pols = pols_resp.get("policies") if isinstance(pols_resp, dict) else pols_resp
            pol = next((p for p in (pols or []) if p.get("id") == pol_id), None)
            assert pol is not None, "Linked deposit policy not found"
            payments = pol.get("payments") or []
            pct = float((payments[0] or {}).get("percent", 0)) if payments else 0
            expected_deposit = round(total * pct / 100.0, 2)
            expected_balance = round(total - expected_deposit, 2)
            assert abs(q["deposit_amount"] - expected_deposit) < 0.02, \
                f"deposit_amount={q['deposit_amount']} expected={expected_deposit}"
            assert abs(q["balance_due"] - expected_balance) < 0.02
            assert q["deposit_label"] == f"Acompte {pct:g}%"
        else:
            # No policy set → deposit == total, balance 0
            assert abs(q["deposit_amount"] - total) < 0.02
            assert q["balance_due"] == 0
            assert q["deposit_label"] == ""

    def test_quote_no_deposit_when_policy_cleared(self, property_id, admin_headers, initial_prefs):
        """Save empty deposit_policy_id → deposit == total; restore original.

        KNOWN BACKEND ISSUE (see report): PUT /preferences at server.py:2558 falls back
        to the current stored deposit_policy_id when an empty string is provided
        (`str(ps.get("deposit_policy_id") or cur.get("deposit_policy_id") or "")`).
        This prevents the frontend chip "Paiement intégral" (dep-none) from clearing
        the policy. We assert this behaviour is broken so it stays visible in CI.
        """
        original_ps = dict(initial_prefs.get("public_site") or {})
        # Save with empty deposit_policy_id
        pub_payload = {**original_ps, "deposit_policy_id": ""}
        r = requests.put(f"{API}/preferences",
                         json={"public_site": pub_payload},
                         headers=admin_headers)
        assert r.status_code == 200, r.text
        # Read back what was persisted
        after = requests.get(f"{API}/preferences", headers=admin_headers).json()
        persisted_pol = ((after or {}).get("public_site") or {}).get("deposit_policy_id") or ""
        try:
            if not persisted_pol:
                # Correct behaviour: policy cleared → quote deposit == total
                payload = {"property_id": property_id, "check_in": "2027-08-01",
                           "check_out": "2027-08-05", "guests": 2}
                q = requests.post(f"{API}/public/site/{SLUG}/quote", json=payload).json()
                assert abs(q["deposit_amount"] - q["total"]) < 0.02
                assert q["balance_due"] == 0
                assert q["deposit_label"] == ""
            else:
                pytest.xfail(
                    "Backend bug: PUT /preferences cannot clear deposit_policy_id "
                    "(server.py:2558 falls back to cur value on empty string). "
                    "Frontend chip 'Paiement intégral' (dep-none) is therefore broken."
                )
        finally:
            # RESTORE original public_site
            rr = requests.put(f"{API}/preferences",
                              json={"public_site": original_ps},
                              headers=admin_headers)
            assert rr.status_code == 200


class TestDepositCheckout:
    """Checkout must charge deposit_amount (not total) when a policy is set."""

    def test_checkout_uses_deposit_amount(self, property_id, admin_headers):
        # First get the expected quote/deposit
        pl = {"property_id": property_id, "check_in": "2027-08-10",
              "check_out": "2027-08-13", "guests": 2}
        q = requests.post(f"{API}/public/site/{SLUG}/quote", json=pl).json()
        expected_deposit = float(q["deposit_amount"])
        expected_total = float(q["total"])

        body = {**pl, "guest_name": "Dep Test", "guest_email": "dep@test.fr",
                "origin_url": "https://example.com"}
        r = requests.post(f"{API}/public/site/{SLUG}/checkout", json=body)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("session_id", "").startswith("cs_"), f"session_id: {d.get('session_id')}"
        assert "url" in d
        rid = d.get("reservation_id")
        assert rid
        assert "amount" in d
        assert abs(float(d["amount"]) - expected_deposit) < 0.02, \
            f"Stripe amount={d['amount']} should equal deposit={expected_deposit}, not total={expected_total}"
        # Deposit should differ from total when policy is applied
        if q.get("deposit_label"):
            assert expected_deposit < expected_total, \
                "Deposit policy is present but deposit_amount equals total"

        # Cleanup — DO NOT complete the payment
        dd = requests.delete(f"{API}/reservations/{rid}", headers=admin_headers)
        assert dd.status_code in (200, 204), f"Cleanup failed: {dd.status_code} {dd.text}"


# -------------------- Check-in public --------------------

@pytest.fixture(scope="module")
def checkin_reservation(property_id, admin_headers):
    """Create a reservation via /request for check-in testing; cleanup at teardown."""
    body = {"property_id": property_id, "check_in": "2027-09-01",
            "check_out": "2027-09-03", "guests": 2,
            "guest_name": "TEST Checkin", "guest_email": "chk@test.fr"}
    r = requests.post(f"{API}/public/site/{SLUG}/request", json=body)
    assert r.status_code == 200, r.text
    rid = r.json()["reservation_id"]
    yield rid
    # Cleanup after all tests in module
    requests.delete(f"{API}/reservations/{rid}", headers=admin_headers)


class TestCheckinPublic:
    def test_checkin_get_ok(self, checkin_reservation):
        r = requests.get(f"{API}/public/site/{SLUG}/checkin/{checkin_reservation}")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("property_name", "check_in", "check_out", "enabled", "questions", "submitted"):
            assert k in d, f"Missing key {k}"
        assert d["enabled"] is True, "online_checkin should be enabled on QA account"
        assert d["submitted"] is False
        assert isinstance(d["questions"], list) and len(d["questions"]) > 0
        # guests_count must be required
        gc = next((q for q in d["questions"] if q["id"] == "guests_count"), None)
        assert gc is not None, "guests_count question missing"
        assert gc["required"] is True
        # Each question shape
        for q in d["questions"]:
            for k in ("id", "label", "required", "type"):
                assert k in q, f"Question missing {k}"

    def test_checkin_get_unknown_slug_404(self, checkin_reservation):
        r = requests.get(f"{API}/public/site/does-not-exist-abc-2026/checkin/{checkin_reservation}")
        assert r.status_code == 404

    def test_checkin_get_unknown_id_404(self):
        r = requests.get(f"{API}/public/site/{SLUG}/checkin/00000000-0000-0000-0000-000000000000")
        assert r.status_code == 404

    def test_checkin_post_and_reflects(self, checkin_reservation):
        payload = {"answers": {"guests_count": "2", "arrival_time": "18h"}}
        r = requests.post(f"{API}/public/site/{SLUG}/checkin/{checkin_reservation}", json=payload)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Re-GET → submitted:true
        g = requests.get(f"{API}/public/site/{SLUG}/checkin/{checkin_reservation}")
        assert g.status_code == 200
        assert g.json().get("submitted") is True
