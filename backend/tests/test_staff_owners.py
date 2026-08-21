"""
Iteration 9 — Backend tests for:
- Staff CRUD (/api/staff)
- Owners CRUD (/api/owners) + owner<->property link + property_count
- GET /api/owners/{id}/summary (revenue_total, per_month, nights_total, reservations_count; cancelled excluded)
- PUT /api/properties/{id} preservation of owner_id and lodgify_id
- POST /api/inbox/{thread_uid}/reply — validation only (empty -> 400, unknown -> 404)
- Auth 401 on all new endpoints
"""
import uuid
import pytest


# -----------------------------------------------------------------
# 401 without Authorization header on all new endpoints
# -----------------------------------------------------------------
class TestAuth401:
    def test_staff_list_requires_auth(self, base_url, anon_client):
        r = anon_client.get(f"{base_url}/api/staff")
        assert r.status_code == 401

    def test_staff_create_requires_auth(self, base_url, anon_client):
        r = anon_client.post(f"{base_url}/api/staff", json={"name": "x"})
        assert r.status_code == 401

    def test_staff_update_requires_auth(self, base_url, anon_client):
        r = anon_client.put(f"{base_url}/api/staff/some-id", json={"name": "x"})
        assert r.status_code == 401

    def test_staff_delete_requires_auth(self, base_url, anon_client):
        r = anon_client.delete(f"{base_url}/api/staff/some-id")
        assert r.status_code == 401

    def test_owners_list_requires_auth(self, base_url, anon_client):
        r = anon_client.get(f"{base_url}/api/owners")
        assert r.status_code == 401

    def test_owners_create_requires_auth(self, base_url, anon_client):
        r = anon_client.post(f"{base_url}/api/owners", json={"name": "x"})
        assert r.status_code == 401

    def test_owners_update_requires_auth(self, base_url, anon_client):
        r = anon_client.put(f"{base_url}/api/owners/some-id", json={"name": "x"})
        assert r.status_code == 401

    def test_owners_delete_requires_auth(self, base_url, anon_client):
        r = anon_client.delete(f"{base_url}/api/owners/some-id")
        assert r.status_code == 401

    def test_owner_summary_requires_auth(self, base_url, anon_client):
        r = anon_client.get(f"{base_url}/api/owners/some-id/summary")
        assert r.status_code == 401

    def test_inbox_reply_requires_auth(self, base_url, anon_client):
        r = anon_client.post(f"{base_url}/api/inbox/some-uid/reply", json={"message": "hi"})
        assert r.status_code == 401


