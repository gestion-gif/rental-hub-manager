# ruff: noqa: F403, F405
from core import *  # noqa: F401
from core import enqueue_channex_ari, enqueue_channex_availability  # noqa: F401


@api_router.get("/properties")
async def list_properties(user=Depends(get_current_user)):
    items = await db.properties.find(
        {"user_id": user["user_id"], **_prop_scope(user)}, {"_id": 0}).to_list(500)
    return items


@api_router.post("/properties")
async def create_property(payload: PropertyIn, user=Depends(get_current_user)):
    from routers.billing import billing_state_for
    state = await billing_state_for(user["user_id"])
    limit = state.get("property_limit")
    if limit is not None and state.get("property_count", 0) >= limit:
        raise HTTPException(
            status_code=402,
            detail=f"Limite de votre formule atteinte ({limit} logements). Passez à la formule supérieure pour en ajouter.")
    doc = payload.dict()
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    await db.properties.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/properties/{property_id}")
async def get_property(property_id: str, user=Depends(get_current_user)):
    item = await db.properties.find_one(
        {"id": property_id, "user_id": user["user_id"], **_prop_scope(user)}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Property not found")
    return item


@api_router.put("/properties/{property_id}")
async def update_property(property_id: str, payload: PropertyIn, user=Depends(get_current_user)):
    data = payload.dict()
    # Never wipe an existing channel mapping when the form omits it
    if data.get("lodgify_id") is None:
        data.pop("lodgify_id", None)
    if data.get("owner_id") is None:
        data.pop("owner_id", None)
    if data.get("dynamic_pricing") is None:
        data.pop("dynamic_pricing", None)
    if data.get("pricelabs_managed") is None:
        data.pop("pricelabs_managed", None)
    res = await db.properties.update_one(
        {"id": property_id, "user_id": user["user_id"]},
        {"$set": data},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Property not found")
    item = await db.properties.find_one({"id": property_id}, {"_id": 0})
    # Prix/saisons modifiés → pousser les tarifs vers Channex (500 j)
    _today = now_utc().date()
    await enqueue_channex_ari(user["user_id"], property_id, _today.isoformat(),
                              (_today + timedelta(days=499)).isoformat(), avail=False)
    return item


@api_router.delete("/properties/{property_id}")
async def delete_property(property_id: str, user=Depends(get_current_user)):
    await db.properties.delete_one({"id": property_id, "user_id": user["user_id"]})
    await db.reservations.delete_many({"property_id": property_id, "user_id": user["user_id"]})
    return {"ok": True}


@api_router.patch("/properties/{property_id}/published")
async def set_property_published(property_id: str, payload: PublishIn, user=Depends(get_current_user)):
    res = await db.properties.update_one(
        {"id": property_id, "user_id": user["user_id"]},
        {"$set": {"published": bool(payload.published)}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Property not found")
    return {"id": property_id, "published": bool(payload.published)}


@api_router.get("/properties/{property_id}/rooms")
async def list_rooms(property_id: str, user=Depends(get_current_user)):
    await _assert_property(user["user_id"], property_id)
    rooms = await db.rooms.find({"user_id": user["user_id"], "property_id": property_id}, {"_id": 0}).to_list(200)
    return {"rooms": rooms}


@api_router.post("/properties/{property_id}/rooms")
async def create_room(property_id: str, payload: RoomIn, user=Depends(get_current_user)):
    await _assert_property(user["user_id"], property_id)
    doc = payload.dict()
    doc.update({"id": str(uuid.uuid4()), "user_id": user["user_id"], "property_id": property_id,
                "created_at": now_utc().isoformat()})
    await db.rooms.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/rooms/{room_id}")
async def update_room(room_id: str, payload: RoomIn, user=Depends(get_current_user)):
    r = await db.rooms.find_one({"id": room_id, "user_id": user["user_id"]}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Chambre introuvable")
    data = payload.dict()
    if data.get("channex_room_type_id") is None:
        data.pop("channex_room_type_id", None)  # ne pas écraser le mapping Channex
    await db.rooms.update_one({"id": room_id}, {"$set": data})
    return {**r, **data}


@api_router.delete("/rooms/{room_id}")
async def delete_room(room_id: str, user=Depends(get_current_user)):
    res = await db.rooms.delete_one({"id": room_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Chambre introuvable")
    await db.rate_plans.delete_many({"room_id": room_id, "user_id": user["user_id"]})
    await db.availability.delete_many({"room_id": room_id, "user_id": user["user_id"]})
    return {"ok": True}


@api_router.get("/properties/{property_id}/rate-plans")
async def list_rate_plans(property_id: str, user=Depends(get_current_user)):
    await _assert_property(user["user_id"], property_id)
    plans = await db.rate_plans.find({"user_id": user["user_id"], "property_id": property_id}, {"_id": 0}).to_list(200)
    return {"rate_plans": plans}


@api_router.post("/properties/{property_id}/rate-plans")
async def create_rate_plan(property_id: str, payload: RatePlanIn, user=Depends(get_current_user)):
    await _assert_property(user["user_id"], property_id)
    doc = payload.dict()
    doc.update({"id": str(uuid.uuid4()), "user_id": user["user_id"], "property_id": property_id,
                "created_at": now_utc().isoformat()})
    await db.rate_plans.insert_one(doc)
    doc.pop("_id", None)
    _t = now_utc().date()
    await enqueue_channex_ari(user["user_id"], property_id, _t.isoformat(),
                              (_t + timedelta(days=499)).isoformat(), avail=False)
    return doc


@api_router.put("/rate-plans/{plan_id}")
async def update_rate_plan(plan_id: str, payload: RatePlanIn, user=Depends(get_current_user)):
    p = await db.rate_plans.find_one({"id": plan_id, "user_id": user["user_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Tarif introuvable")
    data = payload.dict()
    if data.get("channex_rate_plan_id") is None:
        data.pop("channex_rate_plan_id", None)  # ne pas écraser le mapping Channex
    await db.rate_plans.update_one({"id": plan_id}, {"$set": data})
    _t = now_utc().date()
    await enqueue_channex_ari(user["user_id"], p["property_id"], _t.isoformat(),
                              (_t + timedelta(days=499)).isoformat(), avail=False)
    return {**p, **data}


@api_router.delete("/rate-plans/{plan_id}")
async def delete_rate_plan(plan_id: str, user=Depends(get_current_user)):
    res = await db.rate_plans.delete_one({"id": plan_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Tarif introuvable")
    return {"ok": True}


@api_router.get("/rooms/{room_id}/availability")
async def get_availability(room_id: str, start: str, end: str, user=Depends(get_current_user)):
    docs = await db.availability.find(
        {"user_id": user["user_id"], "room_id": room_id,
         "date": {"$gte": start, "$lte": end}}, {"_id": 0}).sort("date", 1).to_list(1000)
    return {"availability": docs}


@api_router.post("/rooms/{room_id}/availability")
async def set_availability(room_id: str, payload: AvailabilitySetIn, user=Depends(get_current_user)):
    room = await db.rooms.find_one({"id": room_id, "user_id": user["user_id"]}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Chambre introuvable")
    try:
        d = datetime.fromisoformat(payload.date_from).date()
        end = datetime.fromisoformat(payload.date_to).date()
    except Exception:
        raise HTTPException(status_code=400, detail="Dates invalides (YYYY-MM-DD)")
    n = 0
    while d <= end and n < 800:
        ds = d.isoformat()
        await db.availability.update_one(
            {"user_id": user["user_id"], "room_id": room_id, "date": ds},
            {"$set": {"user_id": user["user_id"], "room_id": room_id, "date": ds,
                      "is_available": payload.is_available, "closed": payload.closed,
                      "min_stay": payload.min_stay}},
            upsert=True)
        d += timedelta(days=1); n += 1
    # Blocage/déblocage manuel → pousser la disponibilité (+ min stay) vers Channex
    await enqueue_channex_availability(user["user_id"], room["property_id"], payload.date_from, payload.date_to)
    if payload.min_stay is not None:
        await enqueue_channex_ari(user["user_id"], room["property_id"], payload.date_from, payload.date_to, avail=False)
    return {"ok": True, "days": n}


@api_router.get("/availability/blocked")
async def availability_blocked(start: str, end: str, user=Depends(get_current_user)):
    """Dates bloquées MANUELLEMENT (closed=true, hors blocages auto de réservations)
    agrégées par logement, pour l'affichage dans le Planning. Retourne {blocks: {property_id: [dates]}}."""
    uid = user["user_id"]
    rooms = await db.rooms.find({"user_id": uid}, {"_id": 0, "id": 1, "property_id": 1}).to_list(1000)
    if not rooms:
        return {"blocks": {}}
    room_to_prop = {r["id"]: r["property_id"] for r in rooms}
    docs = await db.availability.find(
        {"user_id": uid, "room_id": {"$in": list(room_to_prop.keys())},
         "date": {"$gte": start, "$lte": end}, "closed": True},
        {"_id": 0, "room_id": 1, "date": 1, "auto_booking": 1}).to_list(20000)
    blocks: dict = {}
    for d in docs:
        if d.get("auto_booking"):
            continue  # blocage lié à une réservation (déjà affiché comme barre)
        pid = room_to_prop.get(d["room_id"])
        if not pid:
            continue
        blocks.setdefault(pid, set()).add(d["date"])
    return {"blocks": {k: sorted(v) for k, v in blocks.items()}}

