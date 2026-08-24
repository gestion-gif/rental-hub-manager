# ruff: noqa: F403, F405
from core import *  # noqa: F401


@api_router.get("/promotions")
async def list_promotions(user=Depends(get_current_user)):
    return await db.promotions.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)


@api_router.post("/promotions")
async def create_promotion(payload: PromotionIn, user=Depends(get_current_user)):
    doc = _clean_promotion(payload.dict())
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    await db.promotions.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/promotions/{promotion_id}")
async def update_promotion(promotion_id: str, payload: PromotionIn, user=Depends(get_current_user)):
    data = _clean_promotion(payload.dict())
    res = await db.promotions.update_one({"id": promotion_id, "user_id": user["user_id"]}, {"$set": data})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Promotion introuvable")
    return await db.promotions.find_one({"id": promotion_id}, {"_id": 0})


@api_router.delete("/promotions/{promotion_id}")
async def delete_promotion(promotion_id: str, user=Depends(get_current_user)):
    await db.promotions.delete_one({"id": promotion_id, "user_id": user["user_id"]})
    return {"ok": True}