# -----------------------------------------------------------------
# Staff CRUD
# -----------------------------------------------------------------
class TestStaffCRUD:
    def test_create_staff(self, base_url, api_client):
        r = api_client.post(f"{base_url}/api/staff", json={"name": "TEST_Alice", "role": "menage", "phone": "0102"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == "TEST_Alice"
        assert data["role"] == "menage"
        assert "id" in data

    def test_create_staff_missing_name(self, base_url, api_client):
        r = api_client.post(f"{base_url}/api/staff", json={"role": "menage"})
        assert r.status_code == 422  # pydantic requires name

    def test_list_staff_sorted(self, base_url, api_client):
        # ensure two entries added
        api_client.post(f"{base_url}/api/staff", json={"name": "TEST_Zoe"})
        api_client.post(f"{base_url}/api/staff", json={"name": "TEST_Bob"})
        r = api_client.get(f"{base_url}/api/staff")
        assert r.status_code == 200
        items = r.json()
        names = [s["name"] for s in items]
        assert names == sorted(names), f"staff list not sorted: {names}"

    def test_update_staff(self, base_url, api_client):
        c = api_client.post(f"{base_url}/api/staff", json={"name": "TEST_UpdateMe"}).json()
        sid = c["id"]
        r = api_client.put(f"{base_url}/api/staff/{sid}", json={"name": "TEST_Updated", "role": "tech"})
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Updated"
        assert r.json()["role"] == "tech"

    def test_update_staff_not_found(self, base_url, api_client):
        r = api_client.put(f"{base_url}/api/staff/nonexistent-id-xyz", json={"name": "X"})
        assert r.status_code == 404

    def test_delete_staff(self, base_url, api_client):
        c = api_client.post(f"{base_url}/api/staff", json={"name": "TEST_DelMe"}).json()
        sid = c["id"]
        r = api_client.delete(f"{base_url}/api/staff/{sid}")
        assert r.status_code == 200
        # verify persistence: staff no longer in list
        items = api_client.get(f"{base_url}/api/staff").json()
        assert not any(s["id"] == sid for s in items)


# -----------------------------------------------------------------
# Owners CRUD + property_count + summary
# -----------------------------------------------------------------
@pytest.fixture
def clean_owners_and_props(base_url, api_client):
    """Ensure the test user has no owners or properties before each test in TestOwnersCRUD."""
    # delete all owners
    for o in api_client.get(f"{base_url}/api/owners").json():
        api_client.delete(f"{base_url}/api/owners/{o['id']}")
    for p in api_client.get(f"{base_url}/api/properties").json():
        api_client.delete(f"{base_url}/api/properties/{p['id']}")
    yield


class TestOwnersCRUD:
    def test_create_owner(self, base_url, api_client, clean_owners_and_props):
        r = api_client.post(f"{base_url}/api/owners", json={
            "name": "TEST_Owner1", "email": "o1@test.local", "phone": "0100", "notes": "hi",
        })
        assert r.status_code == 200
        d = r.json()
        assert d["name"] == "TEST_Owner1"
        assert d["email"] == "o1@test.local"
        assert "id" in d

    def test_list_owners_has_property_count(self, base_url, api_client, clean_owners_and_props):
        o1 = api_client.post(f"{base_url}/api/owners", json={"name": "TEST_A_Owner"}).json()
        o2 = api_client.post(f"{base_url}/api/owners", json={"name": "TEST_B_Owner"}).json()
        # Create 2 props for o1, 0 for o2
        api_client.post(f"{base_url}/api/properties", json={"name": "TEST_P1", "owner_id": o1["id"]})
        api_client.post(f"{base_url}/api/properties", json={"name": "TEST_P2", "owner_id": o1["id"]})
        api_client.post(f"{base_url}/api/properties", json={"name": "TEST_P3"})

        items = api_client.get(f"{base_url}/api/owners").json()
        by_id = {o["id"]: o for o in items}
        assert by_id[o1["id"]]["property_count"] == 2
        assert by_id[o2["id"]]["property_count"] == 0
        # ensure sort by name
        names = [o["name"] for o in items]
        assert names == sorted(names)

    def test_update_owner(self, base_url, api_client, clean_owners_and_props):
        o = api_client.post(f"{base_url}/api/owners", json={"name": "TEST_Owner"}).json()
        r = api_client.put(f"{base_url}/api/owners/{o['id']}", json={"name": "TEST_Owner_v2", "email": "n@t.io"})
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Owner_v2"
        assert r.json()["email"] == "n@t.io"

    def test_update_owner_not_found(self, base_url, api_client):
        r = api_client.put(f"{base_url}/api/owners/does-not-exist", json={"name": "x"})
        assert r.status_code == 404

    def test_delete_owner_unlinks_properties(self, base_url, api_client, clean_owners_and_props):
        o = api_client.post(f"{base_url}/api/owners", json={"name": "TEST_OwnerDel"}).json()
        p = api_client.post(f"{base_url}/api/properties", json={
            "name": "TEST_Linked", "owner_id": o["id"],
        }).json()
        assert p["owner_id"] == o["id"]
        # delete owner
        d = api_client.delete(f"{base_url}/api/owners/{o['id']}")
        assert d.status_code == 200
        # verify property still exists but owner_id is None
        got = api_client.get(f"{base_url}/api/properties/{p['id']}").json()
        assert got["owner_id"] is None, f"expected owner_id None, got {got.get('owner_id')}"


# -----------------------------------------------------------------
# Owner summary
# -----------------------------------------------------------------
class TestOwnerSummary:
    def test_summary_not_found(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/owners/no-such-owner/summary")
        assert r.status_code == 404

    def test_summary_computation(self, base_url, api_client, clean_owners_and_props):
        owner = api_client.post(f"{base_url}/api/owners", json={"name": "TEST_SumOwner"}).json()
        prop = api_client.post(f"{base_url}/api/properties", json={
            "name": "TEST_SumProp", "owner_id": owner["id"],
        }).json()
        # Reservations: 2 confirmed + 1 cancelled (must be excluded)
        api_client.post(f"{base_url}/api/reservations", json={
            "property_id": prop["id"], "guest_name": "TEST_G1",
            "check_in": "2025-06-01", "check_out": "2025-06-05",
            "total_price": 400, "status": "confirmee",
        })
        api_client.post(f"{base_url}/api/reservations", json={
            "property_id": prop["id"], "guest_name": "TEST_G2",
            "check_in": "2025-07-10", "check_out": "2025-07-13",
            "total_price": 300, "status": "confirmee",
        })
        api_client.post(f"{base_url}/api/reservations", json={
            "property_id": prop["id"], "guest_name": "TEST_G3",
            "check_in": "2025-07-20", "check_out": "2025-07-22",
            "total_price": 999, "status": "annulee",
        })

        r = api_client.get(f"{base_url}/api/owners/{owner['id']}/summary")
        assert r.status_code == 200, r.text
        data = r.json()
        # owner block
        assert data["owner"]["id"] == owner["id"]
        # properties list
        assert len(data["properties"]) == 1
        assert data["properties"][0]["id"] == prop["id"]
        # revenue: 400 + 300 = 700 (cancelled excluded)
        assert data["revenue_total"] == 700, f"revenue_total: {data['revenue_total']}"
        # nights: (5-1)+(13-10) = 4+3 = 7
        assert data["nights_total"] == 7, f"nights_total: {data['nights_total']}"
        # reservations_count excludes cancelled
        assert data["reservations_count"] == 2
        # per_month: [{2025-06:400},{2025-07:300}]
        by_month = {m["month"]: m["revenue"] for m in data["per_month"]}
        assert by_month.get("2025-06") == 400
        assert by_month.get("2025-07") == 300

    def test_summary_no_properties(self, base_url, api_client, clean_owners_and_props):
        owner = api_client.post(f"{base_url}/api/owners", json={"name": "TEST_Empty"}).json()
        r = api_client.get(f"{base_url}/api/owners/{owner['id']}/summary")
        assert r.status_code == 200
        d = r.json()
        assert d["properties"] == []
        assert d["revenue_total"] == 0
        assert d["reservations_count"] == 0
        assert d["nights_total"] == 0
        assert d["per_month"] == []


# -----------------------------------------------------------------
# Property preservation: owner_id and lodgify_id
# -----------------------------------------------------------------
class TestPropertyOwnerAndLodgifyPreservation:
    def test_put_without_owner_id_preserves(self, base_url, api_client, clean_owners_and_props):
        owner = api_client.post(f"{base_url}/api/owners", json={"name": "TEST_OwnerKeep"}).json()
        prop = api_client.post(f"{base_url}/api/properties", json={
            "name": "TEST_Prop", "owner_id": owner["id"], "lodgify_id": "LODG-123",
        }).json()
        assert prop["owner_id"] == owner["id"]
        assert prop["lodgify_id"] == "LODG-123"

        # PUT WITHOUT owner_id and lodgify_id (both omitted -> None in Pydantic)
        upd = api_client.put(f"{base_url}/api/properties/{prop['id']}", json={
            "name": "TEST_Prop_Renamed", "location": "Paris",
        })
        assert upd.status_code == 200, upd.text
        got = upd.json()
        assert got["name"] == "TEST_Prop_Renamed"
        assert got["owner_id"] == owner["id"], f"owner_id lost: {got.get('owner_id')}"
        assert got["lodgify_id"] == "LODG-123", f"lodgify_id lost: {got.get('lodgify_id')}"

        # Follow-up GET must also confirm
        g = api_client.get(f"{base_url}/api/properties/{prop['id']}").json()
        assert g["owner_id"] == owner["id"]
        assert g["lodgify_id"] == "LODG-123"

    def test_put_with_empty_owner_id_clears_link(self, base_url, api_client, clean_owners_and_props):
        owner = api_client.post(f"{base_url}/api/owners", json={"name": "TEST_OwnerClear"}).json()
        prop = api_client.post(f"{base_url}/api/properties", json={
            "name": "TEST_ClearProp", "owner_id": owner["id"],
        }).json()
        assert prop["owner_id"] == owner["id"]

        upd = api_client.put(f"{base_url}/api/properties/{prop['id']}", json={
            "name": "TEST_ClearProp", "owner_id": "",
        })
        assert upd.status_code == 200
        got = upd.json()
        # explicit empty string should clear the link
        assert got.get("owner_id") in ("", None), (
            f"expected owner_id cleared (empty/None), got {got.get('owner_id')!r}"
        )


# -----------------------------------------------------------------
# Inbox reply — validation only (no real send)
# -----------------------------------------------------------------
class TestInboxReplyValidation:
    def test_empty_message_returns_400(self, base_url, api_client):
        r = api_client.post(
            f"{base_url}/api/inbox/{uuid.uuid4()}/reply",
            json={"message": ""},
        )
        assert r.status_code == 400
        assert "Message vide" in r.json().get("detail", "")

    def test_whitespace_message_returns_400(self, base_url, api_client):
        r = api_client.post(
            f"{base_url}/api/inbox/{uuid.uuid4()}/reply",
            json={"message": "   \n\t  "},
        )
        assert r.status_code == 400
        assert "Message vide" in r.json().get("detail", "")

    def test_unknown_thread_returns_404_or_400(self, base_url, api_client, clean_owners_and_props):
        """
        With a real non-empty message but an unknown thread_uid, backend order is:
        1) validate message -> ok
        2) load channel adapter -> if no channel_settings for this fresh test user, returns 400
           'Channel manager non connecté'
        3) query reservation by (user, thread_uid) -> 404 'Réservation liée introuvable'
        Test user has no channel_settings, so we expect 400 here. We validate both cases.
        """
        r = api_client.post(
            f"{base_url}/api/inbox/{uuid.uuid4()}/reply",
            json={"message": "hello (validation only)"},
        )
        # Either 400 (no channel connected) or 404 (unknown thread) is acceptable
        # per validation semantics — the point is we never reach Lodgify send.
        assert r.status_code in (400, 404), r.text
        detail = r.json().get("detail", "")
        assert (
            "Channel manager" in detail
            or "introuvable" in detail
            or "thread" in detail.lower()
        ), f"unexpected detail: {detail}"
