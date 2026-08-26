"""
Iteration 31 — Channex Messages & Reviews (Casanéo)
Tests the /api/inbox* and /api/reviews* endpoints for a QA admin member login.

SAFETY:
- Never call POST /api/inbox/{uid}/reply with a non-empty message — that writes to a real Booking/Airbnb guest.
- Never call POST /api/reviews/{id}/reply with non-empty text on an OTA review — that publishes a public reply.
- We ONLY test the empty-body 400 paths + the AI suggestion endpoint (safe: does not publish).
"""
import os
import requests
import pytest
from pathlib import Path

# Resolve BASE_URL from frontend/.env (same pattern as conftest)
_BE = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
if not _BE:
    for line in (Path(__file__).parent.parent.parent / "frontend" / ".env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            _BE = line.split("=", 1)[1].strip().strip('"')
            break
BASE_URL = _BE.rstrip("/")

QA_EMAIL = "qa.admin@casaneo.test"
QA_PASSWORD = "CasaneoQA2026!"


@pytest.fixture(scope="module")
def qa_session():
    """Login as QA admin member and return an authenticated requests.Session."""
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": QA_EMAIL, "password": QA_PASSWORD},
                      timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("session_token") or data.get("token")
    assert tok, f"No session_token in login response: {data}"
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json",
                      "Authorization": f"Bearer {tok}"})
    return s


# ---------- INBOX ----------

class TestInbox:
    """Channex threads sync + inbox list + unread count + single thread."""

    def test_inbox_list_has_channex_conversations(self, qa_session):
        # first call may trigger a throttled sync — allow 90s
        r = qa_session.get(f"{BASE_URL}/api/inbox", timeout=120)
        assert r.status_code == 200, f"GET /api/inbox → {r.status_code} {r.text[:400]}"
        convs = r.json()
        assert isinstance(convs, list), "inbox should return a list"
        assert len(convs) > 0, "expected at least 1 conversation for QA admin"

        channex_convs = [c for c in convs if c.get("provider") == "channex"]
        assert len(channex_convs) > 0, "expected at least 1 provider='channex' conversation"

        # verify required fields on every channex conv
        required = ["thread_uid", "guest_name", "source", "property_name",
                    "last_preview", "last_activity", "unread"]
        for c in channex_convs:
            missing = [k for k in required if k not in c]
            assert not missing, f"channex conv missing fields {missing}: {c}"
            assert c["source"] in ("Booking.com", "Airbnb", "Vrbo", "Direct"), \
                f"unexpected source '{c['source']}'"
            assert isinstance(c["unread"], bool), \
                f"unread must be bool, got {type(c['unread']).__name__}"

        # persist a channex thread_uid for later tests
        pytest.channex_thread_uid = channex_convs[0]["thread_uid"]

    def test_inbox_unread_count(self, qa_session):
        r = qa_session.get(f"{BASE_URL}/api/inbox-unread-count", timeout=30)
        assert r.status_code == 200, f"unread-count → {r.status_code} {r.text[:300]}"
        data = r.json()
        assert "count" in data and isinstance(data["count"], int) and data["count"] >= 0

    def test_get_single_channex_thread(self, qa_session):
        uid = getattr(pytest, "channex_thread_uid", None)
        if not uid:
            pytest.skip("no channex thread available")
        # LLM draft + translation — long
        r = qa_session.get(f"{BASE_URL}/api/inbox/{uid}", timeout=120)
        assert r.status_code == 200, f"GET /api/inbox/{uid} → {r.status_code} {r.text[:400]}"
        data = r.json()
        for k in ("thread_uid", "guest_name", "source", "messages"):
            assert k in data, f"missing key '{k}' in thread response: {list(data.keys())}"
        assert data["thread_uid"] == uid
        assert isinstance(data["messages"], list)
        # msgs may be empty for a brand-new channex thread; if present verify shape + order
        for m in data["messages"]:
            assert "id" in m and "text" in m and "date" in m and "mine" in m, \
                f"malformed message: {m}"
        dates = [m.get("date") for m in data["messages"] if m.get("date")]
        assert dates == sorted(dates), "messages must be chronologically sorted (asc)"

    def test_reply_empty_body_returns_400(self, qa_session):
        uid = getattr(pytest, "channex_thread_uid", None)
        if not uid:
            pytest.skip("no channex thread available")
        # SAFETY: empty message only — never send real text
        r = qa_session.post(f"{BASE_URL}/api/inbox/{uid}/reply",
                            json={"message": ""}, timeout=30)
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text[:300]}"
        detail = (r.json().get("detail") or "").lower()
        assert "vide" in detail or "empty" in detail, f"unexpected detail: {detail}"


# ---------- REVIEWS ----------

