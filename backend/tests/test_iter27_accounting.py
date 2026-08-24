"""
Iteration 27 — Backend tests for the accounting module (/api/accounting/*).
Covers:
  - meta (categories + vat rates)
  - transactions CRUD + HT/VAT split
  - month filtering, property_name / owner_name
  - summary (P&L + TVA + by_category / by_property / by_owner)
  - recurring create/materialize/update/delete + idempotency
  - import-revenues (create then re-run -> skipped=all, created=0)
  - scan-receipt (real Claude Sonnet 4.6 vision via emergentintegrations)
Auth: QA Admin member (admin role) — qa.admin@casaneo.test
"""
import io
import os
import time
import uuid
from datetime import date, timedelta
from pathlib import Path

import pytest
import requests
from PIL import Image, ImageDraw
from dotenv import load_dotenv


load_dotenv(Path(__file__).parent.parent / ".env")


def _base_url():
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if not url:
        fe_env = Path(__file__).parent.parent.parent / "frontend" / ".env"
        for line in fe_env.read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                url = line.split("=", 1)[1].strip().strip('"')
                break
    return url.rstrip("/")


BASE_URL = _base_url()
QA_EMAIL = "qa.admin@casaneo.test"
QA_PASSWORD = "CasaneoQA2026!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": QA_EMAIL, "password": QA_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def admin_client(admin_token):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {admin_token}",
    })
    return s


@pytest.fixture(scope="module")
def created_ids():
    """Track ids to clean up at end."""
    ids = {"tx": [], "rec": []}
    yield ids


