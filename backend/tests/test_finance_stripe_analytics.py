"""Iteration 11 backend tests — Finance init on manual reservations, commission,
preferences (commission_rates without wiping statuses), Stripe checkout (payment/deposit),
checkout status, and analytics revenue.

NO calls are made to /api/channel/sync or /api/inbox/{tid}/reply — respected per instructions.
Stripe: we only validate that a session is created (url + session_id) and status endpoint
returns without error; we DO NOT complete an actual card payment (not automatable).
"""
import os
import pytest


BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    from pathlib import Path
    fe = Path(__file__).parent.parent.parent / "frontend" / ".env"
    for line in fe.read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break


@pytest.fixture
def sample_property(api_client):
    r = api_client.post(f"{BASE_URL}/api/properties", json={
        "name": "TEST_iter11_Property", "location": "Nice",
        "base_price": 100, "capacity": 4, "bedrooms": 2,
    })
    assert r.status_code == 200, r.text
    p = r.json()
    yield p
    api_client.delete(f"{BASE_URL}/api/properties/{p['id']}")


def _make_reservation(api_client, prop_id, total=500, check_in="2026-07-01",
                      check_out="2026-07-06", platform="Direct", status="confirmee"):
    r = api_client.post(f"{BASE_URL}/api/reservations", json={
        "property_id": prop_id,
        "guest_name": "TEST_Voyageur",
        "guest_email": "test@example.com",
        "platform": platform,
        "check_in": check_in,
        "check_out": check_out,
        "guests": 2,
        "total_price": total,
        "status": status,
    })
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# 1) Finance initialization on manual reservation creation
# ---------------------------------------------------------------------------
class TestFinanceInit:
    def test_manual_reservation_finance_shape(self, api_client, sample_property):
        r = _make_reservation(api_client, sample_property["id"], total=500)
        try:
            assert "finance" in r, "finance dict missing"
            fin = r["finance"]
            assert fin["total"] == 500
            assert fin["paid"] == 0.0
            assert fin["due"] == 500
            assert fin["currency"] == "EUR"
            assert r.get("payments") == []
        finally:
            api_client.delete(f"{BASE_URL}/api/reservations/{r['id']}")

    def test_manual_reservation_zero_total(self, api_client, sample_property):
        r = _make_reservation(api_client, sample_property["id"], total=0)
        try:
            fin = r["finance"]
            assert fin["total"] == 0
            assert fin["paid"] == 0.0
            assert fin["due"] == 0
        finally:
            api_client.delete(f"{BASE_URL}/api/reservations/{r['id']}")


# ---------------------------------------------------------------------------
# 2) PUT reservation updates finance.total and finance.due (manual)
# ---------------------------------------------------------------------------
class TestFinanceUpdateOnPUT:
    def test_put_updates_finance_total_and_due(self, api_client, sample_property):
        r = _make_reservation(api_client, sample_property["id"], total=500)
        rid = r["id"]
        try:
            # change total_price to 800
            put = api_client.put(f"{BASE_URL}/api/reservations/{rid}", json={
                "property_id": sample_property["id"],
                "guest_name": "TEST_Voyageur",
                "platform": "Direct",
                "check_in": "2026-07-01",
                "check_out": "2026-07-06",
                "guests": 2,
                "total_price": 800,
                "status": "confirmee",
            })
            assert put.status_code == 200, put.text
            updated = put.json()
            fin = updated["finance"]
            assert fin["total"] == 800.0, f"expected 800, got {fin['total']}"
            assert fin["due"] == 800.0
            assert fin["paid"] == 0.0

            # GET to verify persistence
            got = api_client.get(f"{BASE_URL}/api/reservations?property_id={sample_property['id']}")
            match = next((x for x in got.json() if x["id"] == rid), None)
            assert match is not None
            assert match["finance"]["total"] == 800.0
            assert match["finance"]["due"] == 800.0
        finally:
            api_client.delete(f"{BASE_URL}/api/reservations/{rid}")


