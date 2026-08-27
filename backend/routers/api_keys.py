# ruff: noqa: F403, F405
from core import *  # noqa: F401


class ApiKeyIn(BaseModel):
    label: str = ""


def _assert_can_manage_keys(user):
    if user.get("role") != "owner" or user.get("auth_type") == "api_key":
        raise HTTPException(
            status_code=403,
            detail="Gestion des clés API réservée au compte principal (connexion Google)")


@api_router.get("/api-keys")
async def list_api_keys(user=Depends(get_current_user)):
    _assert_can_manage_keys(user)
    items = await db.api_keys.find(
        {"user_id": user["user_id"], "revoked_at": None},
        {"_id": 0, "key_hash": 0}).sort("created_at", -1).to_list(50)
    return items


@api_router.post("/api-keys")
async def create_api_key(payload: ApiKeyIn, user=Depends(get_current_user)):
    """Génère une clé API permanente (affichée UNE SEULE FOIS)."""
    _assert_can_manage_keys(user)
    count = await db.api_keys.count_documents(
        {"user_id": user["user_id"], "revoked_at": None})
    if count >= 10:
        raise HTTPException(status_code=400, detail="Limite de 10 clés actives atteinte")
    raw = f"csk_{secrets.token_hex(32)}"
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "label": (payload.label or "").strip() or "Clé API",
        "key_hash": sha256(raw.encode()).hexdigest(),
        "key_prefix": raw[:9],
        "key_last4": raw[-4:],
        "created_at": now_utc().isoformat(),
        "last_used_at": None,
        "revoked_at": None,
    }
    await db.api_keys.insert_one(doc)
    return {
        "id": doc["id"], "label": doc["label"], "key": raw,
        "key_prefix": doc["key_prefix"], "key_last4": doc["key_last4"],
        "created_at": doc["created_at"],
        "warning": "Copiez cette clé maintenant : elle ne sera plus jamais affichée.",
    }


@api_router.delete("/api-keys/{key_id}")
async def revoke_api_key(key_id: str, user=Depends(get_current_user)):
    _assert_can_manage_keys(user)
    res = await db.api_keys.update_one(
        {"id": key_id, "user_id": user["user_id"], "revoked_at": None},
        {"$set": {"revoked_at": now_utc().isoformat()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Clé introuvable")
    return {"ok": True}
