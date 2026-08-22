"""Iteration 7 — Auto-cleaning + intervention done/not_done_reason/auto fields.

Covers:
- InterventionIn extra fields (done, not_done_reason, auto) persist and return.
- PUT can mark intervention done=true with a reason.
- Dashboard.interventions excludes done=true future items but keeps done=false.
- POST /reservations auto-creates a 'menage' auto=True intervention on check_out.
- Idempotency: 2nd reservation same property+check_out doesn't duplicate.
- status='annulee' does NOT create auto-cleaning.
- PUT reservation with new check_out creates a menage on the new date.
- iCal sync creates auto-cleaning on each imported booking's checkout date.
"""
import os
import socket
import threading
import time
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://rental-hub-manager.preview.emergentagent.com",
).rstrip("/")


# ---------------------------- Local ICS server for sync test ----------------
_ICS_STORE = {}


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        entry = _ICS_STORE.get(self.path.lstrip("/"))
        if not entry:
            self.send_response(404)
            self.end_headers()
            return
        b = entry["body"].encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/calendar; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def log_message(self, *a, **kw):
        pass


def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def ics_server():
    port = _free_port()
    srv = HTTPServer(("127.0.0.1", port), _Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    time.sleep(0.1)
    yield f"http://127.0.0.1:{port}"
    srv.shutdown()


# ---------------------------- Helpers ---------------------------------------
@pytest.fixture
def prop_a(api_client):
    p = api_client.post(f"{BASE_URL}/api/properties", json={"name": "TEST_AutoClean"}).json()
    yield p
    api_client.delete(f"{BASE_URL}/api/properties/{p['id']}")


def _list_ivs(api_client, pid):
    return api_client.get(f"{BASE_URL}/api/interventions?property_id={pid}").json()


def _auto_menage(items, on_date):
    return [x for x in items if x.get("auto") is True and x.get("kind") == "menage" and x.get("date") == on_date]


# ---------------------------- Intervention new fields -----------------------
class TestInterventionFields:
    def test_post_persists_done_reason_auto_and_get_returns_them(self, api_client, prop_a):
        d = (date.today() + timedelta(days=4)).isoformat()
        payload = {
            "property_id": prop_a["id"],
            "kind": "intervention",
            "date": d,
            "description": "TEST_new_fields",
            "intervenant": "TEST",
            "done": True,
            "not_done_reason": "n/a",
            "auto": False,
        }
        r = api_client.post(f"{BASE_URL}/api/interventions", json=payload)
        assert r.status_code == 200, r.text
        iv = r.json()
        assert iv["done"] is True
        assert iv["not_done_reason"] == "n/a"
        assert iv["auto"] is False
        assert "_id" not in iv
        try:
            got = next(x for x in _list_ivs(api_client, prop_a["id"]) if x["id"] == iv["id"])
            assert got["done"] is True
            assert got["not_done_reason"] == "n/a"
            assert got["auto"] is False
        finally:
            api_client.delete(f"{BASE_URL}/api/interventions/{iv['id']}")

    def test_put_can_mark_done_and_set_reason(self, api_client, prop_a):
        d = (date.today() + timedelta(days=3)).isoformat()
        iv = api_client.post(f"{BASE_URL}/api/interventions", json={
            "property_id": prop_a["id"], "kind": "menage", "date": d,
            "description": "TEST_put_done",
        }).json()
        try:
            r = api_client.put(f"{BASE_URL}/api/interventions/{iv['id']}", json={
                "property_id": prop_a["id"], "kind": "menage", "date": d,
                "description": "TEST_put_done",
                "done": True, "not_done_reason": "fait tôt le matin",
            })
            assert r.status_code == 200, r.text
            up = r.json()
            assert up["done"] is True
            assert up["not_done_reason"] == "fait tôt le matin"
        finally:
            api_client.delete(f"{BASE_URL}/api/interventions/{iv['id']}")

    def test_auth_still_guards_new_endpoints(self, anon_client):
        r = anon_client.post(f"{BASE_URL}/api/interventions", json={
            "property_id": "x", "kind": "menage", "date": "2026-01-01",
            "done": True, "not_done_reason": "", "auto": True,
        })
        assert r.status_code == 401


# ---------------------------- Dashboard exclusion of done -------------------
class TestDashboardExcludesDone:
    def test_done_future_excluded_and_not_done_future_included(self, api_client, prop_a):
        future = (date.today() + timedelta(days=6)).isoformat()
        done_iv = api_client.post(f"{BASE_URL}/api/interventions", json={
            "property_id": prop_a["id"], "kind": "menage", "date": future,
            "description": "TEST_done_hidden", "done": True,
        }).json()
        pending = api_client.post(f"{BASE_URL}/api/interventions", json={
            "property_id": prop_a["id"], "kind": "intervention", "date": future,
            "description": "TEST_pending_shown", "done": False,
        }).json()
        try:
            d = api_client.get(f"{BASE_URL}/api/dashboard").json()
            ids = {x["id"] for x in d["interventions"]}
            assert done_iv["id"] not in ids, "done=True intervention must be excluded"
            assert pending["id"] in ids, "done=False future intervention must appear"
        finally:
            api_client.delete(f"{BASE_URL}/api/interventions/{done_iv['id']}")
            api_client.delete(f"{BASE_URL}/api/interventions/{pending['id']}")


# ---------------------------- Auto-cleaning on POST reservation -------------
class TestAutoCleaningOnCreate:
    def test_menage_auto_created_on_checkout_date(self, api_client, prop_a):
        checkout = (date.today() + timedelta(days=10)).isoformat()
        checkin = (date.today() + timedelta(days=7)).isoformat()
        res = api_client.post(f"{BASE_URL}/api/reservations", json={
            "property_id": prop_a["id"], "guest_name": "TEST_AC1",
            "check_in": checkin, "check_out": checkout, "status": "confirmee",
        }).json()
        try:
            items = _list_ivs(api_client, prop_a["id"])
            hits = _auto_menage(items, checkout)
            assert len(hits) == 1, f"expected 1 auto menage on {checkout}, got {hits}"
            iv = hits[0]
            assert iv["kind"] == "menage"
            assert iv["auto"] is True
            assert iv["date"] == checkout
            assert iv["property_id"] == prop_a["id"]
        finally:
            api_client.delete(f"{BASE_URL}/api/reservations/{res['id']}")
            # cleanup auto-cleaning too
            for x in _auto_menage(_list_ivs(api_client, prop_a["id"]), checkout):
                api_client.delete(f"{BASE_URL}/api/interventions/{x['id']}")

    def test_idempotent_same_property_and_checkout(self, api_client, prop_a):
        checkout = (date.today() + timedelta(days=12)).isoformat()
        r1 = api_client.post(f"{BASE_URL}/api/reservations", json={
            "property_id": prop_a["id"], "guest_name": "TEST_AC_R1",
            "check_in": (date.today() + timedelta(days=8)).isoformat(),
            "check_out": checkout, "status": "confirmee",
        }).json()
        r2 = api_client.post(f"{BASE_URL}/api/reservations", json={
            "property_id": prop_a["id"], "guest_name": "TEST_AC_R2",
            "check_in": (date.today() + timedelta(days=9)).isoformat(),
            "check_out": checkout, "status": "confirmee",
        }).json()
        try:
            hits = _auto_menage(_list_ivs(api_client, prop_a["id"]), checkout)
            assert len(hits) == 1, f"expected idempotent single auto menage, got {len(hits)}: {hits}"
        finally:
            api_client.delete(f"{BASE_URL}/api/reservations/{r1['id']}")
            api_client.delete(f"{BASE_URL}/api/reservations/{r2['id']}")
            for x in _auto_menage(_list_ivs(api_client, prop_a["id"]), checkout):
                api_client.delete(f"{BASE_URL}/api/interventions/{x['id']}")

    def test_annulee_does_not_create_auto_cleaning(self, api_client, prop_a):
        checkout = (date.today() + timedelta(days=14)).isoformat()
        res = api_client.post(f"{BASE_URL}/api/reservations", json={
            "property_id": prop_a["id"], "guest_name": "TEST_AC_Cancel",
            "check_in": (date.today() + timedelta(days=11)).isoformat(),
            "check_out": checkout, "status": "annulee",
        }).json()
        try:
            hits = _auto_menage(_list_ivs(api_client, prop_a["id"]), checkout)
            assert hits == [], f"annulee must not trigger auto-cleaning, got {hits}"
        finally:
            api_client.delete(f"{BASE_URL}/api/reservations/{res['id']}")


# ---------------------------- Auto-cleaning on PUT reservation --------------
class TestAutoCleaningOnUpdate:
    def test_put_new_checkout_creates_new_auto_menage(self, api_client, prop_a):
        old_co = (date.today() + timedelta(days=20)).isoformat()
        new_co = (date.today() + timedelta(days=25)).isoformat()
        res = api_client.post(f"{BASE_URL}/api/reservations", json={
            "property_id": prop_a["id"], "guest_name": "TEST_AC_Upd",
            "check_in": (date.today() + timedelta(days=18)).isoformat(),
            "check_out": old_co, "status": "confirmee",
        }).json()
        try:
            # sanity: initial auto-cleaning on old_co
            assert len(_auto_menage(_list_ivs(api_client, prop_a["id"]), old_co)) == 1

            r = api_client.put(f"{BASE_URL}/api/reservations/{res['id']}", json={
                "property_id": prop_a["id"], "guest_name": "TEST_AC_Upd",
                "check_in": (date.today() + timedelta(days=18)).isoformat(),
                "check_out": new_co, "status": "confirmee",
            })
            assert r.status_code == 200
            hits_new = _auto_menage(_list_ivs(api_client, prop_a["id"]), new_co)
            assert len(hits_new) == 1, f"expected auto menage on new checkout, got {hits_new}"
        finally:
            api_client.delete(f"{BASE_URL}/api/reservations/{res['id']}")
            for d in (old_co, new_co):
                for x in _auto_menage(_list_ivs(api_client, prop_a["id"]), d):
                    api_client.delete(f"{BASE_URL}/api/interventions/{x['id']}")


# ---------------------------- Auto-cleaning on iCal sync --------------------
def _ics_body_future():
    """Build an ICS body with DTEND ~30 days in the future so it survives the past-ménage purge."""
    today = date.today()
    start = today + timedelta(days=25)
    end = today + timedelta(days=30)
    return (
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"
        "BEGIN:VEVENT\r\nUID:auto-clean-1@t\r\n"
        f"DTSTART;VALUE=DATE:{start.strftime('%Y%m%d')}\r\nDTEND;VALUE=DATE:{end.strftime('%Y%m%d')}\r\n"
        "SUMMARY:Reserved\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
    ), end.isoformat()


class TestAutoCleaningIcalSync:
    def test_sync_creates_auto_menage_on_event_checkout(self, api_client, ics_server):
        body, expected_date = _ics_body_future()
        _ICS_STORE["ac.ics"] = {"body": body}
        p = api_client.post(f"{BASE_URL}/api/properties", json={
            "name": "TEST_SyncAC",
            "ical_links": [{"platform": "Airbnb", "url": f"{ics_server}/ac.ics"}],
        }).json()
        try:
            r = api_client.post(f"{BASE_URL}/api/properties/{p['id']}/sync")
            assert r.status_code == 200, r.text
            hits = _auto_menage(_list_ivs(api_client, p["id"]), expected_date)
            assert len(hits) == 1, f"iCal sync should create auto menage on {expected_date}, got {hits}"
            assert hits[0]["kind"] == "menage"
            assert hits[0]["auto"] is True
        finally:
            api_client.delete(f"{BASE_URL}/api/properties/{p['id']}")
            # residual auto-cleaning cleanup
            for x in _auto_menage(_list_ivs(api_client, p["id"]), expected_date):
                api_client.delete(f"{BASE_URL}/api/interventions/{x['id']}")
