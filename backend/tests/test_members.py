"""Tests for the Members module (team management with roles & permissions).

Endpoints under test:
  - POST   /api/members
  - GET    /api/members
  - GET    /api/members/{id}
  - PUT    /api/members/{id}
  - DELETE /api/members/{id}

Also verifies multi-user isolation: a member created by user A must NOT
appear in user B's list, nor be retrievable/updatable/deletable by user B.
"""
import os
import uuid
import asyncio
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

# --- Base URL resolution (mirror conftest) ---
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    fe_env = Path(__file__).parent.parent.parent / "frontend" / ".env"
    for line in fe_env.read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


# ---------------------------------------------------------------------------
# Fixtures: two independent test users (A and B) to test isolation
# ---------------------------------------------------------------------------
def _make_user(loop, label: str):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    user_id = f"user_TEST_{label}_{uuid.uuid4().hex[:8]}"
    email = f"TEST_{label}_{uuid.uuid4().hex[:6]}@staypilot.test"
    session_token = f"tst_{uuid.uuid4().hex}"

    async def setup():
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": f"Test User {label}",
            "picture": "",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await db.user_sessions.insert_one({
            "session_token": session_token,
            "user_id": user_id,
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        })

    async def teardown():
        await db.members.delete_many({"user_id": user_id})
        await db.user_sessions.delete_many({"user_id": user_id})
        await db.users.delete_one({"user_id": user_id})
        client.close()

    loop.run_until_complete(setup())
    return {
        "user_id": user_id,
        "email": email,
        "session_token": session_token,
        "_teardown": lambda: loop.run_until_complete(teardown()),
    }


@pytest.fixture(scope="module")
def loop_mod():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="module")
def user_a(loop_mod):
    u = _make_user(loop_mod, "A")
    yield u
    u["_teardown"]()


@pytest.fixture(scope="module")
def user_b(loop_mod):
    u = _make_user(loop_mod, "B")
    yield u
    u["_teardown"]()


def _client(session_token: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {session_token}",
    })
    return s


@pytest.fixture(scope="module")
def client_a(user_a):
    return _client(user_a["session_token"])


@pytest.fixture(scope="module")
def client_b(user_b):
    return _client(user_b["session_token"])


