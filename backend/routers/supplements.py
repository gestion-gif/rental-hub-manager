# ruff: noqa: F403, F405
from core import *  # noqa: F401


def _shape_supplement(payload: SupplementIn) -> dict:
    d = payload.dict()
    d["name"] = d["name"].strip()
    d["description"] = d["description"].strip()
    d["calc_model"] = d["calc_model"] if d["calc_model"] in ("fixed", "percent") else "fixed"
    d["percent_base"] = d["percent_base"] if d["percent_base"] in ("nights", "total") else "nights"
    d["charge_basis"] = d["charge_basis"] if d["charge_basis"] in ("unique", "per_quantity", "per_guest", "per_room") else "unique"
    d["period"] = d["period"] if d["period"] in ("per_stay", "per_night") else "per_stay"
    d["amount"] = max(0.0, round(float(d["amount"] or 0), 2))
    d["vat_rate"] = max(0.0, min(100.0, float(d["vat_rate"] or 0)))
    d["property_ids"] = [str(p) for p in (d["property_ids"] or [])]
    return d


@api_router.get("/supplements")
async def list_supplements(user=Depends(get_current_user)):
    return await db.supplements.find(
        {"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", 1).to_list(200)


@api_router.post("/supplements")
async def create_supplement(payload: SupplementIn, user=Depends(get_current_user)):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Nom requis")
    doc = _shape_supplement(payload)
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    await db.supplements.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/supplements/{sup_id}")
async def update_supplement(sup_id: str, payload: SupplementIn, user=Depends(get_current_user)):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Nom requis")
    doc = _shape_supplement(payload)
    res = await db.supplements.update_one(
        {"id": sup_id, "user_id": user["user_id"]}, {"$set": doc})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Supplément introuvable")
    return await db.supplements.find_one({"id": sup_id}, {"_id": 0})


@api_router.delete("/supplements/{sup_id}")
async def delete_supplement(sup_id: str, user=Depends(get_current_user)):
    await db.supplements.delete_one({"id": sup_id, "user_id": user["user_id"]})
    return {"ok": True}


@api_router.get("/public/site/{slug}/supplements")
async def public_supplements(slug: str, property_id: str = ""):
    """Suppléments actifs proposés sur le site public (filtrés par logement)."""
    pref = await db.preferences.find_one({"public_site.slug": slug}, {"_id": 0, "user_id": 1})
    if not pref:
        raise HTTPException(status_code=404, detail="Site introuvable")
    sups = await db.supplements.find(
        {"user_id": pref["user_id"], "active": {"$ne": False}}, {"_id": 0}).sort("created_at", 1).to_list(200)
    out = []
    for s in sups:
        pids = s.get("property_ids") or []
        if property_id and pids and property_id not in pids:
            continue
        out.append({k: s.get(k) for k in (
            "id", "name", "description", "photo_path", "calc_model", "amount",
            "percent_base", "charge_basis", "period")})
    return out


@api_router.get("/public/sup-photo/{path:path}")
async def get_supplement_photo(path: str):
    """Photo d'un supplément (publique, chemin non devinable) — servie uniquement si
    enregistrée comme photo d'un supplément existant."""
    sup = await db.supplements.find_one({"photo_path": path}, {"_id": 0, "id": 1})
    if not sup:
        raise HTTPException(status_code=404, detail="Photo introuvable")
    try:
        content, ct = await run_in_threadpool(_get_object, path)
    except Exception:
        raise HTTPException(status_code=404, detail="Photo introuvable")
    return Response(content=content, media_type=ct)
