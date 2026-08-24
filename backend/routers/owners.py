# ruff: noqa: F403, F405
from core import *  # noqa: F401


@api_router.get("/owners")
async def list_owners(user=Depends(get_current_user)):
    owners = await db.owners.find({"user_id": user["user_id"]}, {"_id": 0}).sort("name", 1).to_list(500)
    props = await db.properties.find({"user_id": user["user_id"]}, {"_id": 0, "id": 1, "owner_id": 1}).to_list(2000)
    counts = {}
    for p in props:
        oid = p.get("owner_id")
        if oid:
            counts[oid] = counts.get(oid, 0) + 1
    for o in owners:
        o["property_count"] = counts.get(o["id"], 0)
    return owners


@api_router.post("/owners")
async def create_owner(payload: OwnerIn, user=Depends(get_current_user)):
    doc = payload.dict()
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    await db.owners.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/owners/{owner_id}")
async def update_owner(owner_id: str, payload: OwnerIn, user=Depends(get_current_user)):
    res = await db.owners.update_one(
        {"id": owner_id, "user_id": user["user_id"]}, {"$set": payload.dict()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Propriétaire introuvable")
    return await db.owners.find_one({"id": owner_id}, {"_id": 0})


@api_router.delete("/owners/{owner_id}")
async def delete_owner(owner_id: str, user=Depends(get_current_user)):
    await db.owners.delete_one({"id": owner_id, "user_id": user["user_id"]})
    await db.properties.update_many(
        {"user_id": user["user_id"], "owner_id": owner_id}, {"$set": {"owner_id": None}})
    return {"ok": True}


@api_router.post("/owners/{owner_id}/documents")
async def add_owner_document(owner_id: str, body: dict, user=Depends(get_current_user)):
    uid = user["user_id"]
    owner = await db.owners.find_one({"id": owner_id, "user_id": uid}, {"_id": 0})
    if not owner:
        raise HTTPException(status_code=404, detail="Propriétaire introuvable")
    path = (body.get("path") or "").strip()
    if not path:
        raise HTTPException(status_code=400, detail="Fichier manquant")
    doc = {
        "id": str(uuid.uuid4()),
        "name": (body.get("name") or "Document").strip(),
        "path": path,
        "created_at": now_utc().isoformat(),
    }
    docs = (owner.get("documents") or []) + [doc]
    await db.owners.update_one({"id": owner_id, "user_id": uid}, {"$set": {"documents": docs}})
    return await db.owners.find_one({"id": owner_id}, {"_id": 0})


@api_router.delete("/owners/{owner_id}/documents/{doc_id}")
async def delete_owner_document(owner_id: str, doc_id: str, user=Depends(get_current_user)):
    uid = user["user_id"]
    owner = await db.owners.find_one({"id": owner_id, "user_id": uid}, {"_id": 0})
    if not owner:
        raise HTTPException(status_code=404, detail="Propriétaire introuvable")
    docs = [d for d in (owner.get("documents") or []) if d.get("id") != doc_id]
    await db.owners.update_one({"id": owner_id, "user_id": uid}, {"$set": {"documents": docs}})
    return await db.owners.find_one({"id": owner_id}, {"_id": 0})


@api_router.get("/owners/{owner_id}/summary")
async def owner_summary(owner_id: str, user=Depends(get_current_user)):
    uid = user["user_id"]
    owner = await db.owners.find_one({"id": owner_id, "user_id": uid}, {"_id": 0})
    if not owner:
        raise HTTPException(status_code=404, detail="Propriétaire introuvable")
    props = await db.properties.find({"user_id": uid, "owner_id": owner_id}, {"_id": 0}).to_list(500)
    prop_ids = [p["id"] for p in props]
    reservations = []
    if prop_ids:
        reservations = await db.reservations.find(
            {"user_id": uid, "property_id": {"$in": prop_ids}}, {"_id": 0}).to_list(5000)

    def parse(d):
        try:
            return date.fromisoformat(d)
        except Exception:
            return None

    revenue_total = 0.0
    per_month = {}
    nights_total = 0
    prop_name = {p["id"]: p.get("name", "Logement") for p in props}
    pp = {p["id"]: {"id": p["id"], "name": p.get("name", "Logement"), "revenue": 0.0, "nights": 0, "months": {}} for p in props}
    for r in reservations:
        if r.get("status") == "annulee":
            continue
        ci = parse(r.get("check_in"))
        co = parse(r.get("check_out"))
        fin = r.get("finance") or {}
        price = float(fin.get("total") or r.get("total_price", 0) or 0)
        revenue_total += price
        pid = r.get("property_id")
        if ci:
            key = f"{ci.year}-{ci.month:02d}"
            per_month[key] = per_month.get(key, 0) + price
            if pid in pp:
                pp[pid]["months"][key] = pp[pid]["months"].get(key, 0) + price
        if pid in pp:
            pp[pid]["revenue"] += price
        if ci and co and co > ci:
            n = (co - ci).days
            nights_total += n
            if pid in pp:
                pp[pid]["nights"] += n
    months_sorted = sorted(per_month.items())
    per_property = [
        {
            "id": v["id"], "name": v["name"],
            "revenue_total": round(v["revenue"]), "nights_total": v["nights"],
            "per_month": [{"month": k, "revenue": round(rv)} for k, rv in sorted(v["months"].items())],
        }
        for v in pp.values()
    ]
    per_property.sort(key=lambda x: -x["revenue_total"])
    return {
        "owner": owner,
        "properties": props,
        "revenue_total": round(revenue_total),
        "reservations_count": len([r for r in reservations if r.get("status") != "annulee"]),
        "nights_total": nights_total,
        "per_month": [{"month": k, "revenue": round(v)} for k, v in months_sorted],
        "per_property": per_property,
    }