# ---------------------------------------------------------------------------
# Tests: CRUD
# ---------------------------------------------------------------------------
class TestMembersCRUD:
    def test_create_member_returns_all_fields(self, client_a):
        payload = {
            "first_name": "TEST_Alice",
            "last_name": "TEST_Martin",
            "email": "TEST_alice@example.com",
            "phone": "+33600000001",
            "language": "fr",
            "role": "manager",
            "permissions": ["reservations.read", "properties.write"],
            "active": True,
        }
        r = client_a.post(f"{BASE_URL}/api/members", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "id" in data and isinstance(data["id"], str) and len(data["id"]) > 0
        for k, v in payload.items():
            assert data[k] == v, f"field {k}: expected {v!r} got {data[k]!r}"
        # user_id must be set server-side, _id (Mongo) must be excluded
        assert data.get("user_id")
        assert "_id" not in data

    def test_create_defaults(self, client_a):
        r = client_a.post(f"{BASE_URL}/api/members", json={})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["first_name"] == ""
        assert d["language"] == "fr"
        assert d["role"] == "member"
        assert d["permissions"] == []
        assert d["active"] is True

    def test_list_sorted_by_first_name(self, client_a):
        # create out of order
        for name in ["TEST_Zoe", "TEST_Bob", "TEST_Anna"]:
            r = client_a.post(f"{BASE_URL}/api/members", json={"first_name": name})
            assert r.status_code == 200
        r = client_a.get(f"{BASE_URL}/api/members")
        assert r.status_code == 200
        members = r.json()
        assert isinstance(members, list) and len(members) >= 3
        # only look at ones we just created
        firsts = [m["first_name"] for m in members if m["first_name"].startswith("TEST_")]
        assert firsts == sorted(firsts), f"list not sorted asc: {firsts}"

    def test_get_member_by_id(self, client_a):
        r = client_a.post(f"{BASE_URL}/api/members", json={"first_name": "TEST_Get"})
        mid = r.json()["id"]
        g = client_a.get(f"{BASE_URL}/api/members/{mid}")
        assert g.status_code == 200
        assert g.json()["id"] == mid
        assert g.json()["first_name"] == "TEST_Get"

    def test_get_unknown_returns_404(self, client_a):
        r = client_a.get(f"{BASE_URL}/api/members/{uuid.uuid4()}")
        assert r.status_code == 404

    def test_update_member_changes_role(self, client_a):
        r = client_a.post(f"{BASE_URL}/api/members", json={"first_name": "TEST_Upd", "role": "member"})
        mid = r.json()["id"]
        upd = {
            "first_name": "TEST_Upd",
            "last_name": "",
            "email": "",
            "phone": "",
            "language": "en",
            "role": "admin",
            "permissions": ["all"],
            "active": False,
        }
        p = client_a.put(f"{BASE_URL}/api/members/{mid}", json=upd)
        assert p.status_code == 200, p.text
        body = p.json()
        assert body["role"] == "admin"
        assert body["language"] == "en"
        assert body["permissions"] == ["all"]
        assert body["active"] is False
        # verify persistence via GET
        g = client_a.get(f"{BASE_URL}/api/members/{mid}")
        assert g.status_code == 200
        assert g.json()["role"] == "admin"

    def test_update_unknown_returns_404(self, client_a):
        r = client_a.put(
            f"{BASE_URL}/api/members/{uuid.uuid4()}",
            json={"first_name": "x"},
        )
        assert r.status_code == 404

    def test_delete_member_then_absent(self, client_a):
        r = client_a.post(f"{BASE_URL}/api/members", json={"first_name": "TEST_Del"})
        mid = r.json()["id"]
        d = client_a.delete(f"{BASE_URL}/api/members/{mid}")
        assert d.status_code == 200
        assert d.json() == {"ok": True}
        g = client_a.get(f"{BASE_URL}/api/members/{mid}")
        assert g.status_code == 404
        lst = client_a.get(f"{BASE_URL}/api/members").json()
        assert all(m["id"] != mid for m in lst)

    def test_delete_unknown_is_idempotent(self, client_a):
        # DELETE on unknown id returns {ok: true} (no 404 on delete per current impl)
        r = client_a.delete(f"{BASE_URL}/api/members/{uuid.uuid4()}")
        assert r.status_code == 200
        assert r.json() == {"ok": True}


# ---------------------------------------------------------------------------
# Tests: Multi-user isolation
# ---------------------------------------------------------------------------
class TestMembersIsolation:
    def test_member_created_by_A_not_visible_to_B(self, client_a, client_b):
        r = client_a.post(f"{BASE_URL}/api/members", json={"first_name": "TEST_IsoA"})
        assert r.status_code == 200
        mid = r.json()["id"]

        lst_b = client_b.get(f"{BASE_URL}/api/members")
        assert lst_b.status_code == 200
        assert all(m["id"] != mid for m in lst_b.json())

    def test_B_cannot_GET_A_member(self, client_a, client_b):
        r = client_a.post(f"{BASE_URL}/api/members", json={"first_name": "TEST_IsoA2"})
        mid = r.json()["id"]
        g = client_b.get(f"{BASE_URL}/api/members/{mid}")
        assert g.status_code == 404

    def test_B_cannot_PUT_A_member(self, client_a, client_b):
        r = client_a.post(f"{BASE_URL}/api/members", json={"first_name": "TEST_IsoA3"})
        mid = r.json()["id"]
        p = client_b.put(f"{BASE_URL}/api/members/{mid}", json={"first_name": "hacked"})
        assert p.status_code == 404
        # ensure A still sees original
        g = client_a.get(f"{BASE_URL}/api/members/{mid}")
        assert g.status_code == 200
        assert g.json()["first_name"] == "TEST_IsoA3"

    def test_B_delete_does_not_affect_A_member(self, client_a, client_b):
        r = client_a.post(f"{BASE_URL}/api/members", json={"first_name": "TEST_IsoA4"})
        mid = r.json()["id"]
        d = client_b.delete(f"{BASE_URL}/api/members/{mid}")
        # DELETE is idempotent -> returns ok, but the resource must still exist for A
        assert d.status_code == 200
        g = client_a.get(f"{BASE_URL}/api/members/{mid}")
        assert g.status_code == 200, "A's member was wrongly deleted by B (isolation broken)"


# ---------------------------------------------------------------------------
# Tests: Auth guard
# ---------------------------------------------------------------------------
class TestMembersAuth:
    def test_unauthenticated_list_rejected(self):
        s = requests.Session()
        r = s.get(f"{BASE_URL}/api/members")
        assert r.status_code in (401, 403)

    def test_unauthenticated_create_rejected(self):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/members", json={"first_name": "x"})
        assert r.status_code in (401, 403)
