"""Paiements Stripe : client checkout, application des paiements, encaissement auto des cartes OTA."""
import asyncio
import uuid
from datetime import date, timedelta

import httpx
from fastapi import HTTPException
from emergentintegrations.payments.stripe.checkout import StripeCheckout

from infra import db, logger, STRIPE_API_KEY, _sync_log, get_channex_adapter
from helpers import now_utc, recompute_payment, marker_color_for
from emailer import send_email


def stripe_client() -> StripeCheckout:
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe non configuré")
    return StripeCheckout(api_key=STRIPE_API_KEY)


async def _apply_stripe_payment(tx: dict):
    """Enregistre l'effet d'un paiement Stripe réussi sur la réservation (idempotent)."""
    from core import get_templates, _set_property_rooms_availability, _send_booking_confirmation
    if tx.get("processed"):
        return
    uid = tx["user_id"]
    rid = tx["reservation_id"]
    r = await db.reservations.find_one({"id": rid, "user_id": uid}, {"_id": 0})
    if not r:
        return
    if tx["kind"] == "public_balance":
        # Paiement du solde d'une réservation issue du site
        payments = r.get("payments") or []
        payments.append({
            "id": str(uuid.uuid4()), "amount": round(float(tx["amount"]), 2),
            "date": date.today().isoformat(), "note": "Solde payé en ligne (site)",
            "stripe_session": tx["session_id"],
        })
        r["payments"] = payments
        recompute_payment(r)
        markers = set(r.get("markers") or [])
        if float(r["finance"].get("due", 0)) <= 0.01:
            markers.add("paid")
        tmap = {t["marker_key"]: t for t in await get_templates(uid)}
        await db.reservations.update_one(
            {"id": rid, "user_id": uid},
            {"$set": {"payments": payments, "finance": r["finance"],
                      "markers": list(markers), "marker_color": marker_color_for(list(markers), tmap)}})
        await db.payment_transactions.update_one(
            {"session_id": tx["session_id"]},
            {"$set": {"processed": True, "payment_status": "paid", "status": "complete"}})
        return
    if tx["kind"] == "public_booking":
        # Réservation issue du site public : confirmer + payer + bloquer le calendrier
        payments = r.get("payments") or []
        payments.append({
            "id": str(uuid.uuid4()), "amount": round(float(tx["amount"]), 2),
            "date": date.today().isoformat(), "note": tx.get("label") or "Paiement en ligne (site)",
            "stripe_session": tx["session_id"],
        })
        r["payments"] = payments
        recompute_payment(r)
        markers = set(r.get("markers") or [])
        if not tx.get("is_deposit"):
            markers.add("paid")
        tmap = {t["marker_key"]: t for t in await get_templates(uid)}
        await db.reservations.update_one(
            {"id": rid, "user_id": uid},
            {"$set": {"status": "confirmee", "payments": payments, "finance": r["finance"],
                      "markers": list(markers), "marker_color": marker_color_for(list(markers), tmap),
                      "pending_payment": False}})
        await _set_property_rooms_availability(uid, r["property_id"], r.get("check_in"), r.get("check_out"), True)
        await db.payment_transactions.update_one(
            {"session_id": tx["session_id"]},
            {"$set": {"processed": True, "payment_status": "paid", "status": "complete"}})
        try:
            r2 = await db.reservations.find_one({"id": rid, "user_id": uid}, {"_id": 0})
            await _send_booking_confirmation(uid, r2, tx)
        except Exception as e:
            logger.warning("email confirmation client échoué: %s", e)
        return
    if tx["kind"] == "deposit":
        fin = dict(r.get("finance") or {})
        fin["deposit_collected"] = True
        fin["deposit_amount"] = tx["amount"]
        await db.reservations.update_one({"id": rid, "user_id": uid}, {"$set": {"finance": fin}})
    else:
        payments = r.get("payments") or []
        payments.append({
            "id": str(uuid.uuid4()),
            "amount": round(float(tx["amount"]), 2),
            "date": date.today().isoformat(),
            "note": "Paiement Stripe",
            "stripe_session": tx["session_id"],
        })
        r["payments"] = payments
        fully = recompute_payment(r)
        markers = set(r.get("markers") or [])
        if fully or r.get("paid_manual"):
            markers.add("paid")
        tmap = {t["marker_key"]: t for t in await get_templates(uid)}
        await db.reservations.update_one(
            {"id": rid, "user_id": uid},
            {"$set": {"payments": payments, "finance": r["finance"], "markers": list(markers),
                      "marker_color": marker_color_for(list(markers), tmap)}})
    await db.payment_transactions.update_one(
        {"session_id": tx["session_id"]},
        {"$set": {"processed": True, "payment_status": "paid", "status": "complete"}})


