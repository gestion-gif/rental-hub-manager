# ruff: noqa: F403, F405
from core import *  # noqa: F401
from core import _date_ranges, process_channex_bookings  # noqa: F401


class WebhookRegisterIn(BaseModel):
    callback_url: str


@api_router.post("/channex/webhook")
async def channex_webhook(request: Request):
    """Point d'entrée public appelé par Channex à chaque réservation. Déclenche le
    traitement immédiat du feed pour l'utilisateur concerné. Répond 200 rapidement."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else body
    cx_pid = (payload or {}).get("property_id") or ((payload or {}).get("data") or {}).get("property_id")
    if cx_pid:
        prop = await db.properties.find_one({"channex_id": cx_pid}, {"_id": 0, "user_id": 1})
        if prop:
            try:
                await process_channex_bookings(prop["user_id"])
            except Exception:
                logger.exception("channex webhook processing error")
    return {"ok": True}


@api_router.post("/channex/webhook/register")
async def channex_register_webhook(payload: WebhookRegisterIn, user=Depends(get_current_user)):
    adapter, _ = await get_channex_adapter(user["user_id"])
    if not adapter:
        raise HTTPException(status_code=400, detail="Channex non connecté")
    url = (payload.callback_url or "").rstrip("/")
    if not url.startswith("http"):
        raise HTTPException(status_code=400, detail="URL de rappel invalide")
    async with httpx.AsyncClient(timeout=40) as http:
        try:
            existing = await adapter.list_webhooks(http)
        except Exception:
            existing = []
        for w in existing:
            if ((w.get("attributes") or {}).get("callback_url") or "").rstrip("/") == url:
                await db.channex_settings.update_one(
                    {"user_id": user["user_id"]}, {"$set": {"webhook_id": w.get("id"), "webhook_url": url}})
                return {"ok": True, "webhook_id": w.get("id"), "already": True}
        res = await adapter.create_webhook(http, url)
    wid = ((res or {}).get("data") or {}).get("id")
    await db.channex_settings.update_one(
        {"user_id": user["user_id"]}, {"$set": {"webhook_id": wid, "webhook_url": url}})
    await _sync_log(user["user_id"], "webhook_register", "success", url)
    return {"ok": True, "webhook_id": wid}


@api_router.post("/channex/bookings/sync")
async def channex_bookings_sync(user=Depends(get_current_user)):
    """Récupère manuellement les réservations Channex non traitées (feed) et les acquitte."""
    r = await process_channex_bookings(user["user_id"])
    return {"ok": True, **r}


@api_router.post("/channex/connect")
async def channex_connect(payload: ChannexConnectIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    key = (payload.api_key or "").strip()
    env = (payload.environment or "staging").lower()
    if env not in ("staging", "production"):
        env = "staging"
    if not key:
        raise HTTPException(status_code=400, detail="Clé API Channex requise")
    adapter = ChannexAdapter(key, env)
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            count = await adapter.validate(http)
    except HTTPException as e:
        await _sync_log(uid, "connect", "error", str(e.detail))
        raise
    await db.channex_settings.update_one(
        {"user_id": uid},
        {"$set": {
            "user_id": uid, "provider": "channex", "api_key": key,
            "environment": env, "properties_count": count,
            "connected_at": now_utc().isoformat(),
        }},
        upsert=True,
    )
    await _sync_log(uid, "connect", "success", f"{count} logement(s) — {env}")
    return {"ok": True, "environment": env, "properties_count": count}


@api_router.get("/channex/status")
async def channex_status(user=Depends(get_current_user)):
    doc = await db.channex_settings.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not doc or not doc.get("api_key"):
        return {"connected": False}
    return {
        "connected": True,
        "environment": doc.get("environment", "staging"),
        "properties_count": doc.get("properties_count", 0),
        "connected_at": doc.get("connected_at"),
        "last_read_at": doc.get("last_read_at"),
        "webhook_id": doc.get("webhook_id"),
    }


@api_router.post("/channex/disconnect")
async def channex_disconnect(user=Depends(get_current_user)):
    await db.channex_settings.delete_one({"user_id": user["user_id"]})
    await _sync_log(user["user_id"], "disconnect", "success")
    return {"ok": True}


@api_router.get("/channex/properties")
async def channex_properties(user=Depends(get_current_user)):
    uid = user["user_id"]
    adapter, doc = await get_channex_adapter(uid)
    if not adapter:
        raise HTTPException(status_code=400, detail="Channex non connecté")
    try:
        async with httpx.AsyncClient(timeout=40) as http:
            raw = await adapter.list_properties(http)
    except HTTPException as e:
        await _sync_log(uid, "read_properties", "error", str(e.detail))
        raise
    props = [map_channex_property(p) for p in raw]
    await db.channex_settings.update_one(
        {"user_id": uid},
        {"$set": {"properties_count": len(props), "last_read_at": now_utc().isoformat()}})
    await _sync_log(uid, "read_properties", "success", f"{len(props)} logement(s)")
    return {"properties": props, "count": len(props)}


@api_router.get("/channex/properties/{channex_id}/catalog")
async def channex_catalog(channex_id: str, user=Depends(get_current_user)):
    uid = user["user_id"]
    adapter, doc = await get_channex_adapter(uid)
    if not adapter:
        raise HTTPException(status_code=400, detail="Channex non connecté")
    async with httpx.AsyncClient(timeout=40) as http:
        rooms = await adapter.list_room_types(http, channex_id)
        rates = await adapter.list_rate_plans(http, channex_id)
    await _sync_log(uid, "read_catalog", "success",
                    f"{len(rooms)} chambres, {len(rates)} tarifs")
    return {
        "channex_id": channex_id,
        "rooms": [map_channex_room(r) for r in rooms],
        "rate_plans": [map_channex_rate_plan(rp) for rp in rates],
    }


@api_router.get("/channex/sync-logs")
async def channex_sync_logs(user=Depends(get_current_user)):
    logs = await db.sync_logs.find(
        {"user_id": user["user_id"], "provider": "channex"}, {"_id": 0}
    ).sort("date", -1).to_list(50)
    return {"logs": logs}


class FullSyncIn(BaseModel):
    property_id: Optional[str] = None
    days: int = 500


@api_router.post("/channex/full-sync")
async def channex_full_sync(payload: FullSyncIn = Body(default=FullSyncIn()),
                            user=Depends(get_current_user)):
    """Synchronisation complète Channex (exigence certification) : pour chaque logement lié,
    2 appels — disponibilité (toutes chambres, `days` jours) + tarifs/restrictions (tous les
    rate plans). Données réalistes issues des saisons (prix) et des réservations (dispo)."""
    uid = user["user_id"]
    adapter, doc = await get_channex_adapter(uid)
    if not adapter:
        raise HTTPException(status_code=400, detail="Channex non connecté")
    days = max(1, min(int(payload.days or 500), 730))
    q = {"user_id": uid, "channex_id": {"$nin": [None, ""]}}
    if payload.property_id:
        q["id"] = payload.property_id
    props = await db.properties.find(q, {"_id": 0}).to_list(200)
    if not props:
        raise HTTPException(status_code=400, detail="Aucun logement lié à Channex. Importez d'abord vos logements.")
    today = now_utc().date()
    end = today + timedelta(days=days - 1)
    end_excl = (end + timedelta(days=1)).isoformat()
    results = []
    async with httpx.AsyncClient(timeout=120) as http:
        for prop in props:
            cx_pid = prop["channex_id"]
            rooms = await db.rooms.find(
                {"user_id": uid, "property_id": prop["id"], "channex_room_type_id": {"$nin": [None, ""]}},
                {"_id": 0}).to_list(100)
            rate_plans = await db.rate_plans.find(
                {"user_id": uid, "property_id": prop["id"], "channex_rate_plan_id": {"$nin": [None, ""]}},
                {"_id": 0}).to_list(100)
            booked = await _booked_dates(uid, prop["id"], today.isoformat(), end_excl)

            # 1 appel disponibilité : toutes les chambres (dispo = nb d'unités - réservé)
            avail_values = []
            for room in rooms:
                cap = int(room.get("count_of_rooms") or 1)
                cx_rt = room["channex_room_type_id"]
                avail_values += _date_ranges(
                    today, end,
                    lambda d: max(0, cap - (1 if d.isoformat() in booked else 0)),
                    lambda v, rt=cx_rt: {"property_id": cx_pid, "room_type_id": rt, "availability": v},
                )
            # 1 appel tarifs+restrictions : tous les rate plans (prix saison → centimes, min stay)
            rest_values = []
            for rpn in rate_plans:
                cx_rp = rpn["channex_rate_plan_id"]
                ms = int(rpn.get("min_stay") or 1)
                rest_values += _date_ranges(
                    today, end,
                    lambda d: f"{_price_for_day(prop, d.isoformat()):.2f}",
                    lambda v, rp=cx_rp, m=ms: {
                        "property_id": cx_pid, "rate_plan_id": rp, "rate": v,
                        "min_stay_arrival": m, "min_stay_through": m,
                        "max_stay": 0,
                        "closed_to_arrival": False,
                        "closed_to_departure": False,
                        "stop_sell": False,
                    },
                )

            task_ids = []
            if avail_values:
                task_ids += await adapter.push_availability(http, avail_values)
            if rest_values:
                task_ids += await adapter.push_restrictions(http, rest_values)
            results.append({
                "property": prop.get("name"), "channex_id": cx_pid,
                "rooms": len(rooms), "rate_plans": len(rate_plans),
                "availability_ranges": len(avail_values), "rate_ranges": len(rest_values),
                "task_ids": task_ids,
            })
            await _sync_log(uid, "full_sync", "success",
                            f"{prop.get('name')}: {len(avail_values)} plages dispo, "
                            f"{len(rest_values)} plages tarifs — tasks={task_ids}")
            await asyncio.sleep(1)  # espacer les logements (rate limit)
    return {"ok": True, "environment": doc.get("environment"), "days": days,
            "properties": len(props), "results": results}


@api_router.post("/channex/import")
async def channex_import(user=Depends(get_current_user)):
    """Importe les logements Channex → Property + Room + RatePlan (idempotent par channex_id).
    Conserve les IDs Lodgify existants (mapping provider-neutre)."""
    uid = user["user_id"]
    adapter, doc = await get_channex_adapter(uid)
    if not adapter:
        raise HTTPException(status_code=400, detail="Channex non connecté")
    imported_props = imported_rooms = imported_rates = 0
    async with httpx.AsyncClient(timeout=60) as http:
        raw_props = await adapter.list_properties(http)
        for rp in raw_props:
            cp = map_channex_property(rp)
            cid = cp["channex_id"]
            existing = await db.properties.find_one({"user_id": uid, "channex_id": cid}, {"_id": 0})
            if existing:
                pid = existing["id"]
            else:
                pid = str(uuid.uuid4())
                await db.properties.insert_one({
                    "id": pid, "user_id": uid, "name": cp["title"],
                    "channex_id": cid, "location": cp.get("city") or "",
                    "base_price": 0, "capacity": 2, "bedrooms": 1,
                    "seasons": [], "ical_links": [],
                    "created_at": now_utc().isoformat(),
                })
                imported_props += 1
            rooms = await adapter.list_room_types(http, cid)
            for rr in rooms:
                cr = map_channex_room(rr)
                rtid = cr["channex_room_type_id"]
                ex_room = await db.rooms.find_one({"user_id": uid, "channex_room_type_id": rtid}, {"_id": 0})
                if ex_room:
                    room_id = ex_room["id"]
                else:
                    room_id = str(uuid.uuid4())
                    await db.rooms.insert_one({
                        "id": room_id, "user_id": uid, "property_id": pid,
                        "name": cr["title"], "channex_room_type_id": rtid,
                        "max_guests": cr.get("occ_adults") or 2,
                        "count_of_rooms": cr.get("count_of_rooms") or 1,
                        "created_at": now_utc().isoformat(),
                    })
                    imported_rooms += 1
            rates = await adapter.list_rate_plans(http, cid)
            today = now_utc().date()
            try:
                rate_map = await adapter.list_rates(
                    http, cid, today.isoformat(), (today + timedelta(days=60)).isoformat())
            except Exception:
                rate_map = {}
            prop_price = 0.0
            for rpn in rates:
                crp = map_channex_rate_plan(rpn)
                rpid = crp["channex_rate_plan_id"]
                # first upcoming positive nightly rate = representative base price
                price = 0.0
                for _d in sorted(rate_map.get(rpid) or {}):
                    try:
                        v = float((rate_map[rpid][_d] or {}).get("rate") or 0)
                    except Exception:
                        v = 0.0
                    if v > 0:
                        price = v
                        break
                prop_price = max(prop_price, price)
                ex_rate = await db.rate_plans.find_one({"user_id": uid, "channex_rate_plan_id": rpid}, {"_id": 0})
                if not ex_rate:
                    linked = await db.rooms.find_one(
                        {"user_id": uid, "channex_room_type_id": crp.get("channex_room_type_id")}, {"_id": 0, "id": 1})
                    await db.rate_plans.insert_one({
                        "id": str(uuid.uuid4()), "user_id": uid, "property_id": pid,
                        "room_id": (linked or {}).get("id"), "name": crp["title"],
                        "channex_rate_plan_id": rpid, "base_price": price, "min_stay": 1,
                        "closed": False, "created_at": now_utc().isoformat(),
                    })
                    imported_rates += 1
                elif price > 0 and not ex_rate.get("base_price"):
                    await db.rate_plans.update_one(
                        {"user_id": uid, "channex_rate_plan_id": rpid}, {"$set": {"base_price": price}})
            # propagate a base price to the property so the calendar shows a price
            if prop_price > 0:
                cur = await db.properties.find_one({"id": pid, "user_id": uid}, {"_id": 0, "base_price": 1})
                if cur is not None and not cur.get("base_price"):
                    await db.properties.update_one(
                        {"id": pid, "user_id": uid}, {"$set": {"base_price": prop_price}})
    await _sync_log(uid, "import", "success",
                    f"{imported_props} logements, {imported_rooms} chambres, {imported_rates} tarifs")
    return {"ok": True, "imported_properties": imported_props,
            "imported_rooms": imported_rooms, "imported_rate_plans": imported_rates}

