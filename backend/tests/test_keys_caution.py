"""Tests iteration 17 - Casanéo « Clés » feature (key_instructions/key_photos)
and PATCH /api/reservations/{id}/caution-validated on manual reservation +
public GET /api/kp/{path} route.

Uses QA admin (qa.admin@casaneo.test) via POST /api/auth/login → Bearer token.
All test data (property key_instructions/key_photos, caution_validated,
temporary reservation) are restored/cleaned at the end.
"""
import os
import io
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
           os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")

QA_EMAIL = "qa.admin@casaneo.test"
QA_PASSWORD = "CasaneoQA2026!"


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


@pytest.fixture(scope="module")
def property_id_and_backup(auth_headers):
    """Pick the first property; snapshot key_instructions/key_photos so we can restore."""
    r = requests.get(f"{BASE_URL}/api/properties", headers=auth_headers, timeout=30)
    assert r.status_code == 200, r.text
    props = r.json()
    assert props, "no properties found for QA admin"
    p = props[0]
    pid = p["id"]
    backup = {
        "key_instructions": p.get("key_instructions", ""),
        "key_photos": p.get("key_photos", []),
    }
    yield pid, backup
    # Restore
    body = _property_put_payload(p, {
        "key_instructions": backup["key_instructions"],
        "key_photos": backup["key_photos"],
    })
    requests.put(f"{BASE_URL}/api/properties/{pid}", headers=auth_headers, json=body, timeout=30)


def _property_put_payload(prop: dict, overrides: dict) -> dict:
    """Build a PropertyIn payload from an existing property document."""
    fields = [
        "name", "address", "address_complement", "description", "rooms",
        "amenities", "seasons", "ical_links", "welcome_book_url",
        "management_fee_pct", "default_cleaning_fee", "default_tourist_tax",
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
                "default_tourist_tax") else []
        body[f] = v
    body.update(overrides)
    if not body.get("name"):
        body["name"] = prop.get("name") or "Test"
    return body


# ---------------------------------------------------------------------------
# 1) PropertyIn round-trip: key_instructions + key_photos persist
# ---------------------------------------------------------------------------
class TestPropertyKeysPersistence:
    def test_put_then_get_persists_key_instructions_and_photos(
            self, auth_headers, property_id_and_backup):
        pid, _backup = property_id_and_backup
        # Read current to preserve rest
        rget = requests.get(f"{BASE_URL}/api/properties/{pid}",
                            headers=auth_headers, timeout=30)
        assert rget.status_code == 200, rget.text
        prop = rget.json()

        instr = "TEST_KEYS Boîte à clés côté droit, code 4582."
        # Use two fake paths - the kp route test will upload a real one
        photos = [f"test/keys/{uuid.uuid4().hex}.jpg",
                  f"test/keys/{uuid.uuid4().hex}.jpg"]
        body = _property_put_payload(prop, {
            "key_instructions": instr,
            "key_photos": photos,
        })
        rput = requests.put(f"{BASE_URL}/api/properties/{pid}",
                            headers=auth_headers, json=body, timeout=30)
        assert rput.status_code == 200, rput.text

        rget2 = requests.get(f"{BASE_URL}/api/properties/{pid}",
                             headers=auth_headers, timeout=30)
        assert rget2.status_code == 200
        p2 = rget2.json()
        assert p2.get("key_instructions") == instr
        assert p2.get("key_photos") == photos


