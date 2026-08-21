"""Tests for the iCal synchronization endpoint POST /api/properties/{id}/sync.

Serves crafted .ics feeds locally (backend can reach 127.0.0.1) and verifies
the sync endpoint imports/updates/deletes reservations correctly.
"""
import os
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://rental-hub-manager.preview.emergentagent.com",
).rstrip("/")


# ---------------------------------------------------------------- ICS server -
# In-memory registry so tests can rewrite the served payload on the fly.
# Each entry: {"body": str, "content_type": str, "status": int}
_ICS_STORE = {}


class _IcsHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        key = self.path.lstrip("/")
        entry = _ICS_STORE.get(key)
        if entry is None:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"not found")
            return
        body = entry["body"].encode("utf-8")
        self.send_response(entry.get("status", 200))
        self.send_header(
            "Content-Type",
            entry.get("content_type", "text/calendar; charset=utf-8"),
        )
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a, **kw):  # silence
        pass


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def ics_server():
    port = _free_port()
    srv = HTTPServer(("127.0.0.1", port), _IcsHandler)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    time.sleep(0.1)
    yield f"http://127.0.0.1:{port}"
    srv.shutdown()


def _set_ics(path: str, body: str, content_type: str = "text/calendar; charset=utf-8", status: int = 200):
    _ICS_STORE[path] = {"body": body, "content_type": content_type, "status": status}


# ---------------------------------------------------------------- Sample ICS -
ICS_TWO_EVENTS = (
    "BEGIN:VCALENDAR\r\n"
    "VERSION:2.0\r\n"
    "PRODID:-//Test//EN\r\n"
    "BEGIN:VEVENT\r\n"
    "UID:evt-1@test\r\n"
    "DTSTART;VALUE=DATE:20260110\r\n"
    "DTEND;VALUE=DATE:20260115\r\n"
    "SUMMARY:Reserved\r\n"
    "END:VEVENT\r\n"
    "BEGIN:VEVENT\r\n"
    "UID:evt-2@test\r\n"
    "DTSTART:20260220T140000Z\r\n"
    "DTEND:20260225T110000Z\r\n"
    "SUMMARY:Jean Dupont\r\n"
    " -Vacances\r\n"  # folded continuation
    "DESCRIPTION:Reservation code: HMABCD1234\\n4 guests\\, arriving 2pm\r\n"
    "END:VEVENT\r\n"
    "END:VCALENDAR\r\n"
)

ICS_ONE_EVENT = (
    "BEGIN:VCALENDAR\r\n"
    "VERSION:2.0\r\n"
    "BEGIN:VEVENT\r\n"
    "UID:evt-1@test\r\n"
    "DTSTART;VALUE=DATE:20260110\r\n"
    "DTEND;VALUE=DATE:20260115\r\n"
    "SUMMARY:Reserved\r\n"
    "END:VEVENT\r\n"
    "END:VCALENDAR\r\n"
)


