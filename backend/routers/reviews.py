# ruff: noqa: F403, F405
from core import *  # noqa: F401


@api_router.get("/reviews")
async def list_reviews(property_id: str = "", user=Depends(get_current_user)):
    uid = user["user_id"]
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
    data = payload.dict()
    data["rating"] = max(1, min(5, int(data.get("rating") if data.get("rating") is not None else 5)))
    res = await db.reviews.update_one({"id": review_id, "user_id": uid}, {"$set": data})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Avis introuvable")
    item = await db.reviews.find_one({"id": review_id}, {"_id": 0})
    return item


@api_router.delete("/reviews/{review_id}")
async def delete_review(review_id: str, user=Depends(get_current_user)):
    await db.reviews.delete_one({"id": review_id, "user_id": user["user_id"]})
    return {"ok": True}

