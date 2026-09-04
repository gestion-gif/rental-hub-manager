"""One-off: traduit les chaînes FR de l'app en EN via la clé Emergent (Claude).
Sortie : /app/frontend/src/i18n/en.json (map FR -> EN)."""
import asyncio
import json
import os
import re
import sys

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from emergentintegrations.llm.chat import LlmChat, UserMessage  # noqa: E402

KEY = os.environ.get("EMERGENT_LLM_KEY")
OUT = "/app/frontend/src/i18n/en.json"
BATCH = 60

SYSTEM = (
    "You translate French UI strings of a vacation-rental property management mobile app into English. "
    "Rules: keep it concise and natural for a mobile app UI; keep placeholders like {caution}, {prenom}, %s untouched; "
    "keep punctuation style (… stays …, keep trailing ellipsis/colons); do not translate proper nouns "
    "(Casanéo, Channex, Stripe, Airbnb, Booking.com, Lodgify, Pricelabs, Expo); "
    '"logement" = "property", "ménage" = "cleaning", "voyageur" = "guest", "réservation" = "booking", '
    '"relevé" = "statement", "caution" = "security deposit", "acompte" = "deposit", "séjour" = "stay", '
    '"intervenant" = "staff member", "fiche" = "profile/form" depending on context. '
    "Reply ONLY with a JSON object mapping each input string to its translation, no markdown fences."
)


def clean(raw: str) -> str:
    txt = (raw or "").strip()
    if txt.startswith("```"):
        txt = re.sub(r"^```(?:json)?\s*", "", txt)
        txt = re.sub(r"\s*```$", "", txt).strip()
    return txt


async def main():
    strings = json.load(open("/tmp/fr_strings.json", encoding="utf-8"))
    done = {}
    if os.path.exists(OUT):
        done = json.load(open(OUT, encoding="utf-8"))
    todo = [s for s in strings if s not in done]
    print(f"total={len(strings)} done={len(done)} todo={len(todo)}", flush=True)
    for i in range(0, len(todo), BATCH):
        batch = todo[i:i + BATCH]
        chat = LlmChat(api_key=KEY, session_id=f"tr-{i}", system_message=SYSTEM)\
            .with_model("anthropic", "claude-sonnet-4-6")
        prompt = "Translate these French strings to English. Return a JSON object {french: english}:\n" \
            + json.dumps(batch, ensure_ascii=False)
        for attempt in range(3):
            try:
                resp = await chat.send_message(UserMessage(text=prompt))
                data = json.loads(clean(resp))
                for k in batch:
                    if k in data and isinstance(data[k], str) and data[k].strip():
                        done[k] = data[k]
                break
            except Exception as e:
                print(f"batch {i} attempt {attempt}: {e}", flush=True)
                await asyncio.sleep(3)
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        json.dump(done, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1, sort_keys=True)
        print(f"progress {min(i + BATCH, len(todo))}/{len(todo)}", flush=True)
    missing = [s for s in strings if s not in done]
    print(f"FINISHED missing={len(missing)}")
    if missing:
        json.dump(missing, open("/tmp/missing.json", "w"), ensure_ascii=False)

asyncio.run(main())
