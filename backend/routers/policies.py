# ruff: noqa: F403, F405
from core import *  # noqa: F401


@api_router.get("/booking-policies")
async def list_booking_policies(user=Depends(get_current_user)):
    docs = await db.booking_policies.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"policies": docs}


@api_router.post("/booking-policies")
async def create_booking_policy(payload: BookingPolicyIn, user=Depends(get_current_user)):
    doc = _clean_policy(payload)
    doc.update({"id": str(uuid.uuid4()), "user_id": user["user_id"], "created_at": now_utc().isoformat()})
    await db.booking_policies.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/booking-policies/{policy_id}")
async def update_booking_policy(policy_id: str, payload: BookingPolicyIn, user=Depends(get_current_user)):
    existing = await db.booking_policies.find_one({"id": policy_id, "user_id": user["user_id"]}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Politique introuvable")
    doc = _clean_policy(payload)
    await db.booking_policies.update_one({"id": policy_id}, {"$set": doc})
    return {**existing, **doc}


@api_router.delete("/booking-policies/{policy_id}")
async def delete_booking_policy(policy_id: str, user=Depends(get_current_user)):
    res = await db.booking_policies.delete_one({"id": policy_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Politique introuvable")
    return {"ok": True}

