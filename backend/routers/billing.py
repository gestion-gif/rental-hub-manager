# ruff: noqa: F403, F405
"""Abonnements SaaS Casanéo : Stripe Checkout (mensuel), portail client,
statut & limites par formule. L'essai 14 jours est géré côté app (sans carte)."""
from core import *  # noqa: F401
import stripe as stripe_sdk

PLANS = {
    "starter": {"label": "Starter", "amount": 3900, "property_limit": 3},
    "essentiel": {"label": "Essentiel", "amount": 7900, "property_limit": 10},
    "pro": {"label": "Pro", "amount": 14900, "property_limit": 25},
    "scale": {"label": "Scale", "amount": 24900, "property_limit": 50},
}


def _plans_payload():
    return [
        {"id": pid, "label": p["label"], "price_eur": p["amount"] / 100,
         "property_limit": p["property_limit"]}
        for pid, p in PLANS.items()
    ]


@api_router.get("/billing/plans")
async def billing_plans():
    return {"plans": _plans_payload(), "trial_days": 14}


async def _owner_doc(user) -> dict:
    doc = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    return doc


def _require_owner(user):
    if user.get("role") == "member":
        raise HTTPException(status_code=403, detail="Abonnement géré par le titulaire du compte")


async def _refresh_from_stripe(uid: str, billing: dict) -> dict:
    """Rafraîchit le statut depuis Stripe (abonnement existant ou session en attente)."""
    if not STRIPE_API_KEY:
        return billing
    stripe_sdk.api_key = STRIPE_API_KEY
    changed = {}
    sess_id = billing.get("pending_session_id")
    if sess_id and billing.get("status") not in ("active", "trialing"):
        try:
            sess = stripe_sdk.checkout.Session.retrieve(sess_id, expand=["subscription"])
            if sess.get("client_reference_id") == uid and sess.get("subscription"):
                sub = sess["subscription"]
                changed = {
                    "stripe_customer_id": sess.get("customer"),
                    "stripe_subscription_id": sub["id"],
                    "status": sub["status"],
                    "plan": (sub.get("metadata") or {}).get("plan") or billing.get("plan"),
                    "pending_session_id": None,
                }
        except Exception:
            pass
    elif billing.get("stripe_subscription_id"):
        try:
            sub = stripe_sdk.Subscription.retrieve(billing["stripe_subscription_id"])
            changed = {"status": sub["status"],
                       "plan": (sub.get("metadata") or {}).get("plan") or billing.get("plan")}
        except Exception:
            pass
    if changed:
        billing = {**billing, **changed}
        await db.users.update_one(
            {"user_id": uid},
            {"$set": {f"billing.{k}": v for k, v in changed.items()} |
                     {"billing.checked_at": now_utc().isoformat()}})
    return billing


def _state(billing: dict, property_count: int) -> dict:
    b = billing or {}
    plan = PLANS.get(b.get("plan") or "")
    trial_ends = b.get("trial_ends_at") or ""
    now_iso = now_utc().isoformat()
    days_left = 0
    if trial_ends and trial_ends > now_iso:
        try:
            days_left = max(0, (datetime.fromisoformat(trial_ends) - now_utc()).days)
        except Exception:
            days_left = 0
    if b.get("exempt") or billing is None or not b:
        status, entitled, limit = "exempt", True, None
    elif b.get("status") in ("active", "trialing"):
        status, entitled = "active", True
        limit = plan["property_limit"] if plan else None
    elif trial_ends and trial_ends > now_iso:
        status, entitled, limit = "trial", True, None
    else:
        status, entitled, limit = "locked", False, 0
    return {
        "status": status, "entitled": entitled,
        "plan": b.get("plan"), "plan_label": plan["label"] if plan else None,
        "trial_ends_at": trial_ends or None, "trial_days_left": days_left,
        "property_limit": limit, "property_count": property_count,
        "cancel_at_period_end": b.get("cancel_at_period_end", False),
    }


async def billing_state_for(uid: str) -> dict:
    doc = await db.users.find_one({"user_id": uid}, {"_id": 0, "billing": 1})
    billing = (doc or {}).get("billing")
    count = await db.properties.count_documents({"user_id": uid})
    if billing and not billing.get("exempt"):
        checked = billing.get("checked_at") or ""
        stale = not checked or checked < (now_utc() - timedelta(hours=6)).isoformat()
        if billing.get("pending_session_id") or (billing.get("stripe_subscription_id") and stale):
            billing = await _refresh_from_stripe(uid, billing)
    return _state(billing, count)


