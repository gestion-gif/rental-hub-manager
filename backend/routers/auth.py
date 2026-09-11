# ruff: noqa: F403, F405
from core import *  # noqa: F401
import os as _os
import base64 as _b64
import time as _time

# --- Sign in with Apple : révocation des tokens (exigence Apple 5.1.1(v)) ---
# Nécessite les secrets APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY_B64 (clé .p8 en base64).
# Sans ces secrets, la connexion Apple fonctionne normalement mais la révocation est ignorée.
_APPLE_CLIENT_ID = (APPLE_AUDIENCES[0] if APPLE_AUDIENCES else "")


def _apple_revocation_config():
    team = _os.environ.get("APPLE_TEAM_ID", "").strip()
    kid = _os.environ.get("APPLE_KEY_ID", "").strip()
    key_b64 = _os.environ.get("APPLE_PRIVATE_KEY_B64", "").strip()
    if not (team and kid and key_b64 and _APPLE_CLIENT_ID):
        return None
    try:
        pk = _b64.b64decode(key_b64).decode()
    except Exception:
        return None
    return {"team": team, "kid": kid, "private_key": pk}


def _apple_client_secret(cfg: dict) -> str:
    now = int(_time.time())
    return _jwt.encode(
        {"iss": cfg["team"], "iat": now, "exp": now + 3600,
         "aud": "https://appleid.apple.com", "sub": _APPLE_CLIENT_ID},
        cfg["private_key"], algorithm="ES256", headers={"kid": cfg["kid"]})


async def _apple_exchange_code(code: str) -> Optional[str]:
    """Échange l'authorization code contre un refresh token Apple (best effort)."""
    cfg = _apple_revocation_config()
    if not cfg or not code:
        return None
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            r = await http.post("https://appleid.apple.com/auth/token", data={
                "client_id": _APPLE_CLIENT_ID, "client_secret": _apple_client_secret(cfg),
                "code": code, "grant_type": "authorization_code",
            })
        if r.status_code == 200:
            return r.json().get("refresh_token")
        logger.warning("apple token exchange failed: %s %s", r.status_code, r.text[:200])
    except Exception:
        logger.exception("apple token exchange error")
    return None


async def _apple_revoke_refresh_token(refresh_token: str) -> None:
    """Révoque le refresh token Apple lors de la suppression de compte (best effort)."""
    cfg = _apple_revocation_config()
    if not cfg or not refresh_token:
        return
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            r = await http.post("https://appleid.apple.com/auth/revoke", data={
                "client_id": _APPLE_CLIENT_ID, "client_secret": _apple_client_secret(cfg),
                "token": refresh_token, "token_type_hint": "refresh_token",
            })
        logger.info("apple token revoke: %s", r.status_code)
    except Exception:
        logger.exception("apple token revoke error")


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
    # Stocke le refresh token Apple pour pouvoir le révoquer à la suppression du compte (5.1.1(v))
    if payload.authorization_code:
        rt = await _apple_exchange_code(payload.authorization_code)
        if rt:
            await db.users.update_one({"user_id": user_id}, {"$set": {"apple_refresh_token": rt}})
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
    agency_name: str = ""
    phone: str = ""


async def _notify_partner_signup(doc: dict, payload: "RegisterIn"):
    """Signale l'inscription à la version web casaneo.pro (partenaire).
    Jamais bloquant : toute erreur est ignorée."""
    url = _os.environ.get("PARTNER_SIGNUP_URL", "")
    secret = _os.environ.get("PARTNER_SIGNUP_SECRET", "")
    if not url or not secret:
        return
    try:
        async with httpx.AsyncClient(timeout=8) as http:
            await http.post(url, headers={"X-Partner-Secret": secret}, json={
                "email": doc.get("email", ""),
                "name": doc.get("name", ""),
                "agency_name": (payload.agency_name or "").strip(),
                "phone": (payload.phone or "").strip(),
                "source": "app_mobile",
                "app_user_id": doc.get("user_id", ""),
            })
    except Exception:
        logger.warning("partner signup notify failed for %s", doc.get("user_id"))


@api_router.delete("/auth/account")
async def delete_account(user=Depends(get_current_user)):
    """Suppression de compte in-app (exigence Apple 5.1.1(v)).
    Supprime le compte propriétaire et TOUTES les données associées."""
    if user.get("role") == "member":
        raise HTTPException(status_code=403, detail="Seul le titulaire du compte peut le supprimer")
    if user.get("auth_type") == "api_key":
        raise HTTPException(status_code=403, detail="Suppression impossible via une clé API")
    uid = user["user_id"]
    if uid == "demo_store_review":
        raise HTTPException(status_code=403, detail="Le compte de démonstration ne peut pas être supprimé")
    doc = await db.users.find_one({"user_id": uid}, {"_id": 0, "billing": 1, "apple_refresh_token": 1}) or {}
    # Révoque les tokens Sign in with Apple (exigence Apple 5.1.1(v), best effort)
    if doc.get("apple_refresh_token"):
        await _apple_revoke_refresh_token(doc["apple_refresh_token"])
    # Résilie l'abonnement Stripe s'il existe (best effort)
    try:
        sub_id = (doc.get("billing") or {}).get("stripe_subscription_id")
        if sub_id and STRIPE_API_KEY:
            import stripe as _stripe
            _stripe.api_key = STRIPE_API_KEY
            _stripe.Subscription.cancel(sub_id)
    except Exception:
        logger.exception("stripe cancel on account deletion failed")
    # Supprime toutes les données du tenant dans toutes les collections
    names = await db.list_collection_names()
    for cname in names:
        try:
            await db[cname].delete_many({"user_id": uid})
        except Exception:
            pass
    await db.user_sessions.delete_many({"user_id": uid})
    await db.users.delete_one({"user_id": uid})
    logger.info("account deleted: %s", uid)
    return {"ok": True}


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
    asyncio.create_task(_notify_partner_signup(doc, payload))
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

