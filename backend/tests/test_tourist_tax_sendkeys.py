"""Iteration 18 - Casanéo tourist_tax_pct / regional_tax_pct + POST /send-keys

Covers:
  - PropertyIn PUT/GET round-trip persists tourist_tax_pct & regional_tax_pct
  - POST /api/reservations/{id}/send-keys on MANUAL reservation:
      * property WITHOUT key_instructions => reason == 'no_key_info'
      * property WITH key_instructions but reservation manual (source != lodgify)
        => reason == 'no_messaging'
      * keys_sent must always be False for our manual reservations (safety)
  - Cleanup: restores property tax fields to backup, deletes test reservation,
    restores key_instructions.

DO NOT call send-keys on any Lodgify reservation - only on a freshly created
MANUAL reservation (platform=Direct or Airbnb, source omitted -> "").
"""
import os
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or
            os.environ.get("EXPO_BACKEND_URL") or "").rstrip("/")

QA_EMAIL = "qa.admin@casaneo.test"
QA_PASSWORD = "CasaneoQA2026!"


# ---------------------------------------------------------------------------
# Shared helpers/fixtures
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
    """Build a PropertyIn payload from an existing property document."""
    fields = [
        "name", "address", "address_complement", "description", "rooms",
        "amenities", "seasons", "ical_links", "welcome_book_url",
        "management_fee_pct", "default_cleaning_fee", "default_tourist_tax",
        "tourist_tax_pct", "regional_tax_pct",
        "key_instructions", "key_photos", "lodgify_id", "owner_id",
    ]
    body = {}
    for f in fields:
        v = prop.get(f)
        if v is None and f in ("lodgify_id", "owner_id"):
            continue
        if v is None:
            v = "" if f in ("name", "address", "address_complement",
                            "description", "welcome_book_url",
                            "key_instructions") else 0 if f in (
                "management_fee_pct", "default_cleaning_fee",
                "default_tourist_tax", "tourist_tax_pct",
                "regional_tax_pct") else []
        body[f] = v
    body.update(overrides)
    if not body.get("name"):
        body["name"] = prop.get("name") or "Test"
    return body


@pytest.fixture(scope="module")
def property_backup(auth_headers):
    """Pick the first property; snapshot tax_pct + key_instructions so we can
    restore them at the end of the module."""
    r = requests.get(f"{BASE_URL}/api/properties",
                     headers=auth_headers, timeout=30)
    assert r.status_code == 200, r.text
    props = r.json()
    assert props, "no properties found for QA admin"
    p = props[0]
    pid = p["id"]
    backup = {
        "tourist_tax_pct": p.get("tourist_tax_pct", 0) or 0,
        "regional_tax_pct": p.get("regional_tax_pct", 0) or 0,
        "key_instructions": p.get("key_instructions", "") or "",
    }
    yield pid, backup
    # Restore
    rget = requests.get(f"{BASE_URL}/api/properties/{pid}",
                        headers=auth_headers, timeout=30)
    if rget.status_code == 200:
        current = rget.json()
        body = _property_put_payload(current, {
            "tourist_tax_pct": backup["tourist_tax_pct"],
            "regional_tax_pct": backup["regional_tax_pct"],
            "key_instructions": backup["key_instructions"],
        })
        requests.put(f"{BASE_URL}/api/properties/{pid}",
                     headers=auth_headers, json=body, timeout=30)


# ---------------------------------------------------------------------------
# 1) PropertyIn round-trip: tourist_tax_pct + regional_tax_pct persist
# ---------------------------------------------------------------------------
class TestPropertyTaxPersistence:
    def test_put_then_get_persists_tax_pct(self, auth_headers, property_backup):
        pid, _backup = property_backup
        rget = requests.get(f"{BASE_URL}/api/properties/{pid}",
                            headers=auth_headers, timeout=30)
        assert rget.status_code == 200, rget.text
        prop = rget.json()
        body = _property_put_payload(prop, {
            "tourist_tax_pct": 5.5,
            "regional_tax_pct": 10.25,
        })
        rput = requests.put(f"{BASE_URL}/api/properties/{pid}",
                            headers=auth_headers, json=body, timeout=30)
        assert rput.status_code == 200, rput.text
        j = rput.json()
        assert float(j.get("tourist_tax_pct", 0)) == pytest.approx(5.5)
        assert float(j.get("regional_tax_pct", 0)) == pytest.approx(10.25)

        # Verify GET matches
        rget2 = requests.get(f"{BASE_URL}/api/properties/{pid}",
                             headers=auth_headers, timeout=30)
        p2 = rget2.json()
        assert float(p2.get("tourist_tax_pct", 0)) == pytest.approx(5.5)
        assert float(p2.get("regional_tax_pct", 0)) == pytest.approx(10.25)

    def test_put_zero_persists(self, auth_headers, property_backup):
        pid, _ = property_backup
        rget = requests.get(f"{BASE_URL}/api/properties/{pid}",
                            headers=auth_headers, timeout=30)
        prop = rget.json()
        body = _property_put_payload(prop, {
            "tourist_tax_pct": 0,
            "regional_tax_pct": 0,
        })
        rput = requests.put(f"{BASE_URL}/api/properties/{pid}",
                            headers=auth_headers, json=body, timeout=30)
        assert rput.status_code == 200, rput.text
        j = rput.json()
        assert float(j.get("tourist_tax_pct", 0)) == 0
        assert float(j.get("regional_tax_pct", 0)) == 0