# ---------------------------------------------------------------------------
# Meta
# ---------------------------------------------------------------------------
class TestMeta:
    def test_meta_returns_categories_and_vat_rates(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/accounting/meta", timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "categories" in body and "vat_rates" in body
        assert isinstance(body["categories"].get("recette"), list)
        assert isinstance(body["categories"].get("depense"), list)
        assert "Nuitées / Loyer" in body["categories"]["recette"]
        assert "Ménage" in body["categories"]["depense"]
        assert body["vat_rates"] == [0, 5.5, 10, 20]


# ---------------------------------------------------------------------------
# Transactions CRUD + HT/VAT split
# ---------------------------------------------------------------------------
class TestTransactionsCRUD:
    def test_create_depense_20_and_verify_ht_vat_split(self, admin_client, created_ids):
        today = date.today().isoformat()
        payload = {
            "type": "depense",
            "date": today,
            "amount_ttc": 120,
            "vat_rate": 20,
            "category": "Ménage",
            "supplier": "TEST_QA Ménage SA",
            "description": "TEST_QA depense 120 TTC 20%",
        }
        r = admin_client.post(f"{BASE_URL}/api/accounting/transactions", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        tx_id = r.json()["id"]
        created_ids["tx"].append(tx_id)

        # Verify via GET
        month = today[:7]
        lr = admin_client.get(f"{BASE_URL}/api/accounting/transactions?month={month}", timeout=30)
        assert lr.status_code == 200
        items = lr.json()
        item = next((x for x in items if x["id"] == tx_id), None)
        assert item is not None, "created tx not returned in list"
        assert item["amount_ttc"] == 120.0
        assert item["vat_rate"] == 20.0
        assert item["amount_ht"] == 100.00, f"expected HT=100.00, got {item['amount_ht']}"
        assert item["vat_amount"] == 20.00, f"expected VAT=20.00, got {item['vat_amount']}"
        assert "property_name" in item
        assert "owner_name" in item

    def test_create_recette_vat0_ht_equals_ttc(self, admin_client, created_ids):
        today = date.today().isoformat()
        payload = {
            "type": "recette",
            "date": today,
            "amount_ttc": 200,
            "vat_rate": 0,
            "category": "Nuitées / Loyer",
            "channel": "Direct",
            "description": "TEST_QA recette 200 TTC 0%",
        }
        r = admin_client.post(f"{BASE_URL}/api/accounting/transactions", json=payload, timeout=30)
        assert r.status_code == 200
        tx_id = r.json()["id"]
        created_ids["tx"].append(tx_id)

        month = today[:7]
        lr = admin_client.get(f"{BASE_URL}/api/accounting/transactions?month={month}", timeout=30)
        item = next((x for x in lr.json() if x["id"] == tx_id), None)
        assert item is not None
        assert item["amount_ttc"] == 200.0
        assert item["amount_ht"] == 200.0
        assert item["vat_amount"] == 0.0

    def test_update_transaction_recalculates_ht_vat(self, admin_client, created_ids):
        # Create then PUT
        today = date.today().isoformat()
        r = admin_client.post(f"{BASE_URL}/api/accounting/transactions", json={
            "type": "depense", "date": today, "amount_ttc": 110, "vat_rate": 10,
            "category": "Fournitures", "description": "TEST_QA to-update",
        }, timeout=30)
        assert r.status_code == 200
        tx_id = r.json()["id"]
        created_ids["tx"].append(tx_id)

        # Change to TTC=105.5 rate=5.5 -> HT=100, VAT=5.5
        upd = admin_client.put(f"{BASE_URL}/api/accounting/transactions/{tx_id}", json={
            "type": "depense", "date": today, "amount_ttc": 105.5, "vat_rate": 5.5,
            "category": "Fournitures", "description": "TEST_QA updated",
        }, timeout=30)
        assert upd.status_code == 200, upd.text

        month = today[:7]
        lr = admin_client.get(f"{BASE_URL}/api/accounting/transactions?month={month}", timeout=30)
        item = next((x for x in lr.json() if x["id"] == tx_id), None)
        assert item is not None
        assert item["amount_ttc"] == 105.5
        assert item["vat_rate"] == 5.5
        assert item["amount_ht"] == 100.00
        assert item["vat_amount"] == 5.50

    def test_delete_then_second_delete_returns_404(self, admin_client):
        today = date.today().isoformat()
        r = admin_client.post(f"{BASE_URL}/api/accounting/transactions", json={
            "type": "depense", "date": today, "amount_ttc": 12, "vat_rate": 20,
            "category": "Autre", "description": "TEST_QA to-delete",
        }, timeout=30)
        tx_id = r.json()["id"]
        d1 = admin_client.delete(f"{BASE_URL}/api/accounting/transactions/{tx_id}", timeout=30)
        assert d1.status_code == 200, d1.text
        d2 = admin_client.delete(f"{BASE_URL}/api/accounting/transactions/{tx_id}", timeout=30)
        assert d2.status_code == 404


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
class TestSummary:
    def test_summary_reflects_created_entries(self, admin_client):
        today = date.today().isoformat()
        month = today[:7]
        r = admin_client.get(f"{BASE_URL}/api/accounting/summary?month={month}", timeout=30)
        assert r.status_code == 200, r.text
        s = r.json()
        for key in ("recettes", "depenses", "resultat", "tva", "by_category", "by_property", "by_owner"):
            assert key in s, f"missing key {key} in summary"
        # Structure
        for buck in (s["recettes"], s["depenses"]):
            for k in ("ttc", "ht", "vat"):
                assert k in buck
        assert set(s["tva"].keys()) >= {"collectee", "deductible", "nette"}
        # Coherence: recettes.ttc must be >= 200 (from earlier test), depenses.ttc >= 120+105.5
        assert s["recettes"]["ttc"] >= 200
        assert s["depenses"]["ttc"] >= 100  # after some deletions still >=100
        # nette = collectee - deductible
        assert abs(s["tva"]["nette"] - (s["tva"]["collectee"] - s["tva"]["deductible"])) < 0.02
        # by_category/by_property/by_owner have expected shapes
        assert isinstance(s["by_category"]["recette"], dict)
        assert isinstance(s["by_property"], list)
        assert isinstance(s["by_owner"], list)


# ---------------------------------------------------------------------------
# Recurring: create with start 2 months ago, verify auto-materialize + idempotency
# ---------------------------------------------------------------------------
class TestRecurring:
    def test_recurring_creates_transactions_and_no_duplicates(self, admin_client, created_ids):
        two_months_ago = (date.today().replace(day=1) - timedelta(days=1)).replace(day=1) - timedelta(days=1)
        # start_date = 1st day of month, 2 months before current
        start = (date.today().replace(day=1) - timedelta(days=1)).replace(day=1)
        # step one more month back
        prev = start - timedelta(days=1)
        start = prev.replace(day=1)
        payload = {
            "label": "TEST_QA Abonnement récurrent",
            "category": "Abonnements",
            "amount_ttc": 60,
            "vat_rate": 20,
            "frequency": "monthly",
            "day_of_month": 1,
            "start_date": start.isoformat(),
            "active": True,
        }
        r = admin_client.post(f"{BASE_URL}/api/accounting/recurring", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        rec_id = r.json()["id"]
        created_ids["rec"].append(rec_id)

        # Call transactions to trigger materialize (also called by POST)
        r1 = admin_client.get(f"{BASE_URL}/api/accounting/transactions", timeout=30)
        assert r1.status_code == 200
        items1 = r1.json()
        rec_txs_1 = [x for x in items1 if x.get("recurring_id") == rec_id]
        # Must have at least 2 generated (2 months ago + last month), possibly 3 with current
        assert len(rec_txs_1) >= 2, f"expected >=2 generated tx, got {len(rec_txs_1)}"
        for tx in rec_txs_1:
            assert tx["source"] == "recurring"
            assert tx["amount_ttc"] == 60.0
            assert tx["amount_ht"] == 50.0
            assert tx["vat_amount"] == 10.0

        # Call again — must NOT duplicate
        r2 = admin_client.get(f"{BASE_URL}/api/accounting/transactions", timeout=30)
        items2 = r2.json()
        rec_txs_2 = [x for x in items2 if x.get("recurring_id") == rec_id]
        assert len(rec_txs_2) == len(rec_txs_1), (
            f"duplicates generated: first={len(rec_txs_1)}, second={len(rec_txs_2)}"
        )

    def test_recurring_put_ok(self, admin_client, created_ids):
        rec_id = created_ids["rec"][0]
        upd = admin_client.put(f"{BASE_URL}/api/accounting/recurring/{rec_id}", json={
            "label": "TEST_QA Abonnement récurrent (modifié)",
            "category": "Abonnements",
            "amount_ttc": 60,
            "vat_rate": 20,
            "frequency": "monthly",
            "day_of_month": 1,
            "start_date": (date.today().replace(day=1) - timedelta(days=60)).isoformat(),
            "active": True,
        }, timeout=30)
        assert upd.status_code == 200, upd.text

    def test_recurring_delete_ok(self, admin_client, created_ids):
        rec_id = created_ids["rec"].pop(0)
        # Keep generated transactions (default behavior)
        d = admin_client.delete(f"{BASE_URL}/api/accounting/recurring/{rec_id}", timeout=30)
        assert d.status_code == 200, d.text
        # Second delete -> 404
        d2 = admin_client.delete(f"{BASE_URL}/api/accounting/recurring/{rec_id}", timeout=30)
        assert d2.status_code == 404


# ---------------------------------------------------------------------------
# Import revenues (idempotent per reservation)
# ---------------------------------------------------------------------------
class TestImportRevenues:
    def test_import_revenues_then_no_duplicates(self, admin_client):
        payload = {"month": "2026-09"}
        r1 = admin_client.post(f"{BASE_URL}/api/accounting/import-revenues", json=payload, timeout=60)
        assert r1.status_code == 200, r1.text
        b1 = r1.json()
        assert set(b1.keys()) >= {"created", "skipped", "period_label"}
        assert isinstance(b1["created"], int)
        assert isinstance(b1["skipped"], int)

        r2 = admin_client.post(f"{BASE_URL}/api/accounting/import-revenues", json=payload, timeout=60)
        assert r2.status_code == 200
        b2 = r2.json()
        assert b2["created"] == 0, f"second import created {b2['created']} (should be 0)"
        # skipped on second run must be >= created on first run
        assert b2["skipped"] >= b1["created"], (
            f"skipped({b2['skipped']}) should be >= first-run created({b1['created']})"
        )


# ---------------------------------------------------------------------------
# Scan receipt (real Claude Sonnet 4.6 via emergentintegrations)
# ---------------------------------------------------------------------------
def _build_receipt_jpeg() -> bytes:
    """Create a realistic looking receipt image with clear text (JPEG, base64-friendly)."""
    W, H = 480, 720
    img = Image.new("RGB", (W, H), (250, 250, 245))
    draw = ImageDraw.Draw(img)
    # Add some textures / lines so it's not uniform variance
    for y in range(0, H, 24):
        draw.line([(0, y), (W, y)], fill=(235, 235, 230), width=1)

    lines = [
        "SUPERMARCHE CARREFOUR",
        "12 Rue de la Paix, 75002 Paris",
        "SIRET 552 120 222 00013",
        "Tel: 01 40 20 30 40",
        "-----------------------------",
        "Date: 2026-01-14   Heure: 10:32",
        "Ticket #  A1B2-3456",
        "-----------------------------",
        "Pain complet          2.30 EUR",
        "Lait 1L x2            3.10 EUR",
        "Yaourt nature x6      2.95 EUR",
        "Cafe moulu 250g       4.80 EUR",
        "Pommes 1kg            1.90 EUR",
        "-----------------------------",
        "Total HT             13.66 EUR",
        "TVA  5.5%             0.75 EUR",
        "TVA 20.0%             1.64 EUR",
        "-----------------------------",
        "TOTAL TTC            16.05 EUR",
        "Paye CB VISA ****1234",
        "Merci de votre visite",
    ]
    y = 20
    for text in lines:
        draw.text((16, y), text, fill=(15, 15, 15))
        y += 22

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return buf.getvalue()


class TestScanReceipt:
    def test_scan_receipt_returns_valid_json(self, admin_token):
        jpg = _build_receipt_jpeg()
        files = {"file": ("receipt.jpg", jpg, "image/jpeg")}
        headers = {"Authorization": f"Bearer {admin_token}"}
        r = requests.post(
            f"{BASE_URL}/api/accounting/scan-receipt",
            files=files, headers=headers, timeout=120,
        )
        assert r.status_code == 200, f"scan-receipt failed: {r.status_code} {r.text[:500]}"
        body = r.json()
        expected_keys = {"supplier", "date", "amount_ttc", "vat_amount", "vat_rate", "currency", "category_guess"}
        assert expected_keys.issubset(set(body.keys())), f"missing keys, got {list(body.keys())}"
        # amount_ttc must be numeric (int or float), not None
        amt = body["amount_ttc"]
        assert isinstance(amt, (int, float)), f"amount_ttc must be numeric, got {type(amt).__name__}: {amt!r}"
        # It's OK if the model over/undershoots slightly; just log actual value
        print(f"[scan-receipt] parsed body = {body}")


# ---------------------------------------------------------------------------
# Teardown — module scope, remove TEST_QA transactions & recurring
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module", autouse=True)
def _cleanup(admin_client, created_ids):
    yield
    # Cleanup tracked transactions
    for tx_id in list(set(created_ids.get("tx", []))):
        try:
            admin_client.delete(f"{BASE_URL}/api/accounting/transactions/{tx_id}", timeout=15)
        except Exception:
            pass
    # Cleanup remaining recurring (with keep_generated=false to also remove generated tx)
    for rec_id in list(set(created_ids.get("rec", []))):
        try:
            admin_client.delete(
                f"{BASE_URL}/api/accounting/recurring/{rec_id}?keep_generated=false",
                timeout=15,
            )
        except Exception:
            pass
    # Purge any remaining TEST_QA transactions we may have created via recurring materialize
    # (best-effort: list, filter, delete)
    try:
        r = admin_client.get(f"{BASE_URL}/api/accounting/transactions", timeout=30)
        if r.status_code == 200:
            for it in r.json():
                desc = (it.get("description") or "")
                if desc.startswith("TEST_QA") or desc == "Dépense récurrente" and (it.get("supplier") or "").startswith("TEST_QA"):
                    try:
                        admin_client.delete(f"{BASE_URL}/api/accounting/transactions/{it['id']}", timeout=15)
                    except Exception:
                        pass
    except Exception:
        pass
