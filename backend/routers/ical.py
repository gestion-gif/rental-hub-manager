# ruff: noqa: F403, F405
from core import *  # noqa: F401


@api_router.post("/properties/{property_id}/sync")
async def sync_ical(property_id: str, user=Depends(get_current_user)):
    res = await run_ical_sync(user["user_id"], property_id)
    if res is None:
        raise HTTPException(status_code=404, detail="Property not found")
    return res


@api_router.put("/properties/{property_id}/ical-frequency")
async def set_ical_frequency(property_id: str, payload: IcalFrequencyIn, user=Depends(get_current_user)):
    freq = payload.frequency if payload.frequency in _FREQ_SECONDS else "daily"
    res = await db.properties.update_one(
        {"id": property_id, "user_id": user["user_id"], **_prop_scope(user)},
        {"$set": {"ical_sync_frequency": freq}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Property not found")
    return {"frequency": freq}


@api_router.put("/properties/{property_id}/ical-links")
async def set_ical_links(property_id: str, payload: IcalLinksIn, user=Depends(get_current_user)):
    """Remplace la liste des liens iCal importés pour un logement."""
    links = [{"platform": (l.platform or "Autre").strip(), "url": (l.url or "").strip()}
             for l in payload.links if (l.url or "").strip()]
    res = await db.properties.update_one(
        {"id": property_id, "user_id": user["user_id"], **_prop_scope(user)},
        {"$set": {"ical_links": links}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Property not found")
    return {"ical_links": links}


@api_router.get("/properties/{property_id}/ical-export")
async def get_ical_export(property_id: str, user=Depends(get_current_user)):
    """Renvoie le token/chemin du flux .ics public à partager avec les plateformes."""
    prop = await db.properties.find_one(
        {"id": property_id, "user_id": user["user_id"], **_prop_scope(user)}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    token = prop.get("ical_export_token")
    if not token:
        token = uuid.uuid4().hex
        await db.properties.update_one(
            {"id": property_id, "user_id": user["user_id"]},
            {"$set": {"ical_export_token": token}})
    return {"token": token, "path": f"/api/ical/{property_id}/{token}.ics"}


@api_router.get("/ical/{property_id}/{token}.ics")
async def public_ical_feed(property_id: str, token: str):
    """Flux .ics public (sans auth) pour synchroniser la disponibilité vers Airbnb/Booking."""
    prop = await db.properties.find_one(
        {"id": property_id, "ical_export_token": token}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Flux introuvable")
    reservations = await db.reservations.find(
        {"property_id": property_id, "status": {"$ne": "annulee"}},
        {"_id": 0, "id": 1, "check_in": 1, "check_out": 1, "ical_uid": 1}).to_list(5000)
    body = _build_ics(prop, reservations)
    from fastapi.responses import Response
    return Response(content=body, media_type="text/calendar; charset=utf-8")

