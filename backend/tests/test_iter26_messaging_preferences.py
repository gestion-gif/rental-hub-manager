"""Iteration 26 backend tests — messaging multi-channel, preferences (getyourguide + cleaning_offset),
Airbnb tourist-tax consistency in owner statement, and inbox thread reservation_id.

Uses QA Admin (member) credentials — email/password auth (see /app/memory/test_credentials.md).
"""
import os
import re
import asyncio
from datetime import datetime, timezone, timedelta, date
from pathlib import Path

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

# --- Base URL: prefer frontend/.env EXPO_PUBLIC_BACKEND_URL -------------------
BASE_URL = None
fe_env = Path(__file__).parent.parent.parent / "frontend" / ".env"
if fe_env.exists():
    for line in fe_env.read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not found in frontend/.env"

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

QA_EMAIL = "qa.admin@casaneo.test"
QA_PASSWORD = "CasaneoQA2026!"
OWNER_UID = "user_e235f66c67c3"
RES_ID = "001a7c0e-362d-43d6-8eab-77b8ee093f27"
PROP_ID = "1b472b65-11da-48da-b1e3-8942c0e110bd"


# --- Session-scoped auth fixture ---------------------------------------------
@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": QA_EMAIL, "password": QA_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "session_token" in data
    return data["session_token"]


@pytest.fixture
def api(token):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    })
    return s


# =============================================================================
# 1) messaging/context — guest infos + channels + rendered templates/quick replies
# =============================================================================
class TestMessagingContext:
    def test_context_returns_all_channels_and_rendered_vars(self, api):
        r = api.get(f"{BASE_URL}/api/messaging/context", params={"reservation_id": RES_ID})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["reservation_id"] == RES_ID
        assert data["guest_name"], "guest_name must not be empty"
        # phone must be digits only (no + or spaces)
        assert data["guest_phone"], "guest_phone must be present"
        assert re.fullmatch(r"\d+", data["guest_phone"]), \
            f"guest_phone should be digits only, got {data['guest_phone']!r}"
        assert data["guest_email"] == "delivered@resend.dev"

        ch = data["channels"]
        assert ch["whatsapp"] is True
        assert ch["email"] is True
        assert "platform" in ch
        assert "available" in ch["platform"] and "provider" in ch["platform"]
        # No channex_booking_id in the test reservation → platform not available
        assert ch["platform"]["available"] is False
        assert ch["platform"]["provider"] is None

        # Templates & quick replies are lists of {id,name,body}
        assert isinstance(data["templates"], list) and len(data["templates"]) > 0
        assert isinstance(data["quick_replies"], list) and len(data["quick_replies"]) > 0
        for t in data["templates"] + data["quick_replies"]:
            assert t.get("id") and t.get("name") and "body" in t
            # Variables should be rendered — no raw {guest} etc left
            body = t["body"]
            for var in ("{guest}", "{property}", "{welcome_book}", "{caution}", "{activites}"):
                assert var not in body, f"Unrendered variable {var} in body: {body[:80]!r}"

    def test_context_not_found_returns_404(self, api):
        r = api.get(f"{BASE_URL}/api/messaging/context",
                    params={"reservation_id": "nonexistent-id-xyz"})
        assert r.status_code == 404, r.text