class TestReviews:
    """OTA reviews sync + summary + AI suggestion + guarded reply/delete."""

    def test_reviews_list_has_ota(self, qa_session):
        r = qa_session.get(f"{BASE_URL}/api/reviews", timeout=90)
        assert r.status_code == 200, f"GET /api/reviews → {r.status_code} {r.text[:400]}"
        items = r.json()
        assert isinstance(items, list)
        assert len(items) > 0, "expected at least 1 review"

        ota = [rv for rv in items if rv.get("channex_review_id")]
        assert len(ota) > 0, "expected at least 1 OTA review (channex_review_id set)"

        # every OTA review: fields + score10 > 0 + ota in ('Booking.com','Airbnb')
        for rv in ota:
            for k in ("channex_review_id", "ota", "score10", "rating",
                      "comment", "is_replied", "property_name", "date"):
                assert k in rv, f"OTA review missing field '{k}': {list(rv.keys())}"
            assert rv["ota"] in ("Booking.com", "Airbnb", "Vrbo"), \
                f"unexpected ota '{rv['ota']}'"
            assert isinstance(rv["score10"], (int, float)), \
                f"score10 not numeric: {rv['score10']!r}"
            assert float(rv["score10"]) > 0, \
                f"BUG: OTA review with score10=0 found: id={rv.get('id')} " \
                f"ota={rv.get('ota')} guest={rv.get('guest_name')}"
            # rating should be roughly score10/2 (allow rounding tolerance)
            assert abs(float(rv["rating"]) - float(rv["score10"]) / 2) < 1.5, \
                f"rating {rv['rating']} not consistent with score10 {rv['score10']}"

        pytest.ota_review_id = ota[0]["id"]
        # find an OTA review NOT yet replied (for ai-reply test)
        unreplied = [rv for rv in ota if not rv.get("is_replied")]
        pytest.ota_unreplied_id = (unreplied[0]["id"] if unreplied else ota[0]["id"])

    def test_reviews_summary(self, qa_session):
        r = qa_session.get(f"{BASE_URL}/api/reviews/summary", timeout=30)
        assert r.status_code == 200, f"summary → {r.status_code} {r.text[:300]}"
        data = r.json()
        for k in ("per_property", "total_reviews", "avg_all"):
            assert k in data, f"summary missing '{k}': {list(data.keys())}"
        assert isinstance(data["per_property"], list)
        assert isinstance(data["total_reviews"], int)
        assert data["total_reviews"] > 0
        assert isinstance(data["avg_all"], (int, float))
        assert 0 < data["avg_all"] <= 5, f"avg_all out of range 0..5: {data['avg_all']}"

    def test_ai_reply_generates_text(self, qa_session):
        rid = getattr(pytest, "ota_unreplied_id", None)
        if not rid:
            pytest.skip("no OTA review available")
        # LLM call — timeout 90s
        r = qa_session.post(f"{BASE_URL}/api/reviews/{rid}/ai-reply", timeout=90)
        assert r.status_code == 200, f"ai-reply → {r.status_code} {r.text[:400]}"
        data = r.json()
        assert "reply" in data
        assert isinstance(data["reply"], str)
        assert len(data["reply"].strip()) > 10, \
            f"AI reply too short: {data['reply']!r}"

    def test_reply_empty_body_returns_400(self, qa_session):
        rid = getattr(pytest, "ota_review_id", None)
        if not rid:
            pytest.skip("no OTA review available")
        # SAFETY: empty reply only
        r = qa_session.post(f"{BASE_URL}/api/reviews/{rid}/reply",
                            json={"reply": ""}, timeout=30)
        assert r.status_code == 400, f"expected 400 got {r.status_code} {r.text[:300]}"
        detail = (r.json().get("detail") or "").lower()
        assert "vide" in detail or "empty" in detail, f"unexpected detail: {detail}"

    def test_delete_ota_review_forbidden(self, qa_session):
        rid = getattr(pytest, "ota_review_id", None)
        if not rid:
            pytest.skip("no OTA review available")
        r = qa_session.delete(f"{BASE_URL}/api/reviews/{rid}", timeout=30)
        assert r.status_code == 400, f"expected 400 got {r.status_code} {r.text[:300]}"
        detail = (r.json().get("detail") or "").lower()
        assert "ota" in detail or "suppression" in detail, \
            f"unexpected detail: {detail}"

    def test_reply_on_local_review_forbidden(self, qa_session):
        """Create a local review, POST reply → 400 'Avis local — publication OTA impossible', then delete it."""
        # get a property_id
        rp = qa_session.get(f"{BASE_URL}/api/properties", timeout=30)
        assert rp.status_code == 200, f"properties → {rp.status_code}"
        props = rp.json()
        assert len(props) > 0, "no properties available"
        prop_id = props[0]["id"]

        # create local review
        payload = {"property_id": prop_id, "rating": 5,
                   "guest_name": "TEST_QA_local_review",
                   "comment": "TEST_QA local review for reply guard"}
        rc = qa_session.post(f"{BASE_URL}/api/reviews", json=payload, timeout=30)
        assert rc.status_code == 200, f"create review → {rc.status_code} {rc.text[:300]}"
        created = rc.json()
        assert not created.get("channex_review_id"), \
            "newly created local review must not have channex_review_id"
        local_id = created["id"]

        try:
            # reply with non-empty text → local review guard → 400
            rr = qa_session.post(f"{BASE_URL}/api/reviews/{local_id}/reply",
                                 json={"reply": "TEST_QA local reply — should be rejected"},
                                 timeout=30)
            assert rr.status_code == 400, \
                f"expected 400 for local review reply, got {rr.status_code} {rr.text[:300]}"
            detail = (rr.json().get("detail") or "").lower()
            assert "local" in detail and ("ota" in detail or "publication" in detail), \
                f"unexpected detail: {detail}"
        finally:
            # cleanup — delete the local review (must succeed, no channex_review_id)
            rd = qa_session.delete(f"{BASE_URL}/api/reviews/{local_id}", timeout=30)
            assert rd.status_code == 200, \
                f"cleanup delete failed: {rd.status_code} {rd.text[:300]}"
