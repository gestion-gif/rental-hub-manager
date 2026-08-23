"""Iteration 22 backend tests (Casanéo):
1) GET /api/properties/{id}/dynamic-pricing — response shape, weekend factor,
   invalid dates → 400, unknown id → 404, config persistence via PUT.
2) Property.photos preservation via PUT /api/properties/{id}.
3) Fix rating=0 → clamped to 1 (POST /api/reviews).
"""
import os
import pytest
import requests
from datetime import date, timedelta
from pathlib import Path


def _read_backend_url() -> str:
    fe_env = Path(__file__).parent.parent.parent / "frontend" / ".env"
    for line in fe_env.read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not found in frontend/.env")


BASE_URL = _read_backend_url()
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


# ---------- 1) Dynamic pricing ----------
class TestDynamicPricing:
    def test_dynamic_pricing_shape_and_weekend(self, headers, a_property):
        # Use 15 days containing at least one Fri/Sat pair
        r = requests.get(
            f"{API}/properties/{a_property['id']}/dynamic-pricing",
            headers=headers,
            params={"start": "2026-08-01", "end": "2026-08-15"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()

        for k in ("days", "occupancy_rate", "comps_count", "market_city", "config"):
            assert k in data, f"missing key {k}"
        assert isinstance(data["days"], list) and len(data["days"]) == 14
        assert isinstance(data["occupancy_rate"], int)
        assert isinstance(data["comps_count"], int)

        # every day has required numeric fields and factors list
        weekend_seen = False
        for d in data["days"]:
            for k in ("date", "base", "market", "suggested", "factors", "delta"):
                assert k in d, f"missing day key {k}: {d}"
            assert isinstance(d["suggested"], (int, float))
            assert d["suggested"] >= 0
            assert isinstance(d["factors"], list)
            # verify week-end factor is applied on Fridays/Saturdays (weekday 4,5)
            dt = date.fromisoformat(d["date"])
            if dt.weekday() in (4, 5):
                assert "week-end" in d["factors"], f"week-end factor missing on {d['date']}"
                weekend_seen = True
        assert weekend_seen, "expected at least one Fri/Sat in Aug 1-15 2026"

    def test_dynamic_pricing_invalid_dates_400(self, headers, a_property):
        r = requests.get(
            f"{API}/properties/{a_property['id']}/dynamic-pricing",
            headers=headers,
            params={"start": "not-a-date", "end": "still-not"},
            timeout=30,
        )
        assert r.status_code == 400, f"expected 400 for invalid dates, got {r.status_code} {r.text}"

    def test_dynamic_pricing_unknown_id_404(self, headers):
        r = requests.get(
            f"{API}/properties/unknown-xyz-999/dynamic-pricing",
            headers=headers,
            params={"start": "2026-08-01", "end": "2026-08-10"},
            timeout=30,
        )
        assert r.status_code == 404

    def test_dynamic_pricing_config_persistence(self, headers, a_property):
        pid = a_property["id"]
        # capture the full existing property so we can safely restore
        r = requests.get(f"{API}/properties/{pid}", headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        prop = r.json()
        original_dp = prop.get("dynamic_pricing")
        original_photos = prop.get("photos") or []

        # Base payload with all safe/required fields
        def base_payload(extra: dict) -> dict:
            p = {
                "name": prop["name"],  # required
                "location": prop.get("location") or "",
                "city": prop.get("city") or "",
                "capacity": prop.get("capacity") or 0,
                "bedrooms": prop.get("bedrooms") or 0,
                "base_price": prop.get("base_price") or 0,
                "photos": original_photos,
            }
            p.update(extra)
            return p

        try:
            # PUT with dynamic_pricing config
            r = requests.put(
                f"{API}/properties/{pid}", headers=headers,
                json=base_payload({"dynamic_pricing": {"enabled": True, "weekend_pct": 20}}),
                timeout=30,
            )
            assert r.status_code == 200, r.text

            # GET dynamic-pricing reflects weekend_pct = 20 in config
            r = requests.get(
                f"{API}/properties/{pid}/dynamic-pricing", headers=headers,
                params={"start": "2026-08-01", "end": "2026-08-10"}, timeout=30,
            )
            assert r.status_code == 200
            cfg = r.json()["config"]
            assert cfg.get("weekend_pct") == 20, f"weekend_pct should be 20, got {cfg.get('weekend_pct')}"
            assert cfg.get("enabled") is True

            # PUT WITHOUT dynamic_pricing → must NOT wipe existing config
            r = requests.put(
                f"{API}/properties/{pid}", headers=headers,
                json=base_payload({}),  # no dynamic_pricing key
                timeout=30,
            )
            assert r.status_code == 200, r.text

            # Fetch property directly and verify dynamic_pricing is preserved
            r = requests.get(f"{API}/properties/{pid}", headers=headers, timeout=30)
            assert r.status_code == 200
            dp_after = r.json().get("dynamic_pricing") or {}
            assert dp_after.get("weekend_pct") == 20, (
                f"dynamic_pricing wiped by PUT without dynamic_pricing key: {dp_after}"
            )
            assert dp_after.get("enabled") is True

            # And verify /dynamic-pricing still returns weekend_pct=20
            r = requests.get(
                f"{API}/properties/{pid}/dynamic-pricing", headers=headers,
                params={"start": "2026-08-01", "end": "2026-08-05"}, timeout=30,
            )
            assert r.status_code == 200
            assert r.json()["config"].get("weekend_pct") == 20

        finally:
            # Restore original dynamic_pricing (None → do not set key ⇒ leave whatever last set)
            # We explicitly restore the value that was there before the test.
            restore_payload = base_payload({})
            if original_dp is not None:
                restore_payload["dynamic_pricing"] = original_dp
            else:
                # If there was no dp before, wipe by using an empty dict
                restore_payload["dynamic_pricing"] = {}
            requests.put(f"{API}/properties/{pid}", headers=headers, json=restore_payload, timeout=30)


# ---------- 2) Property photos preservation ----------
class TestPropertyPhotos:
    def test_photos_preserved_and_cleared(self, headers, a_property):
        pid = a_property["id"]
        r = requests.get(f"{API}/properties/{pid}", headers=headers, timeout=30)
        assert r.status_code == 200
        prop = r.json()
        original_photos = prop.get("photos") or []
        original_dp = prop.get("dynamic_pricing")

        def base_payload(extra: dict) -> dict:
            p = {
                "name": prop["name"],  # required
                "location": prop.get("location") or "",
                "city": prop.get("city") or "",
                "capacity": prop.get("capacity") or 0,
                "bedrooms": prop.get("bedrooms") or 0,
                "base_price": prop.get("base_price") or 0,
            }
            p.update(extra)
            return p

        try:
            # Set photos = ['a.jpg', 'b.jpg']
            r = requests.put(
                f"{API}/properties/{pid}", headers=headers,
                json=base_payload({"photos": ["a.jpg", "b.jpg"]}),
                timeout=30,
            )
            assert r.status_code == 200, r.text

            r = requests.get(f"{API}/properties/{pid}", headers=headers, timeout=30)
            assert r.status_code == 200
            photos = r.json().get("photos")
            assert photos == ["a.jpg", "b.jpg"], f"photos not saved: {photos}"

            # Clear photos = []
            r = requests.put(
                f"{API}/properties/{pid}", headers=headers,
                json=base_payload({"photos": []}),
                timeout=30,
            )
            assert r.status_code == 200

            r = requests.get(f"{API}/properties/{pid}", headers=headers, timeout=30)
            assert r.json().get("photos") == [], f"photos not cleared: {r.json().get('photos')}"
        finally:
            # Restore original photos
            payload = base_payload({"photos": original_photos})
            if original_dp is not None:
                payload["dynamic_pricing"] = original_dp
            requests.put(f"{API}/properties/{pid}", headers=headers, json=payload, timeout=30)


# ---------- 3) Fix rating=0 clamped to 1 ----------
class TestReviewRatingClamp:
    def test_rating_zero_clamps_to_one(self, headers, a_property):
        r = requests.post(
            f"{API}/reviews", headers=headers,
            json={
                "property_id": a_property["id"], "rating": 0,
                "guest_name": "TEST_iter22_zero", "comment": "clamp 0",
            }, timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["rating"] == 1, f"rating=0 should clamp to 1, got {r.json()['rating']}"
        rid = r.json()["id"]
        # cleanup
        requests.delete(f"{API}/reviews/{rid}", headers=headers, timeout=30)

    def test_rating_seven_clamps_to_five(self, headers, a_property):
        r = requests.post(
            f"{API}/reviews", headers=headers,
            json={
                "property_id": a_property["id"], "rating": 7,
                "guest_name": "TEST_iter22_seven", "comment": "clamp 7",
            }, timeout=30,
        )
        assert r.status_code == 200
        assert r.json()["rating"] == 5, f"rating=7 should clamp to 5, got {r.json()['rating']}"
        rid = r.json()["id"]
        requests.delete(f"{API}/reviews/{rid}", headers=headers, timeout=30)
