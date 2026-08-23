"""Tests: company header/coordinates in statements + grouped owner emails.
Emails are MOCKED (no real send) so real owners are never contacted."""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402

OWNER_UID = "user_e235f66c67c3"  # QA owner (gestion@mhpimmo.fr)


def test_company_header_html_and_body():
    company = {
        "name": "Casanéo Conciergerie", "address": "12 rue des Oliviers",
        "postal_code": "06000", "city": "Nice", "phone": "+33 6 12 34 56 78",
        "email": "contact@casaneo.fr", "website": "www.casaneo.fr",
        "siret": "123 456 789 00012", "vat": "FR123",
    }
    logo_url = "https://rental-hub-manager.preview.emergentagent.com/api/assets/casaneo-logo.png"
    header = server._company_header_html(company, logo_url)
    assert "Casanéo Conciergerie" in header
    assert "12 rue des Oliviers" in header
    assert "06000 Nice" in header
    assert "contact@casaneo.fr" in header
    assert "SIRET 123 456 789 00012" in header
    assert logo_url in header  # logo image embedded

    # Fallback to text logo when no url
    header2 = server._company_header_html(company, "")
    assert "<img" not in header2
    assert "Casanéo" in header2


def test_build_company_defaults():
    c = server._build_company(None)
    assert set(c.keys()) == set(server._COMPANY_KEYS)
    assert all(v == "" for v in c.values())


def _fake_user(uid):
    return {"user_id": uid, "role": "owner", "allowed_property_ids": None, "permissions": []}


def test_email_all_groups_by_owner_mocked():
    """email-all must send ONE combined email per owner (with email), mocked."""
    sent = []

    async def _mock_send_email(*, to, subject, html, reply_to=None):
        sent.append({"to": to, "subject": subject, "html": html})
        return "mock-id"

    orig = server.send_email
    server.send_email = _mock_send_email
    try:
        payload = server.StatementEmailAllIn(
            month="2026-06",
            base_url="https://rental-hub-manager.preview.emergentagent.com",
        )
        res = asyncio.get_event_loop().run_until_complete(
            server.email_all_owner_statements(payload, user=_fake_user(OWNER_UID))
        )
    finally:
        server.send_email = orig

    print("RESULT:", res.get("sent"), "owners:", len(res.get("results", [])))
    # Number of real sends equals number of results marked sent
    assert res["sent"] == sum(1 for r in res["results"] if r.get("sent"))
    # Each mocked send corresponds to one owner (grouped) — combined html has company header block
    for m in sent:
        assert "Relevé de gestion" in m["html"]
        assert "Revenu propriétaire" in m["html"]
    # Owners with several properties → a single email containing multiple property sections
    for r in res["results"]:
        if r.get("sent") and "," in (r.get("properties") or ""):
            match = next((m for m in sent if m["to"] == r["to"]), None)
            assert match is not None
            # combined total block present for multi-property owners
            assert "Total revenu propriétaire" in match["html"]
    print("MOCKED SENDS:", [(m["to"], m["subject"]) for m in sent])