# ---------------------------------------------------------------------------
# 2) POST /reservations/{id}/send-keys - safety-tested via MANUAL reservation
# ---------------------------------------------------------------------------
class TestSendKeysManualReservation:
    """Create a manual reservation on a test property, then test send-keys.

    Safety: platform is 'Direct' (or 'Airbnb') but source is left empty
    (defaults to '' or 'manual' — not 'lodgify'), no thread_uid → the
    send-keys endpoint MUST return keys_sent=False and reason in
    {no_key_info, no_messaging}. No real message will ever be sent.
    """

    @pytest.fixture(scope="class")
    def manual_res_id(self, auth_headers, property_backup):
        pid, _ = property_backup
        # Ensure the property has NO key_instructions for the first subtest
        rget = requests.get(f"{BASE_URL}/api/properties/{pid}",
                            headers=auth_headers, timeout=30)
        prop = rget.json()
        body = _property_put_payload(prop, {"key_instructions": "",
                                            "key_photos": []})
        requests.put(f"{BASE_URL}/api/properties/{pid}",
                     headers=auth_headers, json=body, timeout=30)

        payload = {
            "property_id": pid,
            "guest_name": "TEST_SendKeys QA",
            "guest_first_name": "TEST",
            "guest_last_name": "SendKeys",
            "guest_email": "TEST_sendkeys@example.com",
            "platform": "Airbnb",  # simulate the Airbnb card scenario
            "check_in": "2030-02-10",
            "check_out": "2030-02-12",
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
        # Safety guard: the reservation must NOT be sourced from Lodgify
        assert r.json().get("source", "") != "lodgify"
        assert not r.json().get("thread_uid")
        yield rid, pid
        # Cleanup - always delete the reservation
        requests.delete(f"{BASE_URL}/api/reservations/{rid}",
                        headers=auth_headers, timeout=30)

    def test_send_keys_without_key_info_returns_no_key_info(
            self, auth_headers, manual_res_id):
        rid, _pid = manual_res_id
        r = requests.post(
            f"{BASE_URL}/api/reservations/{rid}/send-keys",
            headers=auth_headers,
            json={"base_url": BASE_URL},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("keys_sent") is False, j
        assert j.get("reason") == "no_key_info", j

    def test_send_keys_with_key_info_manual_returns_no_messaging(
            self, auth_headers, manual_res_id):
        rid, pid = manual_res_id
        # Set key_instructions on the property
        rget = requests.get(f"{BASE_URL}/api/properties/{pid}",
                            headers=auth_headers, timeout=30)
        prop = rget.json()
        body = _property_put_payload(prop, {
            "key_instructions": "TEST_QA Code boîte à clés 1234.",
        })
        rput = requests.put(f"{BASE_URL}/api/properties/{pid}",
                            headers=auth_headers, json=body, timeout=30)
        assert rput.status_code == 200, rput.text

        r = requests.post(
            f"{BASE_URL}/api/reservations/{rid}/send-keys",
            headers=auth_headers,
            json={"base_url": BASE_URL},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("keys_sent") is False, "MUST NOT send real message on manual res"
        # source != lodgify + no thread_uid → no_messaging
        assert j.get("reason") == "no_messaging", j

    def test_send_keys_404_on_unknown_reservation(self, auth_headers):
        fake = f"does-not-exist-{uuid.uuid4().hex}"
        r = requests.post(
            f"{BASE_URL}/api/reservations/{fake}/send-keys",
            headers=auth_headers,
            json={"base_url": BASE_URL},
            timeout=30,
        )
        assert r.status_code == 404, r.text