# ---------------------------------------------------------------------------
# Encaissement automatique des cartes OTA (Booking.com via Channex → Stripe)
# ---------------------------------------------------------------------------
async def _record_auto_charge_error(uid: str, r: dict, error: str):
    prev = r.get("auto_charge") or {}
    attempts = int(prev.get("attempts") or 0) + 1
    await db.reservations.update_one(
        {"id": r["id"], "user_id": uid},
        {"$set": {"auto_charge": {"status": "error", "error": error[:300],
                                  "attempts": attempts, "at": now_utc().isoformat()}}})
    await _sync_log(uid, "auto_charge", "error", f"{r.get('guest_name', '')}: {error[:200]}")
    # Alerte email au gestionnaire (1re tentative et abandon après la 3e)
    if attempts not in (1, 3):
        return
    try:
        u = await db.users.find_one({"user_id": uid}, {"_id": 0, "email": 1})
        to = (u or {}).get("email")
        if not to:
            return
        due = float((r.get("finance") or {}).get("due") or 0)
        final = attempts >= 3
        subject = ("⚠️ Encaissement Booking.com abandonné — action requise"
                   if final else "Échec d'encaissement automatique Booking.com")
        html = (
            f"<p>L'encaissement automatique de la carte Booking.com a échoué"
            f"{' définitivement (3 tentatives)' if final else f' (tentative {attempts}/3)'}.</p>"
            f"<p><b>Réservation :</b> {r.get('guest_name', '')} · {r.get('property_name', '')}<br>"
            f"<b>Séjour :</b> {r.get('check_in', '')} → {r.get('check_out', '')}<br>"
            f"<b>Montant dû :</b> {due:.2f} €</p>"
            f"<p><b>Motif :</b> {error[:300]}</p>"
            + ("<p>Aucune nouvelle tentative ne sera faite : encaissez manuellement depuis la fiche réservation "
               "(bouton « Encaisser la carte Booking.com ») ou contactez le voyageur.</p>" if final
               else "<p>Une nouvelle tentative aura lieu automatiquement.</p>")
        )
        await send_email(to=to, subject=subject, html=html)
    except Exception:
        logger.exception("auto charge alert email failed")


