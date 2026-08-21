# Backend tests for Lodgify channel manager + Inbox integration
# Covers /api/channel/* endpoints and /api/inbox/* endpoints.
# Uses a fresh isolated test_user from conftest (does NOT touch real production data).

import os
import uuid
import pytest
import requests

LODGIFY_API_KEY = "I6T0EMSnL+oqohaXmF3/SPjgQkisvNWD+nvretEaGWtRvOuedVYZ8vhE0XMd/7Np"


# -----------------------------------------------------------------------------
# 401 checks — all channel/* and inbox/* endpoints require Bearer token
# -----------------------------------------------------------------------------
class TestAuthRequired:
    def test_channel_connect_401(self, anon_client, base_url):
        r = anon_client.post(f"{base_url}/api/channel/connect", json={"api_key": "x"})
        assert r.status_code == 401

    def test_channel_status_401(self, anon_client, base_url):
        r = anon_client.get(f"{base_url}/api/channel/status")
        assert r.status_code == 401

    def test_channel_import_401(self, anon_client, base_url):
        r = anon_client.post(f"{base_url}/api/channel/import-properties")
        assert r.status_code == 401

    def test_channel_remote_properties_401(self, anon_client, base_url):
        r = anon_client.get(f"{base_url}/api/channel/remote-properties")
        assert r.status_code == 401

    def test_channel_sync_401(self, anon_client, base_url):
        r = anon_client.post(f"{base_url}/api/channel/sync")
        assert r.status_code == 401

    def test_inbox_list_401(self, anon_client, base_url):
        r = anon_client.get(f"{base_url}/api/inbox")
        assert r.status_code == 401

    def test_inbox_thread_401(self, anon_client, base_url):
        r = anon_client.get(f"{base_url}/api/inbox/some-uid")
        assert r.status_code == 401


