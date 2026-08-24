# Tests for /api/ai/help-ask (new) + non-regression on /api/ai/guest-reply and /api/ai/pricing-suggestion
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or ""
if not BASE_URL:
    from pathlib import Path
    fe = Path(__file__).parent.parent.parent / "frontend" / ".env"
    for line in fe.read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"')
            break
BASE_URL = BASE_URL.rstrip("/")


# ----- /api/ai/help-ask -----
class TestHelpAsk:
    def test_help_ask_requires_auth(self, anon_client):
        r = anon_client.post(f"{BASE_URL}/api/ai/help-ask", json={"question": "Comment envoyer un relevé ?"})
        assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"

    def test_help_ask_empty_question_returns_400(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/ai/help-ask", json={"question": "   "})
        assert r.status_code == 400
        assert "vide" in r.json().get("detail", "").lower()

    def test_help_ask_returns_french_answer(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/ai/help-ask",
            json={"question": "Comment ajouter un logement ?", "screen": "Centre d'aide"},
            timeout=60,
        )
        assert r.status_code == 200, f"got {r.status_code}: {r.text}"
        data = r.json()
        assert "answer" in data
        assert isinstance(data["answer"], str)
        assert len(data["answer"]) > 20, f"answer too short: {data['answer']!r}"

    def test_help_ask_with_screen_context(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/ai/help-ask",
            json={"question": "Que voit-on ici ?", "screen": "Relevé propriétaires"},
            timeout=60,
        )
        assert r.status_code == 200
        assert r.json().get("answer")


# ----- non-regression: /api/ai/guest-reply -----
class TestGuestReplyNonRegression:
    def test_guest_reply_auth_required(self, anon_client):
        r = anon_client.post(f"{BASE_URL}/api/ai/guest-reply", json={"guest_message": "Bonjour"})
        assert r.status_code == 401

    def test_guest_reply_ok(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/ai/guest-reply",
            json={"guest_message": "À quelle heure puis-je arriver ?", "tone": "chaleureux"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "reply" in data
        assert isinstance(data["reply"], str) and len(data["reply"]) > 5


# ----- non-regression: /api/ai/pricing-suggestion -----
class TestPricingNonRegression:
    @pytest.fixture
    def test_property(self, test_user):
        """Insert a property directly into Mongo for the test user."""
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        pid = f"prop_TEST_{uuid.uuid4().hex[:8]}"
        import asyncio
        loop = asyncio.new_event_loop()

        async def setup():
            await db.properties.insert_one({
                "id": pid,
                "user_id": test_user["user_id"],
                "name": "TEST Villa",
                "location": "Nice",
                "base_price": 120,
                "capacity": 4,
                "bedrooms": 2,
                "seasons": [],
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

        async def teardown():
            await db.properties.delete_one({"id": pid})
            client.close()

        loop.run_until_complete(setup())
        yield pid
        loop.run_until_complete(teardown())
        loop.close()

    def test_pricing_auth_required(self, anon_client):
        r = anon_client.post(f"{BASE_URL}/api/ai/pricing-suggestion", json={"property_id": "x"})
        assert r.status_code == 401

    def test_pricing_property_not_found(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/ai/pricing-suggestion",
            json={"property_id": "does_not_exist_xyz"},
        )
        assert r.status_code == 404

    def test_pricing_ok(self, api_client, test_property):
        r = api_client.post(
            f"{BASE_URL}/api/ai/pricing-suggestion",
            json={"property_id": test_property, "period": "été 2026"},
            timeout=120,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "suggestion" in data
        assert "seasons" in data
        assert isinstance(data["seasons"], list)
