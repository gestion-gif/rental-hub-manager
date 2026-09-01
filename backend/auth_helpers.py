"""Authentification & autorisations : session/API key → utilisateur, verrou billing, permissions."""
import asyncio
from hashlib import sha256
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import HTTPException, Request, Header

from infra import db
from helpers import now_utc

_BILLING_OPEN_PREFIXES = ("/api/auth", "/api/billing", "/api/privacy", "/api/public", "/api/assets")


async def _billing_gate(request, user):
    """Verrouille l'API (402) quand l'essai est terminé sans abonnement actif.
    Les comptes historiques (sans champ billing) et exemptés passent toujours."""
    try:
        path = request.url.path if request is not None else ""
    except Exception:
        path = ""
    if path.startswith(_BILLING_OPEN_PREFIXES):
        return
    b = user.get("billing")
    if b is None and user.get("role") == "member":
        owner = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "billing": 1})
        b = (owner or {}).get("billing")
    if not b or b.get("exempt"):
        return
    if b.get("status") in ("active", "trialing"):
        return
    te = b.get("trial_ends_at") or ""
    if te and str(te) > now_utc().isoformat():
        return
    raise HTTPException(
        status_code=402,
        detail="Votre essai gratuit est terminé. Choisissez une formule pour continuer à utiliser Casanéo.")


async def get_current_user(request: Request, authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    if token.startswith("csk_"):
        # Clé API permanente (accès externe, ex. version web PC)
        rec = await db.api_keys.find_one(
            {"key_hash": sha256(token.encode()).hexdigest(), "revoked_at": None}, {"_id": 0})
        if not rec:
            raise HTTPException(status_code=401, detail="Invalid API key")
        user = await db.users.find_one({"user_id": rec["user_id"]}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        asyncio.ensure_future(db.api_keys.update_one(
            {"id": rec["id"]}, {"$set": {"last_used_at": now_utc().isoformat()}}))
        user["role"] = "owner"
        user["allowed_property_ids"] = None
        user["auth_type"] = "api_key"
        await _billing_gate(request, user)
        return user
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = session.get("expires_at")
    if isinstance(expires_at, datetime):
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < now_utc():
            raise HTTPException(status_code=401, detail="Session expired")
    if session.get("kind") == "member":
        member = await db.members.find_one({"id": session.get("member_id")}, {"_id": 0})
        if not member or member.get("active") is False:
            raise HTTPException(status_code=401, detail="Member not found")
        name = f'{member.get("first_name", "")} {member.get("last_name", "")}'.strip()
        mrole = member.get("role", "member")
        # Un administrateur voit tout le compte parrain ; sinon accès limité aux logements attribués
        allowed = None if mrole == "admin" else (member.get("property_ids") or [])
        muser = {
            "user_id": member["user_id"],  # data owner (the account that owns the properties)
            "email": member.get("email", ""),
            "name": name or member.get("email", ""),
            "role": "member",
            "member_role": mrole,
            "member_id": member["id"],
            "permissions": member.get("permissions", []),
            "allowed_property_ids": allowed,
        }
        await _billing_gate(request, muser)
        return muser
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    user["role"] = "owner"
    user["allowed_property_ids"] = None  # None => all properties
    await _billing_gate(request, user)
    return user


def new_trial_billing() -> dict:
    """Billing initial d'un nouveau compte : essai 14 jours sans carte."""
    return {
        "plan": None,
        "status": "trial",
        "trial_ends_at": (now_utc() + timedelta(days=14)).isoformat(),
        "exempt": False,
        "stripe_customer_id": None,
        "stripe_subscription_id": None,
    }


def _prop_scope(user, field="id"):
    """Return a Mongo clause fragment restricting to the user's allowed properties.
    Owners (allowed_property_ids is None) get no restriction (empty dict)."""
    ids = user.get("allowed_property_ids")
    if ids is None:
        return {}
    return {field: {"$in": ids}}


def _can(user, perm: str) -> bool:
    """Owners can do everything; members are gated by their granted permissions."""
    if user.get("role") != "member":
        return True
    return perm in (user.get("permissions") or [])


_NO_INBOX_ROLES = {"cleaning", "intervenant", "owner"}


def _can_inbox(user) -> bool:
    if user.get("role") != "member":
        return True
    return user.get("member_role") not in _NO_INBOX_ROLES