@api_router.get("/billing/status")
async def billing_status(user=Depends(get_current_user)):
    return await billing_state_for(user["user_id"])


class CheckoutIn(BaseModel):
    plan: str
    origin_url: str = ""


@api_router.post("/billing/checkout")
async def billing_checkout(payload: CheckoutIn, user=Depends(get_current_user)):
    _require_owner(user)
    plan = PLANS.get(payload.plan)
    if not plan:
        raise HTTPException(status_code=400, detail="Formule inconnue")
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=400, detail="Stripe non configuré")
    doc = await _owner_doc(user)
    billing = doc.get("billing") or new_trial_billing()
    stripe_sdk.api_key = STRIPE_API_KEY
    customer_id = billing.get("stripe_customer_id")
    if not customer_id:
        customer = stripe_sdk.Customer.create(
            email=doc.get("email") or None, name=doc.get("name") or None,
            metadata={"app_user_id": user["user_id"]})
        customer_id = customer["id"]
    origin = (payload.origin_url or "").rstrip("/")
    if not origin:
        raise HTTPException(status_code=400, detail="origin_url requis")
    try:
        session = stripe_sdk.checkout.Session.create(
            mode="subscription",
            customer=customer_id,
            line_items=[{
                "price_data": {
                    "currency": "eur",
                    "unit_amount": plan["amount"],
                    "product_data": {"name": f"Casanéo {plan['label']} — jusqu'à {plan['property_limit']} logements"},
                    "recurring": {"interval": "month"},
                },
                "quantity": 1,
            }],
            subscription_data={"metadata": {"app_user_id": user["user_id"], "plan": payload.plan}},
            success_url=f"{origin}/subscription-success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{origin}/settings/subscription",
            client_reference_id=user["user_id"],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Stripe : {str(e)[:140]}")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"billing.stripe_customer_id": customer_id,
                  "billing.pending_session_id": session["id"],
                  "billing.plan": payload.plan,
                  "billing.trial_ends_at": billing.get("trial_ends_at"),
                  "billing.status": billing.get("status") or "trial",
                  "billing.exempt": billing.get("exempt", False)}})
    return {"checkout_url": session["url"], "session_id": session["id"]}


class ConfirmIn(BaseModel):
    session_id: str


@api_router.post("/billing/confirm")
async def billing_confirm(payload: ConfirmIn, user=Depends(get_current_user)):
    _require_owner(user)
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=400, detail="Stripe non configuré")
    stripe_sdk.api_key = STRIPE_API_KEY
    try:
        sess = stripe_sdk.checkout.Session.retrieve(payload.session_id, expand=["subscription"])
    except Exception:
        raise HTTPException(status_code=400, detail="Session de paiement inconnue")
    if sess.get("client_reference_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Cette session n'appartient pas à ce compte")
    sub = sess.get("subscription")
    if not sub:
        raise HTTPException(status_code=409, detail="Abonnement pas encore disponible — réessayez")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "billing.stripe_customer_id": sess.get("customer"),
            "billing.stripe_subscription_id": sub["id"],
            "billing.status": sub["status"],
            "billing.plan": (sub.get("metadata") or {}).get("plan"),
            "billing.pending_session_id": None,
            "billing.checked_at": now_utc().isoformat(),
        }})
    return await billing_state_for(user["user_id"])


class PortalIn(BaseModel):
    origin_url: str = ""


@api_router.post("/billing/portal")
async def billing_portal(payload: PortalIn, user=Depends(get_current_user)):
    _require_owner(user)
    doc = await _owner_doc(user)
    customer_id = ((doc.get("billing") or {}).get("stripe_customer_id"))
    if not customer_id:
        raise HTTPException(status_code=404, detail="Aucun abonnement à gérer")
    stripe_sdk.api_key = STRIPE_API_KEY
    origin = (payload.origin_url or "").rstrip("/")
    if not origin:
        raise HTTPException(status_code=400, detail="origin_url requis")
    try:
        portal = stripe_sdk.billing_portal.Session.create(
            customer=customer_id, return_url=f"{origin}/settings/subscription")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Stripe : {str(e)[:140]}")
    return {"url": portal["url"]}