async def auto_charge_reservation(uid: str, r: dict) -> dict:
    """Encaisse le dû d'une réservation Channex via la carte stockée chez Channex
    (app Stripe Tokenization) + PaymentIntent Stripe off-session. Idempotent."""
    from core import get_templates
    if not STRIPE_API_KEY:
        return {"ok": False, "error": "Stripe non configuré"}
    bid = r.get("channex_booking_id")
    if not bid:
        return {"ok": False, "error": "Réservation sans identifiant Channex"}
    fin = r.get("finance") or {}
    due = round(float(fin.get("due") or 0), 2)
    if due <= 0:
        return {"ok": False, "error": "Aucun montant dû"}
    if (r.get("auto_charge") or {}).get("status") == "done":
        return {"ok": False, "error": "Déjà encaissé"}
    currency = str(fin.get("currency") or "EUR").lower()
    adapter, _ = await get_channex_adapter(uid)
    if not adapter:
        return {"ok": False, "error": "Channex non connecté"}
    token = ""
    token_err = ""
    async with httpx.AsyncClient(timeout=60) as http:
        try:
            token = await adapter.stripe_payment_method(http, bid)
        except HTTPException as e:
            token_err = str(e.detail)
        except Exception as e:
            token_err = str(e)
    if not token:
        err = ("Carte indisponible via Channex — l'app « Stripe Tokenization » doit être installée "
               "sur la propriété et un compte Stripe connecté à Channex (accès production requis). "
               + (f"Détail : {token_err}" if token_err else ""))
        await _record_auto_charge_error(uid, r, err)
        return {"ok": False, "error": err}

    import stripe as stripe_sdk

    def _charge(use_moto: bool):
        stripe_sdk.api_key = STRIPE_API_KEY
        # Recommandation Stripe : attacher les billing_details (nom/email) au
        # PaymentMethod pour réduire le scoring fraude Radar.
        try:
            billing = {"name": (r.get("guest_name") or "").strip() or None}
            email = (r.get("guest_email") or "").strip()
            if email:
                billing["email"] = email
            stripe_sdk.PaymentMethod.modify(token, billing_details={k: v for k, v in billing.items() if v})
        except Exception:
            pass  # non bloquant
        kwargs = dict(
            amount=int(round(due * 100)), currency=currency,
            payment_method=token, payment_method_types=["card"],
            confirm=True, off_session=True,
            description=f"Réservation {r.get('platform', '')} · {r.get('guest_name', '')} · {r.get('check_in', '')}",
            metadata={"reservation_id": r["id"], "channex_booking_id": str(bid)},
            idempotency_key=f"autocharge-{r['id']}-{int(round(due * 100))}-{token[-8:]}{'-moto' if use_moto else ''}",
        )
        if use_moto:
            # MOTO : encaissement initié par le commerçant (carte transmise par l'OTA).
            # Exempte de SCA et réduit le scoring fraude. Nécessite l'option MOTO
            # activée sur le compte Stripe (sinon erreur → fallback sans MOTO).
            kwargs["payment_method_options"] = {"card": {"moto": True}}
        return stripe_sdk.PaymentIntent.create(**kwargs)
    try:
        try:
            intent = await asyncio.to_thread(_charge, True)
        except Exception as e_moto:
            if "moto" in str(e_moto).lower():
                intent = await asyncio.to_thread(_charge, False)
            else:
                raise
    except Exception as e:
        err = f"Stripe : {e}"
        await _record_auto_charge_error(uid, r, err)
        return {"ok": False, "error": err}
    if intent.status not in ("succeeded", "processing"):
        err = f"Statut Stripe : {intent.status}"
        await _record_auto_charge_error(uid, r, err)
        return {"ok": False, "error": err}
    payments = r.get("payments") or []
    payments.append({
        "id": str(uuid.uuid4()), "amount": due, "date": date.today().isoformat(),
        "note": "Encaissement automatique carte Booking.com (Stripe)",
        "payment_intent": intent.id,
    })
    r["payments"] = payments
    recompute_payment(r)
    markers = set(r.get("markers") or [])
    if float(r["finance"].get("due", 0)) <= 0.01:
        markers.add("paid")
    tmap = {t["marker_key"]: t for t in await get_templates(uid)}
    await db.reservations.update_one(
        {"id": r["id"], "user_id": uid},
        {"$set": {"payments": payments, "finance": r["finance"], "markers": list(markers),
                  "marker_color": marker_color_for(list(markers), tmap),
                  "auto_charge": {"status": "done", "payment_intent_id": intent.id,
                                  "amount": due, "at": now_utc().isoformat()}}})
    await _sync_log(uid, "auto_charge", "success",
                    f"{r.get('guest_name', '')} · {due:.2f} {currency.upper()} encaissés (PI {intent.id})")
    return {"ok": True, "amount": due, "payment_intent_id": intent.id, "status": intent.status}


async def run_auto_charge_for_user(uid: str) -> dict:
    """Encaisse les résas Booking.com (source Channex) dont l'arrivée est à ≤ N jours."""
    from core import _build_auto_charge
    prefs = await db.preferences.find_one({"user_id": uid}, {"_id": 0, "auto_charge": 1})
    cfg = _build_auto_charge(prefs)
    if not cfg["enabled"]:
        return {"charged": 0, "errors": 0}
    today = date.today().isoformat()
    horizon = (date.today() + timedelta(days=cfg["days_before"])).isoformat()
    candidates = await db.reservations.find(
        {"user_id": uid, "source": "channex",
         "platform": {"$regex": "booking", "$options": "i"},
         "status": {"$nin": ["annulee", "demande"]},
         "check_in": {"$gte": today, "$lte": horizon},
         "finance.due": {"$gt": 0},
         "auto_charge.status": {"$ne": "done"}},
        {"_id": 0}).to_list(500)
    charged = errors = 0
    for r in candidates:
        ac = r.get("auto_charge") or {}
        attempts = int(ac.get("attempts") or 0)
        if attempts >= 3:
            # Cartes virtuelles Booking : souvent activées le jour d'arrivée seulement.
            # → une ultime tentative à partir du check-in si les échecs datent d'avant.
            last_at = str(ac.get("at") or "")[:10]
            ci = str(r.get("check_in") or "")
            if not (ci and today >= ci and last_at < ci):
                continue
        res = await auto_charge_reservation(uid, r)
        if res.get("ok"):
            charged += 1
        else:
            errors += 1
        await asyncio.sleep(1)
    return {"charged": charged, "errors": errors}
