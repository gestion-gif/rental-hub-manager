"""Tests iteration 21 — 5 new features (Casanéo):
1) KPI (/api/analytics/kpi)
2) Reservation checklist (PATCH /api/reservations/{id}/checklist + PUT preserve)
3) Reviews CRUD (/api/reviews)
4) Promotions CRUD (/api/promotions)
5) Preferences online_checkin + monthly_report / review_request flags
"""
import os
import pytest
import requests
from datetime import date, timedelta

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://rental-hub-manager.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

EMAIL = "qa.admin@casaneo.test"
PASSWORD = "CasaneoQA2026!"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


@pytest.fixture(scope="session")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def a_property(headers):
    r = requests.get(f"{API}/properties", headers=headers, timeout=30)
    assert r.status_code == 200
    props = r.json()
    assert len(props) > 0, "no property available for QA account"
    return props[0]


# ---------------- 1) KPI ----------------
class TestKPI:
    def test_kpi_by_month(self, headers):
        r = requests.get(f"{API}/analytics/kpi", headers=headers, params={"month": "2026-07"}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "totals" in data and "occupancy_all" in data
        assert "per_property" in data and "top_by_revenue" in data and "top_by_occupancy" in data
        assert "period_label" in data
        for k in ("concierge_revenue", "owner_revenue", "management_fee", "cleaning",
                  "commission", "reservations", "booked_nights", "nights"):
            assert k in data["totals"], f"missing totals.{k}"

    def test_kpi_by_range(self, headers):
        r = requests.get(f"{API}/analytics/kpi", headers=headers,
                         params={"start": "2026-06-01", "end": "2026-08-31"}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "totals" in data
        assert isinstance(data["per_property"], list)
        assert "period_label" in data

    def test_kpi_qa_has_view_revenue(self, headers):
        # QA admin has view_revenue_charts (200 not 403)
        r = requests.get(f"{API}/analytics/kpi", headers=headers, params={"month": "2026-07"}, timeout=30)
        assert r.status_code == 200


# ---------------- 2) Checklist ----------------
class TestChecklist:
    @pytest.fixture(scope="class")
    def reservation_id(self, headers, a_property):
        ci = (date.today() + timedelta(days=60)).isoformat()
        co = (date.today() + timedelta(days=63)).isoformat()
        payload = {
            "property_id": a_property["id"],
            "guest_first_name": "TEST",
            "guest_last_name": "Checklist",
            "guest_name": "TEST Checklist",
            "check_in": ci, "check_out": co,
            "guests": 2, "nights_total": 300, "cleaning_fee": 50,
            "tourist_tax": 5, "total_price": 355, "status": "confirmee",
        }
        r = requests.post(f"{API}/reservations", headers=headers, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        yield rid
        requests.delete(f"{API}/reservations/{rid}", headers=headers, timeout=30)

    def test_patch_checklist_returns_4_keys(self, headers, reservation_id):
        r = requests.patch(f"{API}/reservations/{reservation_id}/checklist", headers=headers,
                           json={"checklist": {"caution": True, "keys": True}}, timeout=30)
        assert r.status_code == 200, r.text
        c = r.json()["checklist"]
        assert set(c.keys()) == {"caution", "keys", "welcome_book", "cleaning"}
        assert c["caution"] is True and c["keys"] is True
        assert c["welcome_book"] is False and c["cleaning"] is False

    def test_patch_checklist_merges(self, headers, reservation_id):
        r = requests.patch(f"{API}/reservations/{reservation_id}/checklist", headers=headers,
                           json={"checklist": {"welcome_book": True}}, timeout=30)
        assert r.status_code == 200, r.text
        c = r.json()["checklist"]
        assert c["caution"] is True, "caution should be preserved after partial patch"
        assert c["keys"] is True, "keys should be preserved"
        assert c["welcome_book"] is True

    def test_checklist_preserved_after_put(self, headers, reservation_id, a_property):
        # PUT reservation with a payload that lacks 'checklist' → must not wipe it
        put_payload = {
            "property_id": a_property["id"],
            "guest_first_name": "TEST",
            "guest_last_name": "Checklist",
            "guest_name": "TEST Checklist",
            "check_in": (date.today() + timedelta(days=60)).isoformat(),
            "check_out": (date.today() + timedelta(days=63)).isoformat(),
            "guests": 2, "nights_total": 320, "cleaning_fee": 50,
            "tourist_tax": 5, "total_price": 375, "status": "confirmee",
            "notes": "updated",
        }
        r = requests.put(f"{API}/reservations/{reservation_id}", headers=headers, json=put_payload, timeout=30)
        assert r.status_code == 200, r.text
        # Verify via GET
        r2 = requests.get(f"{API}/reservations", headers=headers,
                          params={"property_id": a_property["id"]}, timeout=30)
        assert r2.status_code == 200
        found = [x for x in r2.json() if x["id"] == reservation_id]
        assert found, "reservation missing after PUT"
        c = (found[0].get("checklist") or {})
        assert c.get("caution") is True and c.get("keys") is True and c.get("welcome_book") is True, \
            f"checklist wiped by PUT: {c}"

    def test_checklist_404(self, headers):
        r = requests.patch(f"{API}/reservations/unknown-id-xyz/checklist", headers=headers,
                           json={"checklist": {"caution": True}}, timeout=30)
        assert r.status_code == 404


# ---------------- 3) Reviews ----------------
class TestReviews:
    def test_reviews_full_flow(self, headers, a_property):
        # baseline summary
        r = requests.get(f"{API}/reviews/summary", headers=headers, timeout=30)
        assert r.status_code == 200
        base = r.json()
        assert "per_property" in base and "total_reviews" in base and "avg_all" in base
        base_total = base["total_reviews"]

        # create rating 5
        r = requests.post(f"{API}/reviews", headers=headers, json={
            "property_id": a_property["id"], "rating": 5,
            "guest_name": "TEST_reviewer_A", "comment": "excellent",
        }, timeout=30)
        assert r.status_code == 200, r.text
        rid_a = r.json()["id"]
        assert r.json()["rating"] == 5

        # rating clamp above 5
        r = requests.post(f"{API}/reviews", headers=headers, json={
            "property_id": a_property["id"], "rating": 9,
            "guest_name": "TEST_reviewer_B", "comment": "clamp above",
        }, timeout=30)
        assert r.status_code == 200
        rid_b = r.json()["id"]
        assert r.json()["rating"] == 5, "rating > 5 should clamp to 5"

        # rating clamp below 1 (using -1; 0 falls back to default because of `or 5` in server code)
        r = requests.post(f"{API}/reviews", headers=headers, json={
            "property_id": a_property["id"], "rating": -1,
            "guest_name": "TEST_reviewer_C", "comment": "clamp below",
        }, timeout=30)
        assert r.status_code == 200
        rid_c = r.json()["id"]
        assert r.json()["rating"] == 1

        # summary updates
        r = requests.get(f"{API}/reviews/summary", headers=headers, timeout=30)
        assert r.status_code == 200
        after = r.json()
        assert after["total_reviews"] == base_total + 3

        # list filter
        r = requests.get(f"{API}/reviews", headers=headers,
                         params={"property_id": a_property["id"]}, timeout=30)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert rid_a in ids and rid_b in ids and rid_c in ids

        # PUT
        r = requests.put(f"{API}/reviews/{rid_a}", headers=headers, json={
            "property_id": a_property["id"], "rating": 4,
            "guest_name": "TEST_reviewer_A", "comment": "updated",
        }, timeout=30)
        assert r.status_code == 200
        assert r.json()["rating"] == 4

        # DELETE all created
        for rid in (rid_a, rid_b, rid_c):
            r = requests.delete(f"{API}/reviews/{rid}", headers=headers, timeout=30)
            assert r.status_code == 200

        # summary back
        r = requests.get(f"{API}/reviews/summary", headers=headers, timeout=30)
        assert r.json()["total_reviews"] == base_total


# ---------------- 4) Promotions ----------------
class TestPromotions:
    def test_promotions_crud_and_bounds(self, headers, a_property):
        # percentage: amount clamped to 100
        payload = {
            "name": "TEST_promo_pct", "description": "d", "photo_path": "",
            "require_code": True, "code": "PROMO50",
            "calc_type": "percentage", "amount": 150,
            "period_enabled": True,
            "start_date": "2026-06-01", "end_date": "2026-09-01",
            "property_ids": [a_property["id"]],
        }
        r = requests.post(f"{API}/promotions", headers=headers, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        assert r.json()["amount"] == 100.0, f"percentage amount should clamp to 100, got {r.json()['amount']}"

        # fixed: amount not clamped
        r2 = requests.post(f"{API}/promotions", headers=headers, json={
            **payload, "name": "TEST_promo_fixed", "calc_type": "fixed", "amount": 250,
        }, timeout=30)
        assert r2.status_code == 200
        pid2 = r2.json()["id"]
        assert r2.json()["amount"] == 250.0, f"fixed amount should not clamp, got {r2.json()['amount']}"

        # none
        r3 = requests.post(f"{API}/promotions", headers=headers, json={
            **payload, "name": "TEST_promo_none", "calc_type": "none", "amount": 999,
        }, timeout=30)
        assert r3.status_code == 200
        pid3 = r3.json()["id"]
        assert r3.json()["calc_type"] == "none"

        # LIST
        rl = requests.get(f"{API}/promotions", headers=headers, timeout=30)
        assert rl.status_code == 200
        ids = [x["id"] for x in rl.json()]
        for x in (pid, pid2, pid3):
            assert x in ids

        # PUT
        rp = requests.put(f"{API}/promotions/{pid}", headers=headers, json={
            **payload, "name": "TEST_promo_pct_updated", "amount": 30,
        }, timeout=30)
        assert rp.status_code == 200
        assert rp.json()["amount"] == 30.0 and rp.json()["name"] == "TEST_promo_pct_updated"

        # DELETE cleanup
        for x in (pid, pid2, pid3):
            rd = requests.delete(f"{API}/promotions/{x}", headers=headers, timeout=30)
            assert rd.status_code == 200

    def test_promotion_put_404(self, headers, a_property):
        r = requests.put(f"{API}/promotions/unknown-xyz", headers=headers, json={
            "name": "x", "calc_type": "fixed", "amount": 10,
            "property_ids": [a_property["id"]],
        }, timeout=30)
        assert r.status_code == 404


# ---------------- 5) Preferences (online_checkin, reports, review request) ----------------
class TestPreferences:
    def test_online_checkin_and_reports(self, headers):
        # GET baseline
        r = requests.get(f"{API}/preferences", headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        base = r.json()
        assert "online_checkin" in base
        oc = base["online_checkin"]
        for k in ("enabled", "require_before_arrival", "auto_reminders", "predefined", "custom_questions"):
            assert k in oc
        assert oc["predefined"]["guests_count"] is True  # forced

        base_monthly = base.get("monthly_report_enabled")
        base_rev_en = base.get("review_request_enabled")
        base_rev_days = base.get("review_request_days")

        # PUT online_checkin with empty question filtered + arrival_time false
        r = requests.put(f"{API}/preferences", headers=headers, json={
            "online_checkin": {
                "enabled": True,
                "predefined": {"arrival_time": False, "guests_count": False},  # guests_count must stay true
                "custom_questions": [{"label": "Q1"}, {"label": ""}, {"label": "Q2"}],
            }
        }, timeout=30)
        assert r.status_code == 200, r.text
        oc2 = r.json()["online_checkin"]
        assert oc2["predefined"]["guests_count"] is True, "guests_count must always be True"
        assert oc2["predefined"]["arrival_time"] is False
        labels = [q["label"] for q in oc2["custom_questions"]]
        assert "" not in labels, "empty question should be filtered"
        assert "Q1" in labels and "Q2" in labels
        # ids generated
        for q in oc2["custom_questions"]:
            assert q.get("id"), "custom_question must have id"

        # PUT reports/reviews
        r = requests.put(f"{API}/preferences", headers=headers, json={
            "monthly_report_enabled": False,
            "review_request_enabled": True,
            "review_request_days": 2,
        }, timeout=30)
        assert r.status_code == 200
        assert r.json()["monthly_report_enabled"] is False
        assert r.json()["review_request_enabled"] is True
        assert r.json()["review_request_days"] == 2

        # persistence via GET
        r = requests.get(f"{API}/preferences", headers=headers, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["monthly_report_enabled"] is False
        assert j["review_request_enabled"] is True
        assert j["review_request_days"] == 2

        # Restore
        requests.put(f"{API}/preferences", headers=headers, json={
            "monthly_report_enabled": base_monthly if base_monthly is not None else True,
            "review_request_enabled": base_rev_en if base_rev_en is not None else False,
            "review_request_days": base_rev_days if base_rev_days is not None else 1,
            "online_checkin": {"enabled": False, "custom_questions": []},
        }, timeout=30)

    def test_review_days_clamp(self, headers):
        # request 999 → clamped to 30
        r = requests.put(f"{API}/preferences", headers=headers, json={"review_request_days": 999}, timeout=30)
        assert r.status_code == 200
        assert r.json()["review_request_days"] == 30
        # negative → clamped to 0
        r = requests.put(f"{API}/preferences", headers=headers, json={"review_request_days": -5}, timeout=30)
        assert r.status_code == 200
        assert r.json()["review_request_days"] == 0
        # restore
        requests.put(f"{API}/preferences", headers=headers, json={"review_request_days": 1}, timeout=30)
