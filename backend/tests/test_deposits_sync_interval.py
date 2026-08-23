"""Iteration 19 — Casanéo tests:
   • PATCH /api/channel/sync-interval (bounds 5..1440), GET /api/channel/status → sync_interval_min
   • GET /api/deposits/pending logic (future non-Airbnb reservation whose property has deposit_link)
   • POST /api/reservations/{id}/send-deposit-link on MANUAL reservation → {sent:false, reason:'no_messaging'}
     (guardrail: never triggers real Lodgify send_message).

Auth: QA admin (qa.admin@casaneo.test / CasaneoQA2026!).
All test data (deposit_link on property, manual reservation) restored/cleaned.
sync_interval_min is restored to its initial value (or 30) at the end.
"""

import os
import uuid
from datetime import date, timedelta
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
           os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")

QA_EMAIL = "qa.admin@casaneo.test"
QA_PASSWORD = "CasaneoQA2026!"


# ---------------------------------------------------------------------------
# Session-scoped auth & fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": QA_EMAIL, "password": QA_PASSWORD},
                      timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    tok = j.get("session_token") or j.get("token")
    assert tok, j
    return tok


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def _property_put_payload(prop: dict, overrides: dict) -> dict:
    """Build a minimal PropertyIn payload preserving all known fields."""
    fields = [
        "name", "address", "address_complement", "description", "rooms",
        "amenities", "seasons", "ical_links", "welcome_book_url",
        "management_fee_pct", "default_cleaning_fee", "default_tourist_tax",
        "tourist_tax_pct", "regional_tax_pct",
        "key_instructions", "key_photos",
        "deposit_link",
        "lodgify_id", "owner_id",
    ]
    body = {}
    for f in fields:
        v = prop.get(f)
        if v is None and f in ("lodgify_id", "owner_id"):
            continue
        if v is None:
            v = "" if f in ("name", "address", "address_complement",
                            "description", "welcome_book_url",
                            "key_instructions", "deposit_link") else 0 if f in (
                "management_fee_pct", "default_cleaning_fee",
                "default_tourist_tax", "tourist_tax_pct", "regional_tax_pct"
            ) else []
        body[f] = v
    body.update(overrides)
    if not body.get("name"):
        body["name"] = prop.get("name") or "Test"
    return body


# ---------------------------------------------------------------------------
# Pick a NON-Lodgify property if possible (safer). Otherwise any prop is fine
# because we never issue send-deposit-link on real Lodgify data — only on our
# manual reservation whose source != 'lodgify'.
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def pick_property(auth_headers):
    r = requests.get(f"{BASE_URL}/api/properties", headers=auth_headers, timeout=30)
    assert r.status_code == 200, r.text
    props = r.json()
    assert props, "no properties available for QA admin"
    # Prefer a property without deposit_link so we can safely set/unset it
    empty = [p for p in props if not (p.get("deposit_link") or "").strip()]
    prop = (empty[0] if empty else props[0])
    yield prop
    # Restoration handled by TestDepositsFlow class fixture (deposit_link cleanup)


