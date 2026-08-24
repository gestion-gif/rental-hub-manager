# ruff: noqa: F403, F405
from core import *  # noqa: F401


@api_router.get("/message-templates")
async def list_templates(user=Depends(get_current_user)):
    return await get_templates(user["user_id"])


@api_router.post("/message-templates")
async def create_template(payload: MessageTemplateIn, user=Depends(get_current_user)):
    await get_templates(user["user_id"])  # ensure defaults seeded
    doc = payload.dict()
    doc["marker_key"] = f"tpl_{uuid.uuid4().hex[:8]}"
    doc["kind"] = "message"
    doc["order"] = 100
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    await db.message_templates.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/message-templates/{tpl_id}")
async def update_template(tpl_id: str, payload: MessageTemplateIn, user=Depends(get_current_user)):
    res = await db.message_templates.update_one(
        {"id": tpl_id, "user_id": user["user_id"]}, {"$set": payload.dict()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Modèle introuvable")
    return await db.message_templates.find_one({"id": tpl_id}, {"_id": 0})


@api_router.delete("/message-templates/{tpl_id}")
async def delete_template(tpl_id: str, user=Depends(get_current_user)):
    tpl = await db.message_templates.find_one({"id": tpl_id, "user_id": user["user_id"]}, {"_id": 0})
    if tpl and tpl.get("kind") == "payment":
        raise HTTPException(status_code=400, detail="Le marqueur Payée ne peut pas être supprimé")
    await db.message_templates.delete_one({"id": tpl_id, "user_id": user["user_id"]})
    return {"ok": True}


@api_router.get("/quick-replies")
async def list_quick_replies(user=Depends(get_current_user)):
    if not _can_inbox(user):
        raise HTTPException(status_code=403, detail="Accès non autorisé")
    return await _seed_quick_replies(user["user_id"])


@api_router.post("/quick-replies")
async def create_quick_reply(payload: QuickReplyIn, user=Depends(get_current_user)):
    if not payload.title.strip() or not payload.body.strip():
        raise HTTPException(status_code=400, detail="Titre et message requis")
    await _seed_quick_replies(user["user_id"])
    doc = {"id": str(uuid.uuid4()), "user_id": user["user_id"],
           "title": payload.title.strip(), "body": payload.body.strip(),
           "order": 100, "created_at": now_utc().isoformat()}
    await db.quick_replies.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/quick-replies/{qid}")
async def update_quick_reply(qid: str, payload: QuickReplyIn, user=Depends(get_current_user)):
    res = await db.quick_replies.update_one(
        {"id": qid, "user_id": user["user_id"]},
        {"$set": {"title": payload.title.strip(), "body": payload.body.strip()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Réponse type introuvable")
    return await db.quick_replies.find_one({"id": qid}, {"_id": 0})


@api_router.delete("/quick-replies/{qid}")
async def delete_quick_reply(qid: str, user=Depends(get_current_user)):
    await db.quick_replies.delete_one({"id": qid, "user_id": user["user_id"]})
    return {"ok": True}