# ---------------------------------------------------------------------------
# 2) Public GET /api/kp/{path} — auth-less if registered in a property
# ---------------------------------------------------------------------------
class TestPublicKeyPhotoRoute:
    def test_kp_unknown_path_returns_404(self):
        r = requests.get(f"{BASE_URL}/api/kp/does-not-exist-{uuid.uuid4().hex}.jpg",
                         timeout=30)
        assert r.status_code == 404

    def test_upload_register_then_public_get_serves_image(
            self, auth_headers, property_id_and_backup):
        pid, _backup = property_id_and_backup
        # 1) Upload a tiny PNG via /api/upload (Bearer QA)
        # PNG 1x1 transparent
        png = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
               b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf"
               b"\xc0\x00\x00\x00\x03\x00\x01\x86\x8e\x1a\xff\x00\x00\x00\x00IEND\xaeB`\x82")
        files = {"file": ("k.png", io.BytesIO(png), "image/png")}
        up = requests.post(f"{BASE_URL}/api/upload",
                           headers=auth_headers, files=files, timeout=60)
        assert up.status_code == 200, up.text
        path = up.json()["path"]
        assert path

        # 2) GET /api/kp/{path} WITHOUT auth BEFORE registering → 404
        r0 = requests.get(f"{BASE_URL}/api/kp/{path}", timeout=30)
        assert r0.status_code == 404, "kp should refuse unregistered path"

        # 3) Register the path in this property's key_photos
        rget = requests.get(f"{BASE_URL}/api/properties/{pid}",
                            headers=auth_headers, timeout=30)
        prop = rget.json()
        body = _property_put_payload(prop, {"key_photos": [path]})
        rput = requests.put(f"{BASE_URL}/api/properties/{pid}",
                            headers=auth_headers, json=body, timeout=30)
        assert rput.status_code == 200, rput.text

        # 4) Public GET without Authorization → 200 + image content-type
        r = requests.get(f"{BASE_URL}/api/kp/{path}", timeout=30)
        assert r.status_code == 200, r.text
        ct = r.headers.get("content-type", "")
        assert ct.startswith("image/") or "png" in ct.lower(), ct
        assert len(r.content) > 0


# ---------------------------------------------------------------------------
# 3) PATCH /reservations/{id}/caution-validated on a MANUAL reservation
# ---------------------------------------------------------------------------
class TestCautionValidatedManual:
    @pytest.fixture(scope="class")
    def manual_reservation(self, auth_headers, property_id_and_backup):
        pid, _backup = property_id_and_backup
        payload = {
            "property_id": pid,
            "guest_name": "TEST_Caution QA",
            "guest_first_name": "TEST",
            "guest_last_name": "Caution",
            "guest_email": "TEST_caution@example.com",
            "platform": "Direct",
            "check_in": "2030-01-10",
            "check_out": "2030-01-12",
            "guests": 2,
            "nights_total": 200,
            "cleaning_fee": 40,
            "tourist_tax": 4,
            "total_price": 244,
        }
        r = requests.post(f"{BASE_URL}/api/reservations",
                          headers=auth_headers, json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        res = r.json()
        rid = res.get("id")
        assert rid
        yield rid
        # Cleanup
        requests.delete(f"{BASE_URL}/api/reservations/{rid}",
                        headers=auth_headers, timeout=30)

    def test_validated_true_manual_returns_keys_not_sent(
            self, auth_headers, manual_reservation):
        rid = manual_reservation
        r = requests.patch(
            f"{BASE_URL}/api/reservations/{rid}/caution-validated",
            headers=auth_headers,
            json={"validated": True, "base_url": BASE_URL},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("caution_validated") is True
        assert j.get("keys_sent") is False, j
        assert j.get("reason") in ("no_messaging", "no_channel",
                                   "no_key_info"), j.get("reason")
        # Persistence
        rl = requests.get(f"{BASE_URL}/api/reservations",
                          headers=auth_headers, timeout=30)
        assert rl.status_code == 200
        items = rl.json() if isinstance(rl.json(), list) else rl.json().get("items", [])
        found = [x for x in items if x.get("id") == rid]
        assert found and found[0].get("caution_validated") is True

    def test_validated_false_manual_unsets(
            self, auth_headers, manual_reservation):
        rid = manual_reservation
        r = requests.patch(
            f"{BASE_URL}/api/reservations/{rid}/caution-validated",
            headers=auth_headers,
            json={"validated": False, "base_url": BASE_URL},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("caution_validated") is False
        # PUT main should preserve caution_validated field integrity —
        # here we simply verify persistence
        rl = requests.get(f"{BASE_URL}/api/reservations",
                          headers=auth_headers, timeout=30)
        items = rl.json() if isinstance(rl.json(), list) else rl.json().get("items", [])
        found = [x for x in items if x.get("id") == rid]
        assert found and found[0].get("caution_validated") is False