# ---------------------------------------------------------------------------
# 3) PATCH commission
# ---------------------------------------------------------------------------
class TestCommission:
    def test_set_commission_positive(self, api_client, sample_property):
        r = _make_reservation(api_client, sample_property["id"])
        rid = r["id"]
        try:
            patch = api_client.patch(f"{BASE_URL}/api/reservations/{rid}/commission",
                                     json={"amount": 50})
            assert patch.status_code == 200, patch.text
            item = patch.json()
            assert item["finance"]["commission"] == 50.0
        finally:
            api_client.delete(f"{BASE_URL}/api/reservations/{rid}")

    def test_set_commission_negative_rejected(self, api_client, sample_property):
        r = _make_reservation(api_client, sample_property["id"])
        rid = r["id"]
        try:
            patch = api_client.patch(f"{BASE_URL}/api/reservations/{rid}/commission",
                                     json={"amount": -10})
            assert patch.status_code == 400
        finally:
            api_client.delete(f"{BASE_URL}/api/reservations/{rid}")

    def test_set_commission_reservation_not_found(self, api_client):
        r = api_client.patch(f"{BASE_URL}/api/reservations/does-not-exist/commission",
                             json={"amount": 10})
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# 4) GET /api/preferences default commission_rates
# ---------------------------------------------------------------------------
class TestPreferences:
    def test_get_preferences_defaults(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/preferences")
        assert r.status_code == 200
        data = r.json()
        assert "commission_rates" in data
        rates = data["commission_rates"]
        assert rates.get("Airbnb") == 15.5
        assert rates.get("Booking.com") == 15.0
        assert rates.get("Vrbo") == 8.0
        assert rates.get("Direct") == 0.0
        assert "statuses" in data
        assert isinstance(data["statuses"], list)

    def test_put_commission_rates_only_preserves_custom_statuses(self, api_client):
        # 1) set custom statuses first
        custom_statuses = [
            {"key": "demande", "label": "Demande", "color": "#FF9500"},
            {"key": "confirmee", "label": "Confirmée", "color": "#34C759"},
            {"key": "arrivee", "label": "Arrivée", "color": "#32ADE6"},
            {"key": "depart", "label": "Départ", "color": "#8E8E93"},
            {"key": "annulee", "label": "Annulée", "color": "#FF3B30"},
            {"key": "vip_test", "label": "VIP TEST", "color": "#123456"},
        ]
        r1 = api_client.put(f"{BASE_URL}/api/preferences",
                            json={"statuses": custom_statuses})
        assert r1.status_code == 200
        got_keys = {s["key"] for s in r1.json()["statuses"]}
        assert "vip_test" in got_keys, "custom status not saved"

        # 2) PUT commission_rates only — must NOT wipe statuses
        r2 = api_client.put(f"{BASE_URL}/api/preferences",
                            json={"commission_rates": {"Airbnb": 12.5}})
        assert r2.status_code == 200
        data = r2.json()
        # rate persisted
        assert data["commission_rates"]["Airbnb"] == 12.5
        # defaults still present
        assert data["commission_rates"].get("Booking.com") == 15.0
        # custom status STILL PRESENT
        keys = {s["key"] for s in data["statuses"]}
        assert "vip_test" in keys, (
            f"custom status 'vip_test' was wiped after PUT commission_rates. "
            f"got keys: {keys}"
        )

        # 3) verify GET too
        r3 = api_client.get(f"{BASE_URL}/api/preferences")
        keys2 = {s["key"] for s in r3.json()["statuses"]}
        assert "vip_test" in keys2

    def test_put_commission_rates_clamping(self, api_client):
        r = api_client.put(f"{BASE_URL}/api/preferences",
                           json={"commission_rates": {"Airbnb": 250, "Booking.com": -5}})
        assert r.status_code == 200
        rates = r.json()["commission_rates"]
        assert rates["Airbnb"] == 100.0  # clamped
        assert rates["Booking.com"] == 0.0  # clamped


# ---------------------------------------------------------------------------
# 5) Stripe checkout — session creation only (real payment not automatable)
# ---------------------------------------------------------------------------
class TestStripeCheckout:
    def test_checkout_payment_without_amount_uses_due(self, api_client, sample_property):
        r = _make_reservation(api_client, sample_property["id"], total=400)
        rid = r["id"]
        try:
            resp = api_client.post(f"{BASE_URL}/api/reservations/{rid}/checkout",
                                   json={"kind": "payment",
                                         "origin_url": "https://example.com"})
            assert resp.status_code == 200, resp.text
            body = resp.json()
            assert "url" in body and body["url"].startswith("http")
            assert "session_id" in body
            sid = body["session_id"]
            assert sid, "empty session_id"
            # Stripe test session ids start with 'cs_test_'
            assert sid.startswith("cs_"), f"unexpected session_id prefix: {sid}"

            # status endpoint returns without error
            st = api_client.get(f"{BASE_URL}/api/checkout/status/{sid}")
            assert st.status_code == 200, st.text
            sdata = st.json()
            assert sdata["kind"] == "payment"
            assert sdata["amount"] == 400.0
            assert "status" in sdata
            assert "payment_status" in sdata
            # payment not completed (no card entered) → expect 'unpaid' or open state
            assert sdata["payment_status"] in ("unpaid", "no_payment_required", "paid", "open", "")
        finally:
            api_client.delete(f"{BASE_URL}/api/reservations/{rid}")

    def test_checkout_deposit_with_amount(self, api_client, sample_property):
        r = _make_reservation(api_client, sample_property["id"], total=500)
        rid = r["id"]
        try:
            resp = api_client.post(f"{BASE_URL}/api/reservations/{rid}/checkout",
                                   json={"kind": "deposit", "amount": 300,
                                         "origin_url": "https://example.com"})
            assert resp.status_code == 200, resp.text
            body = resp.json()
            assert "url" in body
            assert "session_id" in body
            sid = body["session_id"]

            st = api_client.get(f"{BASE_URL}/api/checkout/status/{sid}")
            assert st.status_code == 200, st.text
            sdata = st.json()
            assert sdata["kind"] == "deposit"
            assert sdata["amount"] == 300.0
        finally:
            api_client.delete(f"{BASE_URL}/api/reservations/{rid}")

    def test_checkout_deposit_amount_zero_rejected(self, api_client, sample_property):
        r = _make_reservation(api_client, sample_property["id"], total=500)
        rid = r["id"]
        try:
            resp = api_client.post(f"{BASE_URL}/api/reservations/{rid}/checkout",
                                   json={"kind": "deposit", "amount": 0,
                                         "origin_url": "https://example.com"})
            assert resp.status_code == 400, f"expected 400, got {resp.status_code}: {resp.text}"
        finally:
            api_client.delete(f"{BASE_URL}/api/reservations/{rid}")

    def test_checkout_reservation_not_found(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/reservations/does-not-exist/checkout",
                            json={"kind": "payment", "origin_url": "https://example.com"})
        assert r.status_code == 404

    def test_checkout_status_unknown_session(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/checkout/status/cs_unknown_xyz_iter11")
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# 6) Analytics revenue — monthly split
# ---------------------------------------------------------------------------
class TestAnalytics:
    def test_analytics_revenue_year_2026_shape_and_split(self, api_client, sample_property):
        # July: 5 nights 500€ → 100€/night, all 5 nights in July (2026-07-01 → 2026-07-06)
        r1 = _make_reservation(api_client, sample_property["id"],
                               total=500, check_in="2026-07-01",
                               check_out="2026-07-06", status="confirmee")
        # August: 5 nights 600€ → 120€/night, all 5 nights in August (2026-08-10 → 2026-08-15)
        r2 = _make_reservation(api_client, sample_property["id"],
                               total=600, check_in="2026-08-10",
                               check_out="2026-08-15", status="confirmee")
        try:
            resp = api_client.get(f"{BASE_URL}/api/analytics/revenue?year=2026")
            assert resp.status_code == 200, resp.text
            data = resp.json()
            # structural checks
            assert data["year"] == 2026
            assert "properties" in data and isinstance(data["properties"], list)
            assert len(data["properties"]) >= 1
            prop_entry = next((p for p in data["properties"] if p["id"] == sample_property["id"]), None)
            assert prop_entry is not None, "property not in analytics"
            monthly = prop_entry["monthly"]
            assert len(monthly) == 12
            # month 7 (July) revenue ~ 500
            july = next(m for m in monthly if m["month"] == 7)
            aug = next(m for m in monthly if m["month"] == 8)
            assert july["revenue"] == 500, f"July revenue={july['revenue']} expected 500"
            assert july["nights"] == 5
            assert aug["revenue"] == 600, f"Aug revenue={aug['revenue']} expected 600"
            assert aug["nights"] == 5

            assert prop_entry["total_revenue"] == 1100
            assert isinstance(prop_entry["avg_occupancy"], int)

            # totals block
            totals = data["totals"]
            assert "monthly" in totals and len(totals["monthly"]) == 12
            assert totals["total_revenue"] == 1100
            assert "avg_occupancy" in totals
        finally:
            api_client.delete(f"{BASE_URL}/api/reservations/{r1['id']}")
            api_client.delete(f"{BASE_URL}/api/reservations/{r2['id']}")

    def test_analytics_revenue_defaults_current_year(self, api_client, sample_property):
        r = api_client.get(f"{BASE_URL}/api/analytics/revenue")
        assert r.status_code == 200
        data = r.json()
        assert "year" in data
        assert isinstance(data["year"], int)


# ---------------------------------------------------------------------------
# 7) Auth requirement (401) on new endpoints
# ---------------------------------------------------------------------------
class TestAuth401:
    @pytest.mark.parametrize("method,path,body", [
        ("PATCH", "/api/reservations/x/commission", {"amount": 10}),
        ("POST", "/api/reservations/x/checkout", {"kind": "payment", "origin_url": "https://example.com"}),
        ("GET", "/api/checkout/status/cs_test_x", None),
        ("GET", "/api/analytics/revenue", None),
    ])
    def test_endpoints_require_auth(self, anon_client, method, path, body):
        r = anon_client.request(method, f"{BASE_URL}{path}", json=body)
        assert r.status_code == 401, f"{method} {path}: got {r.status_code}"
