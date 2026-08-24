# ruff: noqa: F403, F405
from core import *  # noqa: F401


@api_router.get("/staff")
async def list_staff(user=Depends(get_current_user)):
    return await db.staff.find({"user_id": user["user_id"]}, {"_id": 0}).sort("name", 1).to_list(500)


@api_router.post("/staff")
async def create_staff(payload: StaffIn, user=Depends(get_current_user)):
    doc = payload.dict()
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    await db.staff.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/staff/{staff_id}")
async def update_staff(staff_id: str, payload: StaffIn, user=Depends(get_current_user)):
    res = await db.staff.update_one(
        {"id": staff_id, "user_id": user["user_id"]}, {"$set": payload.dict()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Intervenant introuvable")
    return await db.staff.find_one({"id": staff_id}, {"_id": 0})


@api_router.delete("/staff/{staff_id}")
async def delete_staff(staff_id: str, user=Depends(get_current_user)):
    await db.staff.delete_one({"id": staff_id, "user_id": user["user_id"]})
    return {"ok": True}


@api_router.get("/members")
async def list_members(user=Depends(get_current_user)):
    return await db.members.find({"user_id": user["user_id"]}, {"_id": 0}).sort("first_name", 1).to_list(500)


@api_router.post("/members")
async def create_member(payload: MemberIn, user=Depends(get_current_user)):
    doc = payload.dict()
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["email_normalized"] = norm_email(doc.get("email", ""))
    doc["invite_status"] = "none"  # none | pending | active
    doc["created_at"] = now_utc().isoformat()
    await db.members.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/members/{member_id}")
async def get_member(member_id: str, user=Depends(get_current_user)):
    m = await db.members.find_one(
        {"id": member_id, "user_id": user["user_id"]},
        {"_id": 0, "password_hash": 0, "invite_token_hash": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return m


@api_router.put("/members/{member_id}")
async def update_member(member_id: str, payload: MemberIn, user=Depends(get_current_user)):
    data = payload.dict()
    data["email_normalized"] = norm_email(data.get("email", ""))
    res = await db.members.update_one(
        {"id": member_id, "user_id": user["user_id"]}, {"$set": data})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return await db.members.find_one(
        {"id": member_id}, {"_id": 0, "password_hash": 0, "invite_token_hash": 0})


@api_router.delete("/members/{member_id}")
async def delete_member(member_id: str, user=Depends(get_current_user)):
    await db.members.delete_one({"id": member_id, "user_id": user["user_id"]})
    await db.user_sessions.delete_many({"member_id": member_id})
    return {"ok": True}


@api_router.post("/members/{member_id}/invite")
async def invite_member(member_id: str, payload: InviteIn, user=Depends(get_current_user)):
    m = await db.members.find_one({"id": member_id, "user_id": user["user_id"]}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    email = norm_email(m.get("email", ""))
    if not email:
        raise HTTPException(status_code=400, detail="Renseignez d'abord l'email de l'utilisateur.")
    raw_token = secrets.token_urlsafe(32)
    await db.members.update_one(
        {"id": member_id, "user_id": user["user_id"]},
        {"$set": {
            "invite_token_hash": hash_token(raw_token),
            "invite_expires_at": (now_utc() + timedelta(days=7)).isoformat(),
            "invite_status": "pending",
            "invited_at": now_utc().isoformat(),
        }})
    origin = payload.origin_url.rstrip("/")
    link = f"{origin}/accept-invite?token={raw_token}"
    name = f'{m.get("first_name", "")} {m.get("last_name", "")}'.strip()
    subject, html = build_invite_email(member_name=name, invite_link=link)
    try:
        await send_email(to=m["email"], subject=subject, html=html)
    except Exception as e:
        logger.error("Invite email failed: %s", e)
        raise HTTPException(status_code=502, detail="Échec de l'envoi de l'email d'invitation")
    return {"ok": True, "email": m["email"]}

