"""Notifications Telegram (bot → chats). Envoi unidirectionnel, jamais bloquant.
Réglages par utilisateur dans preferences.telegram :
  enabled, bot_token, chat_ops (équipe terrain), chat_admin (gestion),
  notify_bookings, notify_payments, notify_reschedule, notify_daily, daily_hour.
"""
import html
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

from infra import db, logger

TG_API = "https://api.telegram.org/bot{token}/{method}"

# Événement → chat cible + interrupteur de réglage
_EVENT_CHAT = {"booking": "chat_admin", "payment": "chat_admin", "task": "chat_ops", "daily": "chat_ops"}
_EVENT_FLAG = {"booking": "notify_bookings", "payment": "notify_payments",
               "task": "notify_reschedule", "daily": "notify_daily"}


def tg_esc(s) -> str:
    return html.escape(str(s or ""))


async def tg_settings(uid: str):
    doc = await db.preferences.find_one({"user_id": uid}, {"_id": 0, "telegram": 1}) or {}
    tg = doc.get("telegram") or {}
    if not tg.get("enabled") or not tg.get("bot_token"):
        return None
    return tg


async def tg_send_raw(token: str, chat_id: str, text: str):
    """Envoie un message (HTML). Lève une exception si Telegram refuse."""
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.post(TG_API.format(token=token, method="sendMessage"),
                            json={"chat_id": chat_id, "text": text[:4000], "parse_mode": "HTML",
                                  "disable_web_page_preview": True})
        data = r.json()
        if not data.get("ok"):
            raise ValueError(data.get("description") or f"HTTP {r.status_code}")
        return data


async def tg_notify(uid: str, event: str, text: str) -> bool:
    """Notification d'événement — n'échoue jamais côté appelant."""
    try:
        tg = await tg_settings(uid)
        if not tg or not tg.get(_EVENT_FLAG.get(event, ""), True):
            return False
        chat = tg.get(_EVENT_CHAT.get(event, "")) or tg.get("chat_admin") or tg.get("chat_ops")
        if not chat:
            return False
        await tg_send_raw(tg["bot_token"], chat, text)
        return True
    except Exception as e:
        logger.warning("telegram notify failed (%s): %s", event, e)
        return False


async def tg_detect_chats(token: str) -> list:
    """Liste les chats vus par le bot (getUpdates). L'utilisateur doit d'abord
    envoyer /start au bot (ou dans le groupe après l'y avoir ajouté)."""
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.get(TG_API.format(token=token, method="getUpdates"),
                           params={"limit": 100})
        data = r.json()
    if not data.get("ok"):
        raise ValueError(data.get("description") or "Token invalide")
    chats = {}
    for upd in data.get("result") or []:
        for key in ("message", "channel_post", "edited_message"):
            c = ((upd.get(key) or {}).get("chat")) or {}
            if c.get("id"):
                chats[c["id"]] = c
        c = (((upd.get("my_chat_member") or {}).get("chat")) or {})
        if c.get("id"):
            chats[c["id"]] = c
    out = []
    for cid, c in chats.items():
        name = c.get("title") or " ".join(
            x for x in [c.get("first_name"), c.get("last_name")] if x) or c.get("username") or str(cid)
        out.append({"chat_id": str(cid), "name": name, "type": c.get("type") or ""})
    return out


async def build_daily_digest(uid: str, day_iso: str):
    """Récapitulatif du jour pour l'équipe terrain. None si rien à signaler."""
    props = await db.properties.find({"user_id": uid}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
    pmap = {p["id"]: p.get("name", "Logement") for p in props}
    active = {"$nin": ["annulee", "bloque"]}
    deps = await db.reservations.find(
        {"user_id": uid, "check_out": day_iso, "status": active}, {"_id": 0}).to_list(200)
    arrs = await db.reservations.find(
        {"user_id": uid, "check_in": day_iso, "status": active}, {"_id": 0}).to_list(200)
    ivs = await db.interventions.find(
        {"user_id": uid, "date": day_iso}, {"_id": 0}).to_list(500)
    if not deps and not arrs and not ivs:
        return None
    lines = [f"🗓 <b>Programme du jour</b> — {day_iso[8:10]}/{day_iso[5:7]}"]
    if deps:
        lines.append("\n🔴 <b>Départs</b>")
        for r in deps:
            t = f" ({r.get('checkout_time')})" if r.get("checkout_time") else ""
            lines.append(f"• {tg_esc(pmap.get(r['property_id'], 'Logement'))} — {tg_esc(r.get('guest_name'))}{t}")
    if arrs:
        lines.append("\n🟢 <b>Arrivées</b>")
        for r in arrs:
            t = f" ({r.get('checkin_time')})" if r.get("checkin_time") else ""
            lines.append(f"• {tg_esc(pmap.get(r['property_id'], 'Logement'))} — {tg_esc(r.get('guest_name'))}{t}")
    labels = {"menage": "🧹 Ménages", "remise_cles": "🔑 Remises de clés", "caution": "🛡 Cautions"}
    groups = {}
    for iv in ivs:
        groups.setdefault(iv.get("kind", "menage"), []).append(iv)
    for kind, items in groups.items():
        lines.append(f"\n{labels.get(kind, '🔧 Interventions')}")
        for iv in items:
            extra = f" — {tg_esc(iv.get('description'))}" if iv.get("description") else ""
            who = f" ({tg_esc(iv.get('intervenant'))})" if iv.get("intervenant") else ""
            lines.append(f"• {tg_esc(pmap.get(iv['property_id'], 'Logement'))}{extra}{who}")
    return "\n".join(lines)


async def run_daily_digests():
    """Envoie le récap quotidien à chaque compte configuré (idempotent par jour)."""
    now_paris = datetime.now(ZoneInfo("Europe/Paris"))
    today = now_paris.date().isoformat()
    prefs = await db.preferences.find(
        {"telegram.enabled": True}, {"_id": 0, "user_id": 1, "telegram": 1}).to_list(1000)
    for p in prefs:
        tg = p.get("telegram") or {}
        if not tg.get("notify_daily", True) or not tg.get("bot_token"):
            continue
        chat = tg.get("chat_ops") or tg.get("chat_admin")
        if not chat:
            continue
        try:
            hour = int(tg.get("daily_hour", 7))
        except Exception:
            hour = 7
        if now_paris.hour < hour or tg.get("last_daily_sent") == today:
            continue
        try:
            text = await build_daily_digest(p["user_id"], today)
            if text:
                await tg_send_raw(tg["bot_token"], chat, text)
        except Exception as e:
            logger.warning("telegram daily digest failed for %s: %s", p.get("user_id"), e)
        await db.preferences.update_one(
            {"user_id": p["user_id"]}, {"$set": {"telegram.last_daily_sent": today}})
