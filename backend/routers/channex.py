# ruff: noqa: F403, F405
from core import *  # noqa: F401


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

