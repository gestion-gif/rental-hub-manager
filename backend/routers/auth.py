# ruff: noqa: F403, F405
from core import *  # noqa: F401


@api_router.post("/auth/session")
async def create_session(payload: SessionRequest):
    async with httpx.AsyncClient(timeout=20) as http:
        resp = await http.get(EMERGENT_AUTH_URL, headers={"X-Session-ID": payload.session_id})
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = resp.json()
    email = data.get("email")
    name = data.get("name", "")
    picture = data.get("picture", "")
    session_token = data.get("session_token")

    existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"name": name, "picture": picture}})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "billing": new_trial_billing(),
            "created_at": now_utc().isoformat(),
        })

    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "created_at": now_utc(),
        "expires_at": now_utc() + timedelta(days=7),
    })

    return {
        "session_token": session_token,
        "user": {"user_id": user_id, "email": email, "name": name, "picture": picture},
    }


@api_router.post("/auth/apple")
async def auth_apple(payload: AppleAuthIn):
    """Sign in with Apple : vérifie l'identity token auprès des clés publiques Apple."""
    try:
        signing_key = _apple_jwk_client.get_signing_key_from_jwt(payload.identity_token)
        claims = _jwt.decode(
            payload.identity_token, signing_key.key, algorithms=["RS256"],
            audience=APPLE_AUDIENCES, issuer="https://appleid.apple.com")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Token Apple invalide: {str(e)[:100]}")
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token Apple sans identifiant")
    email = (claims.get("email") or payload.email or "").strip().lower()

    existing = await db.users.find_one({"apple_sub": sub})
    if not existing and email:
        existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
        upd = {"apple_sub": sub}
        if payload.name and not existing.get("name"):
            upd["name"] = payload.name
        if email and not existing.get("email"):
            upd["email"] = email
        await db.users.update_one({"user_id": user_id}, {"$set": upd})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id, "apple_sub": sub, "email": email,
            "name": payload.name or "Utilisateur Apple", "picture": "",
            "billing": new_trial_billing(),
            "created_at": now_utc().isoformat(),
        })

    session_token = secrets.token_urlsafe(32)
    await db.user_sessions.insert_one({
        "session_token": session_token, "user_id": user_id,
        "created_at": now_utc(), "expires_at": now_utc() + timedelta(days=7),
    })
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"session_token": session_token, "user": user}


@api_router.get("/auth/me")
async def get_me(user=Depends(get_current_user)):
    return user


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


@api_router.post("/auth/accept-invite")
async def accept_invite(payload: AcceptInviteIn):
    if len(payload.password or "") < 8:
        raise HTTPException(status_code=422, detail="Le mot de passe doit contenir au moins 8 caractères")
    th = hash_token(payload.token)
    member = await db.members.find_one({"invite_token_hash": th}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=400, detail="Invitation invalide ou expirée")
    exp = member.get("invite_expires_at")
    try:
        if exp and datetime.fromisoformat(exp) < now_utc():
            raise HTTPException(status_code=400, detail="Invitation invalide ou expirée")
    except ValueError:
        pass
    await db.members.update_one(
        {"id": member["id"]},
        {"$set": {
            "password_hash": hash_password(payload.password),
            "password_set_at": now_utc().isoformat(),
            "invite_status": "active",
            "active": True,
        },
         "$unset": {"invite_token_hash": "", "invite_expires_at": ""}})
    member = await db.members.find_one({"id": member["id"]}, {"_id": 0})
    return await _create_member_session(member)


class RegisterIn(BaseModel):
    name: str = ""
    email: str
    password: str


async def _create_owner_session(user_doc: dict) -> dict:
    token = secrets.token_urlsafe(32)
    await db.user_sessions.insert_one({
        "session_token": token, "user_id": user_doc["user_id"],
        "created_at": now_utc(), "expires_at": now_utc() + timedelta(days=7),
    })
    return {
        "session_token": token,
        "user": {
            "user_id": user_doc["user_id"], "email": user_doc.get("email", ""),
            "name": user_doc.get("name", ""), "picture": user_doc.get("picture", ""),
        },
    }


@api_router.post("/auth/register")
async def register(payload: RegisterIn):
    """Inscription autonome d'un compte propriétaire (essai gratuit 14 jours)."""
    email = norm_email(payload.email)
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=400, detail="Adresse e-mail invalide")
    if len(payload.password or "") < 8:
        raise HTTPException(status_code=400, detail="Mot de passe : 8 caractères minimum")
    exists = await db.users.find_one({"email": email}, {"_id": 0, "user_id": 1})
    exists_member = await db.members.find_one({"email_normalized": email}, {"_id": 0, "id": 1})
    if exists or exists_member:
        raise HTTPException(status_code=409, detail="Impossible de créer un compte avec ces identifiants")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    doc = {
        "user_id": user_id, "email": email,
        "name": (payload.name or "").strip() or email.split("@")[0],
        "picture": "", "password_hash": hash_password(payload.password),
        "billing": new_trial_billing(),
        "created_at": now_utc().isoformat(),
    }
    try:
        await db.users.insert_one(doc)
    except Exception:
        raise HTTPException(status_code=409, detail="Impossible de créer un compte avec ces identifiants")
    return await _create_owner_session(doc)


@api_router.post("/auth/login")
async def member_login(payload: LoginIn):
    email = norm_email(payload.email)
    # 1) Compte propriétaire avec mot de passe (inscription autonome)
    owner = await db.users.find_one({"email": email, "password_hash": {"$nin": [None, ""]}}, {"_id": 0})
    if owner and verify_password(payload.password, owner["password_hash"]):
        return await _create_owner_session(owner)
    # 2) Membre d'équipe (invitation)
    email = norm_email(payload.email)
    member = await db.members.find_one(
        {"email_normalized": email, "password_hash": {"$exists": True}}, {"_id": 0})
    stored = member.get("password_hash") if member else None
    if not verify_password(payload.password, stored):
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")
    if member.get("active") is False:
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")
    return await _create_member_session(member)