# -----------------------------------------------------------------------------
# Connect / status / import / sync / inbox — sequential flow on isolated user
# -----------------------------------------------------------------------------
@pytest.mark.order(2)
class TestLodgifyFlow:
    """
    Ordered end-to-end flow on the isolated test_user fixture:
      1) connect invalid → 400
      2) connect valid → properties_count >= 1
      3) status → connected=true
      4) sync BEFORE import → 400 (no linked property)
      5) import-properties → imported > 0
      6) import-properties again → imported == 0 (idempotent)
      7) remote-properties → all imported=True
      8) sync #1 → imported > 0, conversations > 0
      9) sync #2 → imported == 0, updates > 0
     10) inbox list → non-empty, has property_name / source / arrival / departure
     11) inbox/{thread_uid} → messages + guest_name; 'mine' flag on Owner
     12) update_property PUT without lodgify_id → mapping preserved
    """

    # shared state across ordered tests within one test_user session
    state = {}

    def test_01_connect_invalid_key(self, api_client, base_url):
        r = api_client.post(f"{base_url}/api/channel/connect",
                            json={"api_key": "definitely-invalid-key-xxxxxxx"}, timeout=30)
        assert r.status_code == 400, f"Expected 400 for invalid key, got {r.status_code}: {r.text}"

    def test_02_connect_valid(self, api_client, base_url):
        r = api_client.post(f"{base_url}/api/channel/connect",
                            json={"api_key": LODGIFY_API_KEY}, timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        assert data.get("provider") == "lodgify"
        assert isinstance(data.get("properties_count"), int)
        assert data["properties_count"] >= 1, f"Expected >=1 properties, got {data}"
        TestLodgifyFlow.state["properties_count"] = data["properties_count"]

    def test_03_status_connected(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/channel/status", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["connected"] is True
        assert data["provider"] == "lodgify"
        assert data["properties_count"] == TestLodgifyFlow.state["properties_count"]
        assert data["mapped_count"] == 0, f"Expected 0 mapped before import, got {data}"

    def test_04_sync_without_linked_property_400(self, api_client, base_url):
        r = api_client.post(f"{base_url}/api/channel/sync", timeout=30)
        assert r.status_code == 400, f"Expected 400 sans logement lié, got {r.status_code}: {r.text}"
        detail = (r.json() or {}).get("detail", "")
        assert "logement" in detail.lower() or "lodgify" in detail.lower(), detail

    def test_05_import_properties(self, api_client, base_url):
        r = api_client.post(f"{base_url}/api/channel/import-properties", timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["total"] >= 1
        assert data["imported"] == data["total"], f"First import should import ALL: {data}"
        TestLodgifyFlow.state["imported_first"] = data["imported"]
        TestLodgifyFlow.state["total"] = data["total"]

    def test_06_import_properties_idempotent(self, api_client, base_url):
        r = api_client.post(f"{base_url}/api/channel/import-properties", timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["imported"] == 0, f"Second import should be idempotent (0), got {data}"
        assert data["total"] == TestLodgifyFlow.state["total"]

    def test_07_status_mapped_count(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/channel/status", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["mapped_count"] == TestLodgifyFlow.state["total"], \
            f"mapped_count should equal total imported: {data}"

    def test_08_remote_properties_all_imported(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/channel/remote-properties", timeout=60)
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list)
        assert len(items) == TestLodgifyFlow.state["total"]
        for it in items:
            assert "id" in it and "name" in it and "imported" in it
            assert it["imported"] is True, f"After import, all should be flagged imported: {it}"

    def test_09_sync_first(self, api_client, base_url):
        # Lodgify sync can pull ~380 bookings — allow up to 120s
        r = api_client.post(f"{base_url}/api/channel/sync", timeout=180)
        assert r.status_code == 200, r.text
        data = r.json()
        for key in ("imported", "updated", "unmapped", "conversations", "total"):
            assert key in data, f"Missing key {key} in sync response: {data}"
        assert data["total"] >= 1
        assert data["imported"] >= 1, f"First sync should import at least 1 booking: {data}"
        # unmapped is possible if Lodgify has bookings on properties not returned by /properties
        assert data["unmapped"] >= 0
        TestLodgifyFlow.state["sync_first"] = data

    def test_10_sync_second_updates_only(self, api_client, base_url):
        r = api_client.post(f"{base_url}/api/channel/sync", timeout=180)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["imported"] == 0, f"Second sync should import 0 (dedup by lodgify_id): {data}"
        assert data["updated"] == TestLodgifyFlow.state["sync_first"]["imported"] + \
               TestLodgifyFlow.state["sync_first"]["updated"], \
               f"Second sync updates should equal previous imported+updated: {data} vs prev {TestLodgifyFlow.state['sync_first']}"

    def test_11_inbox_list(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/inbox", timeout=30)
        assert r.status_code == 200, r.text
        convs = r.json()
        assert isinstance(convs, list)
        if TestLodgifyFlow.state["sync_first"]["conversations"] > 0:
            assert len(convs) >= 1, "conversations>0 in sync but inbox is empty"
            c = convs[0]
            for key in ("guest_name", "property_name", "source", "arrival", "departure", "thread_uid"):
                assert key in c, f"Inbox item missing {key}: {c}"
            TestLodgifyFlow.state["thread_uid"] = c["thread_uid"]
        else:
            pytest.skip("No conversations returned by sync (Lodgify data has no thread_uid)")

    def test_12_inbox_thread_messages(self, api_client, base_url):
        thread_uid = TestLodgifyFlow.state.get("thread_uid")
        if not thread_uid:
            pytest.skip("No thread_uid available from inbox")
        r = api_client.get(f"{base_url}/api/inbox/{thread_uid}", timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["thread_uid"] == thread_uid
        assert "guest_name" in data
        assert "property_name" in data
        assert "source" in data
        assert "messages" in data and isinstance(data["messages"], list)
        # A thread can be empty; if not, each message must be normalized
        for m in data["messages"]:
            assert "id" in m and "text" in m and "date" in m and "mine" in m
            assert isinstance(m["mine"], bool)
            # HTML must be stripped
            assert "<" not in m["text"] or ">" not in m["text"], f"HTML not stripped: {m}"

    def test_13_update_property_preserves_lodgify_id(self, api_client, base_url):
        # Fetch one imported property
        r = api_client.get(f"{base_url}/api/properties", timeout=30)
        assert r.status_code == 200
        props = [p for p in r.json() if p.get("lodgify_id")]
        assert props, "No properties with lodgify_id after import"
        p = props[0]
        original_lid = p["lodgify_id"]

        # PUT without lodgify_id in body — mapping must be preserved
        put_body = {
            "name": p["name"] + " (edited)",
            "location": p.get("location") or "",
            "image_url": p.get("image_url") or "",
            "base_price": p.get("base_price") or 0,
            "capacity": p.get("capacity") or 2,
            "bedrooms": p.get("bedrooms") or 1,
            "owner": p.get("owner") or "",
            "surface": p.get("surface") or 0,
            "address": p.get("address") or "",
            "postal_code": p.get("postal_code") or "",
            "city": p.get("city") or "",
            "address_complement": p.get("address_complement") or "",
            "description": p.get("description") or "",
            "rooms": p.get("rooms") or [],
            "amenities": p.get("amenities") or [],
            "seasons": p.get("seasons") or [],
            "ical_links": p.get("ical_links") or [],
            # lodgify_id intentionally omitted
        }
        r2 = api_client.put(f"{base_url}/api/properties/{p['id']}", json=put_body, timeout=30)
        assert r2.status_code == 200, r2.text
        updated = r2.json()
        assert updated["lodgify_id"] == original_lid, \
            f"PUT wiped lodgify_id! before={original_lid} after={updated.get('lodgify_id')}"

        # GET back to double-check persistence
        r3 = api_client.get(f"{base_url}/api/properties/{p['id']}", timeout=30)
        assert r3.status_code == 200
        assert r3.json()["lodgify_id"] == original_lid


# -----------------------------------------------------------------------------
# Cleanup — remove test_user's channel_settings + conversations after suite
# (properties/reservations already cleaned by conftest.teardown)
# -----------------------------------------------------------------------------
@pytest.fixture(scope="module", autouse=True)
def _lodgify_cleanup(test_user):
    yield
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    uid = test_user["user_id"]

    async def cleanup():
        await db.channel_settings.delete_many({"user_id": uid})
        await db.conversations.delete_many({"user_id": uid})
        await db.interventions.delete_many({"user_id": uid})
        client.close()

    loop = asyncio.new_event_loop()
    loop.run_until_complete(cleanup())
    loop.close()