# =============================================================================
# 2) messaging/send — email OK, no_email, no_platform_thread, 400 empty body
# =============================================================================
class TestMessagingSend:
    def test_send_email_success(self, api):
        payload = {
            "reservation_id": RES_ID,
            "channel": "email",
            "subject": "TEST_QA — Test email",
            "body": "Bonjour, ceci est un test automatisé.",
        }
        r = api.post(f"{BASE_URL}/api/messaging/send", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("sent") is True
        assert data.get("channel") == "email"
        assert data.get("to") == "delivered@resend.dev"

    def test_send_email_no_email_returns_reason(self, api):
        # Create a reservation lacking guest_email, in the same owner scope
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        tmp_id = f"TEST_QA_no_email_{datetime.now(timezone.utc).timestamp()}"

        async def _setup():
            await db.reservations.insert_one({
                "id": tmp_id, "user_id": OWNER_UID, "property_id": PROP_ID,
                "guest_name": "TEST no-email", "guest_email": "", "guest_phone": "",
                "check_in": "2030-01-01", "check_out": "2030-01-05",
                "status": "confirmed", "platform": "direct",
            })

        async def _teardown():
            await db.reservations.delete_one({"id": tmp_id})

        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(_setup())
            r = api.post(f"{BASE_URL}/api/messaging/send", json={
                "reservation_id": tmp_id, "channel": "email",
                "subject": "x", "body": "hello",
            })
            assert r.status_code == 200, r.text
            data = r.json()
            assert data.get("sent") is False
            assert data.get("reason") == "no_email"
        finally:
            loop.run_until_complete(_teardown())
            loop.close()
            client.close()

    def test_send_platform_no_channex_booking_returns_reason(self, api):
        # RES_ID has no channex_booking_id → expect sent=False, reason=no_platform_thread
        r = api.post(f"{BASE_URL}/api/messaging/send", json={
            "reservation_id": RES_ID, "channel": "platform",
            "subject": "", "body": "hello via platform",
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("sent") is False
        assert data.get("reason") == "no_platform_thread"

    def test_send_empty_body_returns_400(self, api):
        r = api.post(f"{BASE_URL}/api/messaging/send", json={
            "reservation_id": RES_ID, "channel": "email",
            "subject": "s", "body": "   ",
        })
        assert r.status_code == 400, r.text

    def test_send_unknown_channel_returns_400(self, api):
        r = api.post(f"{BASE_URL}/api/messaging/send", json={
            "reservation_id": RES_ID, "channel": "sms",
            "subject": "", "body": "hi",
        })
        assert r.status_code == 400, r.text


# =============================================================================
# 3) Preferences — getyourguide_url + cleaning_offset_days (+ regen auto cleanings)
# =============================================================================
class TestPreferences:
    def test_get_preferences_has_new_fields(self, api):
        r = api.get(f"{BASE_URL}/api/preferences")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "cleaning_offset_days" in data
        assert isinstance(data["cleaning_offset_days"], int)
        assert "getyourguide_url" in data
        assert isinstance(data["getyourguide_url"], str)

    def test_put_getyourguide_url_persists(self, api):
        # GET current so we can restore afterwards
        cur = api.get(f"{BASE_URL}/api/preferences").json()
        original = cur.get("getyourguide_url", "")
        try:
            new_url = "https://x.example/qa-test"
            r = api.put(f"{BASE_URL}/api/preferences",
                        json={"getyourguide_url": new_url})
            assert r.status_code == 200, r.text
            assert r.json()["getyourguide_url"] == new_url
            # Verify by GET
            got = api.get(f"{BASE_URL}/api/preferences").json()
            assert got["getyourguide_url"] == new_url
        finally:
            api.put(f"{BASE_URL}/api/preferences",
                    json={"getyourguide_url": original})

    def test_put_cleaning_offset_persists_and_clamps(self, api):
        cur = api.get(f"{BASE_URL}/api/preferences").json()
        original = int(cur.get("cleaning_offset_days", 0))
        try:
            # Set valid offset = 2
            r = api.put(f"{BASE_URL}/api/preferences",
                        json={"cleaning_offset_days": 2})
            assert r.status_code == 200, r.text
            assert r.json()["cleaning_offset_days"] == 2

            got = api.get(f"{BASE_URL}/api/preferences").json()
            assert got["cleaning_offset_days"] == 2

            # Out-of-range gets clamped (0..14)
            r = api.put(f"{BASE_URL}/api/preferences",
                        json={"cleaning_offset_days": 999})
            assert r.status_code == 200
            assert r.json()["cleaning_offset_days"] == 14

            r = api.put(f"{BASE_URL}/api/preferences",
                        json={"cleaning_offset_days": -5})
            assert r.status_code == 200
            assert r.json()["cleaning_offset_days"] == 0
        finally:
            api.put(f"{BASE_URL}/api/preferences",
                    json={"cleaning_offset_days": original})

    def test_cleaning_offset_regenerates_future_auto_cleanings(self, api):
        """Create a future reservation, change the offset, verify auto interventions align."""
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]

        tmp_res = f"TEST_QA_cleanoffset_{datetime.now(timezone.utc).timestamp()}"
        future_ci = (date.today() + timedelta(days=30)).isoformat()
        future_co = (date.today() + timedelta(days=35)).isoformat()

        async def _setup():
            await db.reservations.insert_one({
                "id": tmp_res, "user_id": OWNER_UID, "property_id": PROP_ID,
                "guest_name": "TEST_QA cleaner", "guest_email": "", "guest_phone": "",
                "check_in": future_ci, "check_out": future_co,
                "status": "confirmed", "platform": "direct",
            })

        async def _list_auto():
            return await db.interventions.find({
                "user_id": OWNER_UID, "property_id": PROP_ID,
                "kind": "menage", "auto": True,
                "date": {"$gte": future_co},
            }, {"_id": 0}).to_list(50)

        async def _teardown():
            await db.reservations.delete_one({"id": tmp_res})
            await db.interventions.delete_many({
                "user_id": OWNER_UID, "property_id": PROP_ID,
                "auto": True, "date": {"$gte": future_co},
            })

        cur = api.get(f"{BASE_URL}/api/preferences").json()
        original = int(cur.get("cleaning_offset_days", 0))
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(_setup())

            # Force a change to trigger regenerate_auto_cleanings: pick an offset != current
            offset_a = 1 if original != 1 else 3
            offset_b = offset_a + 2

            # Offset A → expect a cleaning at check_out + offset_a
            r = api.put(f"{BASE_URL}/api/preferences",
                        json={"cleaning_offset_days": offset_a})
            assert r.status_code == 200
            expected_a = (date.fromisoformat(future_co) + timedelta(days=offset_a)).isoformat()
            interv_a = loop.run_until_complete(_list_auto())
            dates_a = [i["date"] for i in interv_a]
            assert expected_a in dates_a, f"Expected cleaning at {expected_a}, got {dates_a}"

            # Change offset to B → expect regeneration at check_out + offset_b
            r = api.put(f"{BASE_URL}/api/preferences",
                        json={"cleaning_offset_days": offset_b})
            assert r.status_code == 200
            expected_b = (date.fromisoformat(future_co) + timedelta(days=offset_b)).isoformat()
            interv_b = loop.run_until_complete(_list_auto())
            dates_b = [i["date"] for i in interv_b]
            assert expected_b in dates_b, \
                f"Expected regenerated cleaning at {expected_b}, got {dates_b}"
            # And the old offset_a auto cleaning should be gone
            assert expected_a not in dates_b, \
                f"Old J+{offset_a} cleaning should be removed, got {dates_b}"
        finally:
            api.put(f"{BASE_URL}/api/preferences",
                    json={"cleaning_offset_days": original})
            loop.run_until_complete(_teardown())
            loop.close()
            client.close()


# =============================================================================
# 4) Owner statement — Airbnb tourist-tax split (excluded from to_reverse)
# =============================================================================
class TestOwnerStatementAirbnbTax:
    def test_airbnb_tax_excluded_from_to_reverse(self, api):
        """Insert a controlled Airbnb reservation with a known tax amount and verify totals."""
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]

        # Use a month sufficiently far in the future to avoid interfering with real data
        target_month_dt = date(2030, 7, 1)
        month_key = target_month_dt.strftime("%Y-%m")
        ci = target_month_dt.replace(day=10).isoformat()
        co = target_month_dt.replace(day=15).isoformat()

        tmp_res = f"TEST_QA_abnb_{int(datetime.now(timezone.utc).timestamp())}"
        tax_amount = 12.50

        async def _setup():
            await db.reservations.insert_one({
                "id": tmp_res, "user_id": OWNER_UID, "property_id": PROP_ID,
                "guest_name": "TEST_QA Airbnb", "guest_email": "", "guest_phone": "",
                "check_in": ci, "check_out": co,
                "status": "confirmed",
                "platform": "Airbnb",
                "nights_total": 500.0,
                "cleaning_fee": 60.0,
                "tourist_tax": tax_amount,
                "finance": {"commission": 75.0},
            })

        async def _teardown():
            await db.reservations.delete_one({"id": tmp_res})

        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(_setup())

            r = api.get(f"{BASE_URL}/api/owner-statement",
                        params={"month": month_key, "property_id": PROP_ID})
            assert r.status_code == 200, r.text
            data = r.json()
            stmts = data.get("statements") or []
            assert len(stmts) == 1, f"Expected 1 statement, got {len(stmts)}"
            t = stmts[0]["totals"]

            # New/updated fields
            assert "tax_airbnb_collected" in t, "totals.tax_airbnb_collected missing"
            assert "tourist_tax_to_reverse" in t

            # Airbnb-collected must equal the reservation's tax
            assert abs(float(t["tax_airbnb_collected"]) - tax_amount) < 0.01, \
                f"tax_airbnb_collected={t['tax_airbnb_collected']} expected {tax_amount}"

            # tourist_tax_to_reverse should NOT include the Airbnb-collected tax
            # (test property has no other reservations in 2030-07 so it should be 0)
            assert abs(float(t["tourist_tax_to_reverse"])) < 0.01, \
                f"tourist_tax_to_reverse should exclude Airbnb tax, got {t['tourist_tax_to_reverse']}"

            # owner_revenue must be independent of the tax field
            # = nights - mgmt_fee - commission - owner_expenses
            expected_owner = round(500.0 - t["management_fee"] - t["commission"] - t["owner_expenses"], 2)
            assert abs(float(t["owner_revenue"]) - expected_owner) < 0.01, \
                f"owner_revenue mismatch: got {t['owner_revenue']}, expected {expected_owner}"
        finally:
            loop.run_until_complete(_teardown())
            loop.close()
            client.close()


# =============================================================================
# 5) Inbox — GET /inbox/{thread_uid} now returns reservation_id
# =============================================================================
class TestInboxThreadReservationId:
    def test_inbox_thread_returns_reservation_id_field(self, api):
        """Look for any existing conversation for this owner; verify reservation_id present in response.

        We don't require a real channel manager connection because the endpoint requires it —
        we skip if none is configured, but still verify the code path returns reservation_id key.
        """
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]

        async def _find_conv():
            return await db.conversations.find_one({"user_id": OWNER_UID}, {"_id": 0})

        loop = asyncio.new_event_loop()
        try:
            conv = loop.run_until_complete(_find_conv())
        finally:
            loop.close()
            client.close()

        if not conv or not conv.get("thread_uid"):
            pytest.skip("No conversation available for owner — cannot test inbox thread")

        r = api.get(f"{BASE_URL}/api/inbox/{conv['thread_uid']}")
        # If channel manager not connected, endpoint returns 400 — accept and skip
        if r.status_code == 400:
            pytest.skip(f"Channel manager not connected: {r.text}")
        assert r.status_code == 200, r.text
        data = r.json()
        # Explicit key check — field must be present (value can be None if unmatched)
        assert "reservation_id" in data, \
            f"reservation_id field missing from inbox thread response: {list(data.keys())}"
