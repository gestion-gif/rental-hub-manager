# ruff: noqa: F403, F405
import re
from html import escape

from core import *  # noqa: F401


def _plain_to_html(body: str) -> str:
    safe = escape(str(body or "")).replace("\n", "<br>")
    return (
        "<div style='font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.6'>"
        f"{safe}</div>"
    )


@api_router.get("/messaging/context")
async def messaging_context(reservation_id: str, user=Depends(get_current_user)):
    """Infos voyageur + canaux disponibles + modèles/réponses (variables déjà remplacées)."""
    uid = user["user_id"]
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Réservation introuvable")
    prop = await db.properties.find_one({"id": r.get("property_id"), "user_id": uid}, {"_id": 0}) or {}
    prefs = await db.preferences.find_one({"user_id": uid}, {"_id": 0}) or {}

    phone_digits = re.sub(r"\D", "", r.get("guest_phone") or "")
    email = (r.get("guest_email") or "").strip()
    cx_booking = r.get("channex_booking_id")

    templates = await get_templates(uid)
    tpl_out = [{
        "id": t.get("id") or t.get("marker_key"),
        "name": t.get("name") or "Modèle",
        "body": _render_message_vars(t.get("body", ""), r, prop, prefs),
    } for t in templates if t.get("kind") == "message"]

    qr_out = []
    if _can_inbox(user):
        qrs = await _seed_quick_replies(uid)
        qr_out = [{
            "id": q.get("id"),
            "name": q.get("title") or "Réponse type",
            "body": _render_message_vars(q.get("body", ""), r, prop, prefs),
        } for q in qrs]

    return {
        "reservation_id": reservation_id,
        "guest_name": r.get("guest_name", "") or "",
        "guest_phone": phone_digits,
        "guest_email": email,
        "channels": {
            "whatsapp": bool(phone_digits),
            "email": bool(email),
            "platform": {
                "available": bool(cx_booking),
                "provider": "channex" if cx_booking else None,
            },
        },
        "templates": tpl_out,
        "quick_replies": qr_out,
    }


class SendMessageIn(BaseModel):
    reservation_id: str
    channel: str  # "email" | "platform"
    subject: Optional[str] = ""
    body: str


@api_router.post("/messaging/send")
async def messaging_send(payload: SendMessageIn, user=Depends(get_current_user)):
    """Envoi Email (Resend) ou message plateforme (Channex). WhatsApp est géré côté app."""
    uid = user["user_id"]
    r = await db.reservations.find_one({"id": payload.reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Réservation introuvable")
    body = (payload.body or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Message vide")

    if payload.channel == "email":
        to = (r.get("guest_email") or "").strip()
        if not to:
            return {"sent": False, "reason": "no_email"}
        subject = (payload.subject or "").strip() or f"Message — {r.get('property_name') or 'votre séjour'}"
        await send_email(to=to, subject=subject, html=_plain_to_html(body))
        await log_guest_message(uid, payload.reservation_id, "email", "manuel", body, to=to, subject=subject)
        return {"sent": True, "channel": "email", "to": to}

    if payload.channel == "platform":
        cx_booking = r.get("channex_booking_id")
        if not cx_booking:
            return {"sent": False, "reason": "no_platform_thread"}
        settings = await db.channex_settings.find_one({"user_id": uid}, {"_id": 0})
        if not settings or not settings.get("api_key"):
            return {"sent": False, "reason": "no_channex"}
        adapter = ChannexAdapter(settings["api_key"], settings.get("environment", "staging"))
        async with httpx.AsyncClient(timeout=30) as http:
            await adapter.send_booking_message(http, cx_booking, body)
        await log_guest_message(uid, payload.reservation_id, "platform", "manuel", body)
        return {"sent": True, "channel": "platform"}

    raise HTTPException(status_code=400, detail="Canal inconnu")


class WhatsAppLogIn(BaseModel):
    reservation_id: str
    body: str


@api_router.post("/messaging/log-whatsapp")
async def messaging_log_whatsapp(payload: WhatsAppLogIn, user=Depends(get_current_user)):
    """Trace un message WhatsApp (envoyé depuis l'app du téléphone) dans l'historique."""
    uid = user["user_id"]
    r = await db.reservations.find_one(
        {"id": payload.reservation_id, "user_id": uid}, {"_id": 0, "id": 1, "guest_phone": 1})
    if not r:
        raise HTTPException(status_code=404, detail="Réservation introuvable")
    await log_guest_message(uid, payload.reservation_id, "whatsapp", "manuel",
                            (payload.body or "").strip(), to=r.get("guest_phone") or "")
    return {"ok": True}