# ---------------------------------------------------------------- Guards -----
class TestSyncAuthAndErrors:
    def test_sync_requires_auth(self, anon_client):
        r = anon_client.post(f"{BASE_URL}/api/properties/whatever/sync", json={})
        assert r.status_code == 401

    def test_sync_unknown_property_404(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/properties/does-not-exist/sync")
        assert r.status_code == 404

    def test_sync_property_without_links_returns_error_message(self, api_client):
        p = api_client.post(f"{BASE_URL}/api/properties", json={
            "name": "TEST_NoLinks", "location": "X",
        }).json()
        try:
            r = api_client.post(f"{BASE_URL}/api/properties/{p['id']}/sync")
            assert r.status_code == 200, r.text
            body = r.json()
            # response shape may or may not include 'details' when there are 0 links
            assert body["imported"] == 0
            assert body["updated"] == 0
            assert body["errors"] == ["Aucun lien iCal configuré"]
        finally:
            api_client.delete(f"{BASE_URL}/api/properties/{p['id']}")


# ---------------------------------------------------------------- Import ----
class TestSyncImport:
    def _make_prop(self, api_client, ics_url, platform="Airbnb"):
        return api_client.post(f"{BASE_URL}/api/properties", json={
            "name": "TEST_Sync", "location": "Nice",
            "ical_links": [{"platform": platform, "url": ics_url}],
        }).json()

    def test_import_creates_two_reservations(self, api_client, ics_server):
        _set_ics("initial.ics", ICS_TWO_EVENTS)
        prop = self._make_prop(api_client, f"{ics_server}/initial.ics")
        try:
            r = api_client.post(f"{BASE_URL}/api/properties/{prop['id']}/sync")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["imported"] == 2, body
            assert body["updated"] == 0
            assert body["errors"] == []
            # New response shape: details array with a human-readable line
            assert isinstance(body.get("details"), list)
            assert any("Airbnb" in d and "2" in d and "importée" in d for d in body["details"]), body["details"]

            res_list = api_client.get(
                f"{BASE_URL}/api/reservations?property_id={prop['id']}"
            ).json()
            assert len(res_list) == 2
            by_uid = {r["ical_uid"]: r for r in res_list}
            assert "evt-1@test" in by_uid and "evt-2@test" in by_uid

            r1 = by_uid["evt-1@test"]
            assert r1["check_in"] == "2026-01-10"
            assert r1["check_out"] == "2026-01-15"
            assert r1["status"] == "confirmee"
            assert r1["source"] == "ical"
            assert r1["platform"] == "Airbnb"
            # SUMMARY 'Reserved' -> anonymised guest_name
            assert r1["guest_name"] == "Réservation Airbnb"
            # No description on evt-1 -> notes still starts with 'Importé depuis'
            assert r1["notes"].startswith("Importé depuis"), r1["notes"]

            r2 = by_uid["evt-2@test"]
            assert r2["check_in"] == "2026-02-20"
            assert r2["check_out"] == "2026-02-25"
            # Real name SUMMARY preserved (folded line concatenated)
            assert r2["guest_name"].startswith("Jean Dupont")
            # DESCRIPTION content imported into notes (with \n unescaped, \, -> ,)
            assert "HMABCD1234" in r2["notes"], r2["notes"]
            assert "4 guests, arriving 2pm" in r2["notes"], r2["notes"]
        finally:
            api_client.delete(f"{BASE_URL}/api/properties/{prop['id']}")

    def test_sync_is_idempotent_then_removes_stale(self, api_client, ics_server):
        _set_ics("feed.ics", ICS_TWO_EVENTS)
        prop = self._make_prop(api_client, f"{ics_server}/feed.ics", platform="Booking")
        try:
            # 1st sync — creates 2
            r1 = api_client.post(f"{BASE_URL}/api/properties/{prop['id']}/sync").json()
            assert r1["imported"] == 2 and r1["updated"] == 0

            # 2nd sync — no new imports, both updated
            r2 = api_client.post(f"{BASE_URL}/api/properties/{prop['id']}/sync").json()
            assert r2["imported"] == 0, r2
            assert r2["updated"] == 2, r2
            assert isinstance(r2.get("details"), list) and r2["details"], r2
            assert any("2" in d and ("mise" in d or "à jour" in d) for d in r2["details"]), r2["details"]
            res_list = api_client.get(
                f"{BASE_URL}/api/reservations?property_id={prop['id']}"
            ).json()
            assert len(res_list) == 2  # no duplicates

            # Now remove one VEVENT from the feed and re-sync
            _set_ics("feed.ics", ICS_ONE_EVENT)
            r3 = api_client.post(f"{BASE_URL}/api/properties/{prop['id']}/sync").json()
            assert r3["updated"] == 1
            res_list = api_client.get(
                f"{BASE_URL}/api/reservations?property_id={prop['id']}"
            ).json()
            assert len(res_list) == 1
            assert res_list[0]["ical_uid"] == "evt-1@test"
        finally:
            api_client.delete(f"{BASE_URL}/api/properties/{prop['id']}")

    def test_bad_ics_url_records_error(self, api_client, ics_server):
        prop = self._make_prop(api_client, f"{ics_server}/missing.ics", platform="Vrbo")
        try:
            r = api_client.post(f"{BASE_URL}/api/properties/{prop['id']}/sync")
            assert r.status_code == 200
            body = r.json()
            assert body["imported"] == 0
            assert body["errors"]
            assert "Vrbo" in body["errors"][0]
            # details/errors should mention HTTP 404
            joined = " ".join(body.get("details", []) + body.get("errors", []))
            assert "404" in joined, joined
        finally:
            api_client.delete(f"{BASE_URL}/api/properties/{prop['id']}")

    def test_non_ical_html_response_is_rejected_without_crash(self, api_client, ics_server):
        """Point ical_links at an HTML page (no BEGIN:VCALENDAR).
        Response must be 200, no reservations created, details/errors mention
        that the link is not an iCal calendar."""
        html_body = (
            "<!doctype html><html><head><title>Airbnb</title></head>"
            "<body><h1>Login required</h1></body></html>"
        )
        _set_ics("not-ical.html", html_body, content_type="text/html; charset=utf-8")
        prop = self._make_prop(
            api_client, f"{ics_server}/not-ical.html", platform="Airbnb"
        )
        try:
            r = api_client.post(f"{BASE_URL}/api/properties/{prop['id']}/sync")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["imported"] == 0, body
            assert body["updated"] == 0, body
            joined = " ".join(body.get("details", []) + body.get("errors", []))
            assert "iCal" in joined or "calendrier" in joined, joined
            # No reservations were created
            res_list = api_client.get(
                f"{BASE_URL}/api/reservations?property_id={prop['id']}"
            ).json()
            assert res_list == []
        finally:
            api_client.delete(f"{BASE_URL}/api/properties/{prop['id']}")

    def test_empty_but_valid_calendar_reports_no_reservations(self, api_client, ics_server):
        """A valid iCal feed with zero VEVENT must yield imported=0 and a
        French 'aucune réservation dans le calendrier' details line."""
        empty = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n"
        _set_ics("empty.ics", empty)
        prop = self._make_prop(
            api_client, f"{ics_server}/empty.ics", platform="Booking"
        )
        try:
            r = api_client.post(f"{BASE_URL}/api/properties/{prop['id']}/sync")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["imported"] == 0, body
            assert body["updated"] == 0, body
            assert body.get("errors") == [], body
            details = body.get("details") or []
            assert any("aucune réservation" in d.lower() for d in details), details
        finally:
            api_client.delete(f"{BASE_URL}/api/properties/{prop['id']}")

    def test_http_404_response_reports_http_error(self, api_client, ics_server):
        """Point url to a local path that returns HTTP 404. details/errors
        must contain 'HTTP 404' and the endpoint must not crash."""
        prop = self._make_prop(
            api_client, f"{ics_server}/does-not-exist.ics", platform="Airbnb"
        )
        try:
            r = api_client.post(f"{BASE_URL}/api/properties/{prop['id']}/sync")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["imported"] == 0
            assert body["updated"] == 0
            joined = " ".join(body.get("details", []) + body.get("errors", []))
            assert "HTTP 404" in joined, joined
        finally:
            api_client.delete(f"{BASE_URL}/api/properties/{prop['id']}")


# ---------------------------------------------------------------- Parser -----
class TestParserUnit:
    """parse_ical() unit tests — DATE vs datetime, folded lines."""

    def test_parse_date_and_datetime_and_folding(self):
        import sys
        sys.path.insert(0, "/app/backend")
        from server import parse_ical  # noqa: WPS433

        events = parse_ical(ICS_TWO_EVENTS)
        assert len(events) == 2
        e1, e2 = events
        assert e1["start"] == "2026-01-10"
        assert e1["end"] == "2026-01-15"
        assert e1["summary"].lower() == "reserved"
        assert e2["start"] == "2026-02-20"
        assert e2["end"] == "2026-02-25"
        # folded line: continuation " -Vacances" appended
        assert "Jean Dupont" in e2["summary"]
        assert "Vacances" in e2["summary"]