# =============================================================================
# 1) sync-interval bounds + persistence
# =============================================================================
class TestSyncInterval:
    @pytest.fixture(scope="class")
    def initial_interval(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/channel/status", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        j = r.json()
        init = int(j.get("sync_interval_min") or 30) if j.get("connected") else 30
        yield init
        # restore to 30 as required by review request
        requests.patch(f"{BASE_URL}/api/channel/sync-interval",
                       headers=auth_headers, json={"minutes": 30}, timeout=30)

    def test_status_exposes_sync_interval_min(self, auth_headers, initial_interval):
        r = requests.get(f"{BASE_URL}/api/channel/status", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        j = r.json()
        # Whether or not connected, key must be present when connected=True
        if j.get("connected"):
            assert isinstance(j.get("sync_interval_min"), int)
            assert 5 <= j["sync_interval_min"] <= 1440

    def test_set_valid_intervals_persist(self, auth_headers, initial_interval):
        for m in (15, 30, 60, 120, 240):
            r = requests.patch(f"{BASE_URL}/api/channel/sync-interval",
                               headers=auth_headers, json={"minutes": m}, timeout=30)
            assert r.status_code == 200, r.text
            assert r.json().get("sync_interval_min") == m
            # Verify via GET /channel/status
            s = requests.get(f"{BASE_URL}/api/channel/status", headers=auth_headers, timeout=30).json()
            if s.get("connected"):
                assert s.get("sync_interval_min") == m, s

    def test_lower_bound_clamped_to_5(self, auth_headers, initial_interval):
        r = requests.patch(f"{BASE_URL}/api/channel/sync-interval",
                           headers=auth_headers, json={"minutes": 1}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("sync_interval_min") == 5

    def test_upper_bound_clamped_to_1440(self, auth_headers, initial_interval):
        r = requests.patch(f"{BASE_URL}/api/channel/sync-interval",
                           headers=auth_headers, json={"minutes": 9999}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("sync_interval_min") == 1440


# =============================================================================
# 2) /deposits/pending logic + send-deposit-link guardrail on MANUAL reservation
# =============================================================================
class TestDepositsFlow:
    """End-to-end: set deposit_link → create MANUAL Direct future reservation →
    reservation appears in /deposits/pending → POST send-deposit-link returns
    {sent:false, reason:'no_messaging'} (NO real send) → reservation still
    listed. Cleanup restores deposit_link and deletes the manual reservation."""

    @pytest.fixture(scope="class")
    def _setup(self, auth_headers, pick_property):
        prop = pick_property
        pid = prop["id"]
        # Snapshot original deposit_link
        original = prop.get("deposit_link") or ""
        test_link = "https://pay.test.casaneo/qa-caution-" + uuid.uuid4().hex[:6]

        # 1) Set deposit_link on the property
        body = _property_put_payload(prop, {"deposit_link": test_link})
        rput = requests.put(f"{BASE_URL}/api/properties/{pid}",
                            headers=auth_headers, json=body, timeout=30)
        assert rput.status_code == 200, rput.text

        # 2) Create a MANUAL Direct future reservation (source stays None → safe)
        ci = (date.today() + timedelta(days=10)).isoformat()
        co = (date.today() + timedelta(days=12)).isoformat()
        payload = {
            "property_id": pid,
            "guest_name": "TEST_Deposit QA",
            "guest_first_name": "TEST",
            "guest_last_name": "Deposit",
            "guest_email": "TEST_deposit@example.com",
            "platform": "Direct",
            "check_in": ci,
            "check_out": co,
            "guests": 2,
            "nights_total": 200,
            "cleaning_fee": 40,
            "tourist_tax": 4,
            "total_price": 244,
        }
        r = requests.post(f"{BASE_URL}/api/reservations",
                          headers=auth_headers, json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        rid = r.json().get("id")
        assert rid

        yield {"pid": pid, "rid": rid, "test_link": test_link, "original_link": original}

        # Cleanup
        requests.delete(f"{BASE_URL}/api/reservations/{rid}",
                        headers=auth_headers, timeout=30)
        # Restore deposit_link
        rget = requests.get(f"{BASE_URL}/api/properties/{pid}",
                            headers=auth_headers, timeout=30)
        if rget.status_code == 200:
            body2 = _property_put_payload(rget.json(), {"deposit_link": original})
            requests.put(f"{BASE_URL}/api/properties/{pid}",
                         headers=auth_headers, json=body2, timeout=30)

    def test_deposit_link_persists_on_property(self, auth_headers, _setup):
        pid = _setup["pid"]
        r = requests.get(f"{BASE_URL}/api/properties/{pid}",
                         headers=auth_headers, timeout=30)
        assert r.status_code == 200
        assert r.json().get("deposit_link") == _setup["test_link"]

    def test_pending_lists_manual_reservation(self, auth_headers, _setup):
        r = requests.get(f"{BASE_URL}/api/deposits/pending",
                         headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list)
        ids = [it.get("reservation_id") for it in items]
        assert _setup["rid"] in ids, f"expected our manual reservation in /deposits/pending, got {ids}"
        # Data shape check
        mine = next(it for it in items if it.get("reservation_id") == _setup["rid"])
        assert mine.get("check_in")
        assert mine.get("platform") != "Airbnb"  # must exclude Airbnb
        assert "property_name" in mine
        assert "guest_name" in mine

    def test_send_deposit_link_manual_no_messaging(self, auth_headers, _setup):
        rid = _setup["rid"]
        r = requests.post(f"{BASE_URL}/api/reservations/{rid}/send-deposit-link",
                          headers=auth_headers, json={}, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("sent") is False, j
        assert j.get("reason") == "no_messaging", j

    def test_pending_still_lists_after_failed_send(self, auth_headers, _setup):
        # After no_messaging, deposit_link_sent_at MUST NOT be set → still pending
        r = requests.get(f"{BASE_URL}/api/deposits/pending",
                         headers=auth_headers, timeout=30)
        assert r.status_code == 200
        ids = [it.get("reservation_id") for it in r.json()]
        assert _setup["rid"] in ids, "manual reservation should still be pending after no_messaging"


# =============================================================================
# 3) 404 guard
# =============================================================================
class TestSendDepositLinkGuards:
    def test_unknown_reservation_returns_404(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/reservations/does-not-exist-qa/send-deposit-link",
                          headers=auth_headers, json={}, timeout=30)
        assert r.status_code == 404
