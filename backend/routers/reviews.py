# ruff: noqa: F403, F405
from core import *  # noqa: F401


@api_router.get("/reviews")
async def list_reviews(property_id: str = "", user=Depends(get_current_user)):
    uid = user["user_id"]
    try:
        await sync_channex_reviews(uid)
    except Exception:
        logger.exception("channex reviews sync failed")
    q = {"user_id": uid, **_prop_scope(user, "property_id")}
    if property_id:
        q["property_id"] = property_id
    items = await db.reviews.find(q, {"_id": 0}).sort("date", -1).to_list(2000)
    return items


@api_router.get("/reviews/summary")
async def reviews_summary(user=Depends(get_current_user)):
    """Note moyenne + nombre d'avis par logement (+ moyenne globale)."""
    uid = user["user_id"]
    props = await db.properties.find(
        {"user_id": uid, **_prop_scope(user)}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
    reviews = await db.reviews.find(
        {"user_id": uid, **_prop_scope(user, "property_id")}, {"_id": 0}).to_list(5000)
    by_prop: dict = {}
    for rv in reviews:
        by_prop.setdefault(rv["property_id"], []).append(float(rv.get("rating") or 0))
    per_property = []
    all_ratings = []
    for p in props:
        rs = by_prop.get(p["id"], [])
        all_ratings += rs
        per_property.append({
            "property_id": p["id"], "property_name": p.get("name", "Logement"),
            "count": len(rs),
            "avg": round(sum(rs) / len(rs), 2) if rs else 0,
        })
    per_property.sort(key=lambda x: (-x["avg"], -x["count"]))
    return {
        "per_property": per_property,
        "total_reviews": len(all_ratings),
        "avg_all": round(sum(all_ratings) / len(all_ratings), 2) if all_ratings else 0,
    }


@api_router.post("/reviews")
async def create_review(payload: ReviewIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    prop = await db.properties.find_one(
        {"id": payload.property_id, "user_id": uid, **_prop_scope(user)}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Logement introuvable")
    doc = payload.dict()
    doc["rating"] = max(1, min(5, int(doc.get("rating") if doc.get("rating") is not None else 5)))
    doc["date"] = doc.get("date") or date.today().isoformat()
    doc["property_name"] = prop.get("name", "")
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = uid
    doc["created_at"] = now_utc().isoformat()
    await db.reviews.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/reviews/{review_id}")
async def update_review(review_id: str, payload: ReviewIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    existing = await db.reviews.find_one({"id": review_id, "user_id": uid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Avis introuvable")
    if existing.get("channex_review_id"):
        raise HTTPException(status_code=400, detail="Avis OTA (Channex) — modification impossible")
    data = payload.dict()
    data["rating"] = max(1, min(5, int(data.get("rating") if data.get("rating") is not None else 5)))
    await db.reviews.update_one({"id": review_id, "user_id": uid}, {"$set": data})
    item = await db.reviews.find_one({"id": review_id}, {"_id": 0})
    return item


@api_router.delete("/reviews/{review_id}")
async def delete_review(review_id: str, user=Depends(get_current_user)):
    existing = await db.reviews.find_one(
        {"id": review_id, "user_id": user["user_id"]}, {"_id": 0, "channex_review_id": 1})
    if existing and existing.get("channex_review_id"):
        raise HTTPException(status_code=400, detail="Avis OTA (Channex) — suppression impossible")
    await db.reviews.delete_one({"id": review_id, "user_id": user["user_id"]})
    return {"ok": True}


@api_router.post("/reviews/{review_id}/reply")
async def reply_to_review(review_id: str, payload: ReviewReplyIn, user=Depends(get_current_user)):
    """Publie la réponse de l'hôte à un avis OTA via Channex."""
    uid = user["user_id"]
    text = (payload.reply or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Réponse vide")
    rv = await db.reviews.find_one({"id": review_id, "user_id": uid}, {"_id": 0})
    if not rv:
        raise HTTPException(status_code=404, detail="Avis introuvable")
    if not rv.get("channex_review_id"):
        raise HTTPException(status_code=400, detail="Avis local — publication OTA impossible")
    if rv.get("is_replied"):
        raise HTTPException(status_code=400, detail="Cet avis a déjà une réponse publiée")
    adapter, _ = await get_channex_adapter(uid)
    if not adapter:
        raise HTTPException(status_code=400, detail="Channex non connecté")
    async with httpx.AsyncClient(timeout=60) as http:
        await adapter.reply_review(http, rv["channex_review_id"], text)
    await db.reviews.update_one(
        {"id": review_id, "user_id": uid},
        {"$set": {"reply": text, "is_replied": True, "replied_at": now_utc().isoformat()}})
    await _sync_log(uid, "review_reply", "success",
                    f"Réponse publiée à l'avis de {rv.get('guest_name') or 'voyageur'} ({rv.get('ota') or 'OTA'})")
    return {"ok": True, "reply": text}


@api_router.post("/reviews/{review_id}/ai-reply")
async def ai_review_reply(review_id: str, user=Depends(get_current_user)):
    """Suggestion IA de réponse publique à un avis voyageur."""
    uid = user["user_id"]
    rv = await db.reviews.find_one({"id": review_id, "user_id": uid}, {"_id": 0})
    if not rv:
        raise HTTPException(status_code=404, detail="Avis introuvable")
    score = rv.get("score10") or (float(rv.get("rating") or 0) * 2)
    system = (
        "Tu es l'assistant d'un hôte de location saisonnière. Tu rédiges une réponse PUBLIQUE "
        "courte (2 à 4 phrases) à un avis voyageur, chaleureuse et professionnelle. "
        "Remercie le voyageur ; si l'avis mentionne un problème, excuse-toi brièvement et "
        "montre que c'est pris en compte, sans promesse précise. Rédige dans la MÊME langue "
        "que l'avis (par défaut le français). Réponds uniquement avec la réponse, sans préambule."
    )
    prompt = (
        f"Logement : {rv.get('property_name') or ''}\n"
        f"Voyageur : {rv.get('guest_name') or 'Anonyme'} · Note : {score}/10\n"
        f"Avis : \"{rv.get('comment') or '(pas de commentaire, note seulement)'}\"\n"
        "Rédige la réponse publique de l'hôte."
    )
    chat = make_chat(system, f"review_{uid}_{review_id}")
    draft = (await chat.send_message(UserMessage(text=prompt))).strip()
    return {"reply": draft}

