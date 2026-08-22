"""Iteration 13 — Member invitation, accept-invite, email/password login,
and property-scoped filtering for member sessions.

All tests live in a SINGLE class so pytest-xdist --dist loadscope pins them
to the same worker (sequential shared state across tests is required for the
accept-invite -> login -> scoped-listing flow).

Coverage:
  * Owner sees all properties (no scope restriction)
  * POST /api/members with property_ids:[P1] creates a member with that scope
  * Accept-invite: 422 (short pw), 400 (bad token), 200 (returns session_token)
  * POST /api/auth/login: 401 (bad pw), 200 (returns session_token)
  * Member session scopes GET /api/properties, /api/reservations,
    /api/interventions, /api/dashboard to member.property_ids only
  * POST /api/members/{id}/invite {origin_url} with delivered@resend.dev
    returns {ok:true} (real send through Emergent Resend proxy)
"""
import os
import uuid
import asyncio
import hashlib
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    fe_env = Path(__file__).parent.parent.parent / "frontend" / ".env"
    for line in fe_env.read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

OWNER_TAG = f"iter13_{uuid.uuid4().hex[:6]}"


@pytest.fixture(scope="class")
def ctx():
    """Seed owner + 2 properties + reservations + interventions on P1 & P2.
    Yields a shared mutable dict; used sequentially by TestMemberFlow tests."""
    loop = asyncio.new_event_loop()
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    user_id = f"user_{OWNER_TAG}"
    email = f"TEST_owner_{OWNER_TAG}@staypilot.test"
    session_token = f"tst_{uuid.uuid4().hex}"

    p1_id = f"prop_{OWNER_TAG}_1"
    p2_id = f"prop_{OWNER_TAG}_2"

    async def setup():
        await db.users.insert_one({
            "user_id": user_id, "email": email, "name": "TEST Owner iter13",
            "picture": "", "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await db.user_sessions.insert_one({
            "session_token": session_token, "user_id": user_id,
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        })
        for pid, name in [(p1_id, "TEST_P1"), (p2_id, "TEST_P2")]:
            await db.properties.insert_one({
                "id": pid, "user_id": user_id, "name": name,
                "location": "Test", "base_price": 100, "capacity": 2, "bedrooms": 1,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        future_ci = (datetime.now(timezone.utc) + timedelta(days=10)).date().isoformat()
        future_co = (datetime.now(timezone.utc) + timedelta(days=13)).date().isoformat()
        for pid in [p1_id, p2_id]:
            await db.reservations.insert_one({
                "id": f"res_{OWNER_TAG}_{pid}", "user_id": user_id, "property_id": pid,
                "guest_name": "TEST_Guest", "guest_email": "", "platform": "Direct",
                "check_in": future_ci, "check_out": future_co, "guests": 2,
                "total_price": 300, "status": "confirmee", "notes": "",
                "finance": {"total": 300, "paid": 0, "due": 300, "currency": "EUR"},
                "payments": [],
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            await db.interventions.insert_one({
                "id": f"iv_{OWNER_TAG}_{pid}", "user_id": user_id, "property_id": pid,
                "kind": "intervention", "date": future_co,
                "description": "TEST", "intervenant": "", "done": False,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

    async def teardown():
        await db.members.delete_many({"user_id": user_id})
        await db.user_sessions.delete_many({"user_id": user_id})
        await db.reservations.delete_many({"user_id": user_id})
        await db.interventions.delete_many({"user_id": user_id})
        await db.properties.delete_many({"user_id": user_id})
        await db.users.delete_one({"user_id": user_id})

    loop.run_until_complete(setup())

    def owner_client():
        s = requests.Session()
        s.headers.update({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {session_token}",
        })
        return s

    state = {
        "user_id": user_id, "session_token": session_token,
        "p1_id": p1_id, "p2_id": p2_id,
        "db": db, "loop": loop, "owner_client": owner_client,
    }
    yield state
    loop.run_until_complete(teardown())
    client.close()
    loop.close()


def _bearer(token: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    })
    return s


class TestMemberFlow:
    """Single class = single xdist worker = sequential shared state."""

    def test_01_owner_sees_all_properties(self, ctx):
        r = ctx["owner_client"]().get(f"{BASE_URL}/api/properties")
        assert r.status_code == 200
        ids = {p["id"] for p in r.json()}
        assert ctx["p1_id"] in ids and ctx["p2_id"] in ids

    def test_02_create_member_with_property_ids(self, ctx):
        r = ctx["owner_client"]().post(
            f"{BASE_URL}/api/members",
            json={
                "first_name": "TEST_Mem", "last_name": "Iter13",
                "email": "delivered@resend.dev", "role": "member",
                "property_ids": [ctx["p1_id"]], "active": True,
            },
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["property_ids"] == [ctx["p1_id"]]
        assert data["email"] == "delivered@resend.dev"
        ctx["member_id"] = data["id"]

    def _seed_invite(self, ctx, raw_token: str):
        db = ctx["db"]

        async def do():
            await db.members.update_one(
                {"id": ctx["member_id"]},
                {"$set": {
                    "invite_token_hash": hashlib.sha256(raw_token.encode("utf-8")).hexdigest(),
                    "invite_expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
                    "invite_status": "pending",
                }, "$unset": {"password_hash": ""}},
            )
        ctx["loop"].run_until_complete(do())

    def test_03_accept_invite_short_password_returns_422(self, ctx):
        raw = uuid.uuid4().hex + uuid.uuid4().hex
        self._seed_invite(ctx, raw)
        r = requests.post(
            f"{BASE_URL}/api/auth/accept-invite",
            json={"token": raw, "password": "short"},
        )
        assert r.status_code == 422, r.text

    def test_04_accept_invite_unknown_token_returns_400(self, ctx):
        r = requests.post(
            f"{BASE_URL}/api/auth/accept-invite",
            json={"token": "totally-unknown-token-" + uuid.uuid4().hex,
                  "password": "ValidPwd12345"},
        )
        assert r.status_code == 400, r.text

    def test_05_accept_invite_valid_returns_session(self, ctx):
        raw = uuid.uuid4().hex + uuid.uuid4().hex
        self._seed_invite(ctx, raw)
        r = requests.post(
            f"{BASE_URL}/api/auth/accept-invite",
            json={"token": raw, "password": "MemberPwd12345"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "session_token" in data and data["session_token"]
        assert data["user"]["role"] == "member"
        assert data["user"]["email"] == "delivered@resend.dev"
        ctx["member_session"] = data["session_token"]

    def test_06_login_wrong_password_returns_401(self, ctx):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "delivered@resend.dev", "password": "WrongPwd12345"},
        )
        assert r.status_code == 401, r.text

    def test_07_login_correct_returns_session(self, ctx):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "delivered@resend.dev", "password": "MemberPwd12345"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "session_token" in data and data["session_token"]
        assert data["user"]["role"] == "member"

    def test_08_login_email_case_insensitive(self, ctx):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "Delivered@Resend.DEV", "password": "MemberPwd12345"},
        )
        assert r.status_code == 200, r.text

    def test_09_member_properties_scoped_to_P1(self, ctx):
        c = _bearer(ctx["member_session"])
        r = c.get(f"{BASE_URL}/api/properties")
        assert r.status_code == 200, r.text
        ids = {p["id"] for p in r.json()}
        assert ids == {ctx["p1_id"]}, f"member saw props {ids}"

    def test_10_member_reservations_scoped_to_P1(self, ctx):
        c = _bearer(ctx["member_session"])
        r = c.get(f"{BASE_URL}/api/reservations")
        assert r.status_code == 200
        pids = {res["property_id"] for res in r.json()}
        assert ctx["p2_id"] not in pids
        assert pids == {ctx["p1_id"]}

    def test_11_member_interventions_scoped_to_P1(self, ctx):
        c = _bearer(ctx["member_session"])
        r = c.get(f"{BASE_URL}/api/interventions")
        assert r.status_code == 200
        pids = {iv["property_id"] for iv in r.json()}
        assert ctx["p2_id"] not in pids
        assert ctx["p1_id"] in pids

    def test_12_member_dashboard_scoped_to_P1(self, ctx):
        c = _bearer(ctx["member_session"])
        r = c.get(f"{BASE_URL}/api/dashboard")
        assert r.status_code == 200
        data = r.json()
        assert data["total_properties"] == 1
        for coll in ("current_stays", "arrivals_today", "departures_today", "interventions"):
            for item in data.get(coll, []):
                assert item.get("property_id") == ctx["p1_id"], \
                    f"{coll} leaked property {item.get('property_id')}"

    def test_13_invite_sends_email_ok(self, ctx):
        r = ctx["owner_client"]().post(
            f"{BASE_URL}/api/members/{ctx['member_id']}/invite",
            json={"origin_url": BASE_URL},
        )
        assert r.status_code == 200, f"invite failed: {r.status_code} {r.text}"
        data = r.json()
        assert data.get("ok") is True
        assert data.get("email", "").lower() == "delivered@resend.dev"
