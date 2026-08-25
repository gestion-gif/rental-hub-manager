# ruff: noqa: F403, F405
from core import *  # noqa: F401


@api_router.post("/channel/connect")
async def channel_connect(payload: ChannelConnectIn, user=Depends(get_current_user)):
    key = payload.api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="Clé API requise")
    adapter = LodgifyAdapter(key)
    async with httpx.AsyncClient(timeout=30) as http:
        count = await adapter.validate(http)
    await db.channel_settings.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "user_id": user["user_id"],
            "provider": payload.provider,
            "api_key": key,
            "properties_count": count,
            "connected_at": now_utc().isoformat(),
        }},
        upsert=True,
    )
    return {"ok": True, "provider": payload.provider, "properties_count": count}


@api_router.get("/channel/status")
async def channel_status(user=Depends(get_current_user)):
    doc = await db.channel_settings.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not doc:
        return {"connected": False}
    mapped = await db.properties.count_documents(
        {"user_id": user["user_id"], "lodgify_id": {"$nin": [None, ""]}})
    return {
        "connected": True,
        "provider": doc.get("provider", "lodgify"),
        "properties_count": doc.get("properties_count", 0),
        "mapped_count": mapped,
        "connected_at": doc.get("connected_at"),
        "last_sync": doc.get("last_sync"),
        "sync_interval_min": int(doc.get("sync_interval_min") or 30),
        "deposit_reminder_days": int(doc.get("deposit_reminder_days") or 2),
    }


@api_router.patch("/channel/sync-interval")
async def set_sync_interval(payload: SyncIntervalIn, user=Depends(get_current_user)):
    # Bornes de sécurité : entre 5 min et 24 h
    minutes = max(5, min(1440, int(payload.minutes or 30)))
    await db.channel_settings.update_one(
        {"user_id": user["user_id"]}, {"$set": {"sync_interval_min": minutes}})
    return {"sync_interval_min": minutes}


@api_router.patch("/channel/reminder-days")
async def set_reminder_days(payload: ReminderDaysIn, user=Depends(get_current_user)):
    # Nombre de jours avant l'arrivée pour la relance caution (0..14)
    days = max(0, min(14, int(payload.days if payload.days is not None else 2)))
    await db.channel_settings.update_one(
        {"user_id": user["user_id"]}, {"$set": {"deposit_reminder_days": days}})
    return {"deposit_reminder_days": days}


@api_router.post("/channel/disconnect")
async def channel_disconnect(user=Depends(get_current_user)):
    await db.channel_settings.delete_one({"user_id": user["user_id"]})
    return {"ok": True}


@api_router.get("/channel/remote-properties")
async def channel_remote_properties(user=Depends(get_current_user)):
    adapter, _ = await get_channel_adapter(user["user_id"])
    if not adapter:
        raise HTTPException(status_code=400, detail="Channel manager non connecté")
    async with httpx.AsyncClient(timeout=40) as http:
        lps = await adapter.list_properties(http)
    existing = {p.get("lodgify_id") for p in await db.properties.find(
        {"user_id": user["user_id"]}, {"lodgify_id": 1}).to_list(2000)}
    return [{
        "id": str(lp.get("id")),
        "name": lp.get("name") or lp.get("internal_name") or f"Logement {lp.get('id')}",
        "city": lp.get("city") or "",
        "imported": str(lp.get("id")) in existing,
    } for lp in lps]


@api_router.post("/channel/import-properties")
async def channel_import_properties(user=Depends(get_current_user)):
    adapter, _ = await get_channel_adapter(user["user_id"])
    if not adapter:
        raise HTTPException(status_code=400, detail="Channel manager non connecté")
    async with httpx.AsyncClient(timeout=40) as http:
        lps = await adapter.list_properties(http)
    imported = 0
    for lp in lps:
        lid = str(lp.get("id"))
        exists = await db.properties.find_one({"user_id": user["user_id"], "lodgify_id": lid})
        if exists:
            continue
        doc = map_lodgify_property(lp)
        doc["id"] = str(uuid.uuid4())
        doc["user_id"] = user["user_id"]
        doc["created_at"] = now_utc().isoformat()
        await db.properties.insert_one(doc)
        imported += 1
    return {"imported": imported, "total": len(lps)}


@api_router.post("/channel/import-rates")
async def channel_import_rates(user=Depends(get_current_user)):
    """Importe les tarifs Lodgify (calendrier des prix) : prix par défaut → base_price,
    prix datés différents → saisons (plages consécutives au même prix)."""
    uid = user["user_id"]
    adapter, _ = await get_channel_adapter(uid)
    if not adapter:
        raise HTTPException(status_code=400, detail="Channel manager non connecté")
    props = await db.properties.find(
        {"user_id": uid, "lodgify_id": {"$nin": [None, ""]}}, {"_id": 0, "id": 1, "name": 1, "lodgify_id": 1}).to_list(500)
    start = date.today().isoformat()
    end = (date.today() + timedelta(days=365)).isoformat()
    updated = 0
    results = []
    async with httpx.AsyncClient(timeout=60) as http:
        for p in props:
            try:
                detail = await adapter.get_property(http, p["lodgify_id"])
                rooms = (detail or {}).get("rooms") or []
                if not rooms:
                    results.append({"property": p["name"], "ok": False, "error": "Aucun type d'hébergement Lodgify"})
                    continue
                items = await adapter.rates_calendar(http, p["lodgify_id"], rooms[0].get("id"), start, end)
                base = 0.0
                daily = {}
                for it in items:
                    prices = it.get("prices") or []
                    if not prices:
                        continue
                    val = float(prices[0].get("price_per_day") or 0)
                    if it.get("is_default"):
                        base = val
                    elif it.get("date") and val > 0:
                        daily[it["date"]] = val
                if base <= 0 and daily:
                    base = min(daily.values())
                if base <= 0:
                    results.append({"property": p["name"], "ok": False, "error": "Aucun tarif trouvé"})
                    continue
                # Plages consécutives au même prix (différent du prix de base) → saisons
                seasons = []
                run_start = run_end = run_price = None
                for d in sorted(daily):
                    v = daily[d]
                    if v == base:
                        v = None  # même prix que la base → pas une saison
                    if v is not None and run_price == v and run_end and \
                       (date.fromisoformat(d) - date.fromisoformat(run_end)).days == 1:
                        run_end = d
                        continue
                    if run_price is not None:
                        seasons.append({"id": str(uuid.uuid4()), "name": f"Tarif Lodgify {run_price:.0f} €",
                                        "start_date": run_start, "end_date": run_end, "price": run_price})
                    run_start = run_end = d if v is not None else None
                    run_price = v
                if run_price is not None:
                    seasons.append({"id": str(uuid.uuid4()), "name": f"Tarif Lodgify {run_price:.0f} €",
                                    "start_date": run_start, "end_date": run_end, "price": run_price})
                await db.properties.update_one(
                    {"id": p["id"], "user_id": uid},
                    {"$set": {"base_price": base, "seasons": seasons[:120]}})
                updated += 1
                results.append({"property": p["name"], "ok": True, "base_price": base, "seasons": len(seasons)})
            except HTTPException as e:
                results.append({"property": p["name"], "ok": False, "error": str(e.detail)})
            except Exception as e:
                results.append({"property": p["name"], "ok": False, "error": str(e)[:150]})
            await asyncio.sleep(0.4)  # rate limit Lodgify
    return {"ok": True, "updated": updated, "total": len(props), "results": results}


@api_router.post("/channel/sync")
async def channel_sync(user=Depends(get_current_user)):
    return await run_channel_sync(user["user_id"])

