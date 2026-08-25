# ruff: noqa: F403, F405
from core import *  # noqa: F401


@api_router.get("/inbox")
async def inbox(user=Depends(get_current_user)):
    if not _can_inbox(user):
        raise HTTPException(status_code=403, detail="Accès à la boîte de réception non autorisé")
    convs = await db.conversations.find(
        {"user_id": user["user_id"], **_prop_scope(user, "property_id")}, {"_id": 0}).sort("last_activity", -1).to_list(500)
    return convs


@api_router.get("/inbox-unread-count")
async def inbox_unread_count(user=Depends(get_current_user)):
    if not _can_inbox(user):
        return {"count": 0}
    n = await db.conversations.count_documents({"user_id": user["user_id"], "unread": True})
    return {"count": n}


@api_router.get("/inbox/{thread_uid}")
async def inbox_thread(thread_uid: str, user=Depends(get_current_user)):
    if not _can_inbox(user):
        raise HTTPException(status_code=403, detail="Accès à la boîte de réception non autorisé")
    adapter, _ = await get_channel_adapter(user["user_id"])
    if not adapter:
        raise HTTPException(status_code=400, detail="Channel manager non connecté")
    uid = user["user_id"]
    conv = await db.conversations.find_one(
        {"user_id": uid, "thread_uid": thread_uid}, {"_id": 0})
    async with httpx.AsyncClient(timeout=30) as http:
        thread = await adapter.get_thread(http, thread_uid)
    msgs = _normalize_msgs(thread)

    need_draft = bool(msgs and not msgs[-1].get("mine"))
    guest_idx = [i for i, m in enumerate(msgs) if not m.get("mine")]
    prop = None
    if need_draft:
        prop = await db.properties.find_one(
            {"id": (conv or {}).get("property_id"), "user_id": uid}, {"_id": 0})

    stored_draft = None
    if (need_draft and conv and conv.get("ai_draft")
            and conv.get("ai_draft_msg_id") == msgs[-1]["id"]
            and not conv.get("ai_draft_validated")):
        stored_draft = conv["ai_draft"]

    async def _do_draft():
        if not need_draft or stored_draft is not None:
            return stored_draft
        if not await _ai_auto_draft_enabled(uid):
            return None
        try:
            d = await _make_guest_draft(uid, thread_uid, msgs[-1]["text"], prop)
            await _store_draft(uid, thread_uid, msgs[-1]["id"], d)
            return d
        except Exception:
            logger.exception("draft generation failed")
            return None

    async def _do_trans():
        try:
            return await _translate_to_fr(uid, thread_uid, [msgs[i]["text"] for i in guest_idx])
        except Exception:
            return []

    ai_draft, fr = await asyncio.gather(_do_draft(), _do_trans())
    for j, i in enumerate(guest_idx):
        if j < len(fr):
            t = (fr[j] or "").strip()
            if t and t != (msgs[i]["text"] or "").strip():
                msgs[i]["text_fr"] = t

    await db.conversations.update_one(
        {"user_id": uid, "thread_uid": thread_uid},
        {"$set": {"unread": False}})
    resa = await db.reservations.find_one(
        {"user_id": uid, "thread_uid": thread_uid}, {"_id": 0, "id": 1})
    return {
        "thread_uid": thread_uid,
        "reservation_id": (resa or {}).get("id"),
        "guest_name": thread.get("guest_name") or (conv or {}).get("guest_name"),
        "property_name": (conv or {}).get("property_name"),
        "source": (conv or {}).get("source"),
        "messages": msgs,
        "ai_draft": ai_draft,
    }


@api_router.post("/inbox/{thread_uid}/generate-draft")
async def generate_draft(thread_uid: str, payload: dict = Body(default={}), user=Depends(get_current_user)):
    """Génère (ou régénère) un brouillon de réponse IA pour une conversation."""
    if not _can_inbox(user):
        raise HTTPException(status_code=403, detail="Accès à la boîte de réception non autorisé")
    adapter, _ = await get_channel_adapter(user["user_id"])
    if not adapter:
        raise HTTPException(status_code=400, detail="Channel manager non connecté")
    uid = user["user_id"]
    tone = (payload or {}).get("tone") or "chaleureux"
    conv = await db.conversations.find_one(
        {"user_id": uid, "thread_uid": thread_uid}, {"_id": 0})
    async with httpx.AsyncClient(timeout=30) as http:
        thread = await adapter.get_thread(http, thread_uid)
    msgs = _normalize_msgs(thread)
    last_guest = next((m for m in reversed(msgs) if not m.get("mine")), None)
    if not last_guest:
        raise HTTPException(status_code=400, detail="Aucun message voyageur auquel répondre")
    prop = await db.properties.find_one(
        {"id": (conv or {}).get("property_id"), "user_id": uid}, {"_id": 0})
    draft = await _make_guest_draft(uid, thread_uid, last_guest["text"], prop, tone)
    await _store_draft(uid, thread_uid, last_guest["id"], draft)
    return {"ai_draft": draft}


@api_router.get("/notifications")
async def notifications(user=Depends(get_current_user)):
    """Réponses IA prêtes à valider (brouillons non encore validés)."""
    if not _can_inbox(user):
        return {"count": 0, "items": []}
    convs = await db.conversations.find(
        {"user_id": user["user_id"], "ai_draft": {"$nin": [None, ""]},
         "ai_draft_validated": {"$ne": True}, **_prop_scope(user, "property_id")},
        {"_id": 0}).sort("ai_draft_at", -1).to_list(200)
    items = [{
        "thread_uid": c["thread_uid"], "guest_name": c.get("guest_name"),
        "property_name": c.get("property_name"), "source": c.get("source"),
        "ai_draft": c.get("ai_draft"), "ai_draft_at": c.get("ai_draft_at"),
    } for c in convs]
    return {"count": len(items), "items": items}


@api_router.get("/notifications/count")
async def notifications_count(user=Depends(get_current_user)):
    if not _can_inbox(user):
        return {"count": 0}
    n = await db.conversations.count_documents(
        {"user_id": user["user_id"], "ai_draft": {"$nin": [None, ""]},
         "ai_draft_validated": {"$ne": True}, **_prop_scope(user, "property_id")})
    return {"count": n}


@api_router.post("/inbox/{thread_uid}/reply")
async def inbox_reply(thread_uid: str, payload: ReplyIn, user=Depends(get_current_user)):
    if not _can_inbox(user):
        raise HTTPException(status_code=403, detail="Accès à la boîte de réception non autorisé")
    if not payload.message.strip():
        raise HTTPException(status_code=400, detail="Message vide")
    adapter, _ = await get_channel_adapter(user["user_id"])
    if not adapter:
        raise HTTPException(status_code=400, detail="Channel manager non connecté")
    res = await db.reservations.find_one(
        {"user_id": user["user_id"], "thread_uid": thread_uid, "lodgify_id": {"$nin": [None, ""]}},
        {"_id": 0})
    if not res or not res.get("lodgify_id"):
        raise HTTPException(status_code=404, detail="Réservation liée introuvable pour cette conversation")
    async with httpx.AsyncClient(timeout=30) as http:
        await adapter.send_message(http, res["lodgify_id"], payload.message.strip(), payload.subject)
    await log_guest_message(user["user_id"], res.get("id") or "", "platform", "manuel",
                            payload.message.strip(), subject=payload.subject or "")
    # Une fois envoyé, le brouillon IA est validé/consommé
    await db.conversations.update_one(
        {"user_id": user["user_id"], "thread_uid": thread_uid},
        {"$set": {"last_activity": now_utc().isoformat(), "ai_draft_validated": True},
         "$unset": {"ai_draft": "", "ai_draft_msg_id": "", "ai_draft_at": ""}})
    return {
        "ok": True,
        "message": {
            "id": str(uuid.uuid4()),
            "text": payload.message.strip(),
            "type": "Owner",
            "date": now_utc().isoformat(),
            "mine": True,
        },
    }

