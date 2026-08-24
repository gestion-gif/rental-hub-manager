# ruff: noqa: F403, F405
from core import *  # noqa: F401
from core import enqueue_channex_ari  # noqa: F401


@api_router.get("/reservations")
async def list_reservations(status: Optional[str] = None, property_id: Optional[str] = None, user=Depends(get_current_user)):
    query = {"user_id": user["user_id"], **_prop_scope(user, "property_id")}
    if status:
        query["status"] = status
    if property_id:
        query["property_id"] = property_id
    items = await db.reservations.find(query, {"_id": 0}).sort("check_in", 1).to_list(1000)
    cmap = await status_color_map(user["user_id"])
    for it in items:
        compute_display(it, cmap)
    return items


@api_router.post("/reservations")
async def create_reservation(payload: ReservationIn, user=Depends(get_current_user)):
    doc = payload.dict()
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    name = f"{doc.get('guest_first_name', '')} {doc.get('guest_last_name', '')}".strip()
    if name:
        doc["guest_name"] = name
    nights = float(doc.get("nights_total") or 0)
    fees = float(doc.get("cleaning_fee") or 0)
    tax = float(doc.get("tourist_tax") or 0)
    total = float(doc.get("total_price") or 0)
    if nights or fees or tax:
        total = round(nights + fees + tax, 2)
        doc["total_price"] = total
    doc["finance"] = {"total": total, "paid": 0.0, "due": total, "currency": "EUR",
                      "stay": nights, "fees": fees, "taxes": tax}
    doc["payments"] = []
    await db.reservations.insert_one(doc)
    doc.pop("_id", None)
    await ensure_cleaning(user["user_id"], doc["property_id"], doc.get("check_out"), doc.get("status"))
    if doc.get("status") != "annulee":
        await _set_property_rooms_availability(user["user_id"], doc["property_id"], doc.get("check_in"), doc.get("check_out"), True)
    await enqueue_channex_ari(user["user_id"], doc["property_id"], doc.get("check_in"), doc.get("check_out"), rates=False)
    return doc


@api_router.put("/reservations/{reservation_id}")
async def update_reservation(reservation_id: str, payload: ReservationIn, user=Depends(get_current_user)):
    data = payload.dict()
    name = f"{data.get('guest_first_name', '')} {data.get('guest_last_name', '')}".strip()
    if name:
        data["guest_name"] = name
    nights = float(data.get("nights_total") or 0)
    fees = float(data.get("cleaning_fee") or 0)
    tax = float(data.get("tourist_tax") or 0)
    if nights or fees or tax:
        data["total_price"] = round(nights + fees + tax, 2)
    res = await db.reservations.update_one(
        {"id": reservation_id, "user_id": user["user_id"]},
        {"$set": data},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Reservation not found")
    item = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    # Réservations manuelles : garder finance.total + ventilation alignés
    if item.get("source") != "lodgify":
        fin = dict(item.get("finance") or {})
        fin["total"] = float(item.get("total_price") or 0)
        if nights or fees or tax:
            fin["stay"] = nights
            fin["fees"] = fees
            fin["taxes"] = tax
        item["finance"] = fin
        recompute_payment(item)
        await db.reservations.update_one(
            {"id": reservation_id, "user_id": user["user_id"]},
            {"$set": {"finance": item["finance"]}})
        item = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    await ensure_cleaning(user["user_id"], item["property_id"], item.get("check_out"), item.get("status"))
    await _set_property_rooms_availability(user["user_id"], item["property_id"], item.get("check_in"), item.get("check_out"),
                                           item.get("status") != "annulee")
    await enqueue_channex_ari(user["user_id"], item["property_id"], item.get("check_in"), item.get("check_out"), rates=False)
    return item


@api_router.patch("/reservations/{reservation_id}/status")
async def update_status(reservation_id: str, body: dict, user=Depends(get_current_user)):
    new_status = body.get("status")
    if not isinstance(new_status, str) or not new_status.strip():
        raise HTTPException(status_code=400, detail="Invalid status")
    new_status = new_status.strip()
    # Allow core statuses + any custom status defined in the user's preferences
    doc = await db.preferences.find_one({"user_id": user["user_id"]}, {"_id": 0})
    valid_keys = {s["key"] for s in _build_statuses(doc)}
    if new_status not in valid_keys:
        raise HTTPException(status_code=400, detail="Invalid status")
    res = await db.reservations.update_one(
        {"id": reservation_id, "user_id": user["user_id"]},
        {"$set": {"status": new_status}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Reservation not found")
    item = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    await _set_property_rooms_availability(user["user_id"], item["property_id"], item.get("check_in"), item.get("check_out"),
                                           new_status != "annulee")
    await enqueue_channex_ari(user["user_id"], item["property_id"], item.get("check_in"), item.get("check_out"), rates=False)
    return item


@api_router.patch("/reservations/{reservation_id}/paid")
async def set_reservation_paid(reservation_id: str, body: dict, user=Depends(get_current_user)):
    uid = user["user_id"]
    paid = bool(body.get("paid", True))
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    r["paid_manual"] = paid
    fully = recompute_payment(r)
    markers = set(r.get("markers") or [])
    if paid or fully:
        markers.add("paid")
    else:
        markers.discard("paid")
    tmap = {t["marker_key"]: t for t in await get_templates(uid)}
    await db.reservations.update_one(
        {"id": reservation_id, "user_id": uid},
        {"$set": {"paid_manual": paid, "finance": r["finance"], "markers": list(markers),
                  "marker_color": marker_color_for(list(markers), tmap)}})
    item = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    compute_display(item, await status_color_map(uid))
    return item


@api_router.post("/reservations/{reservation_id}/payments")
async def add_payment(reservation_id: str, body: dict, user=Depends(get_current_user)):
    uid = user["user_id"]
    amount = float(body.get("amount") or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Montant invalide")
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    payments = r.get("payments") or []
    payments.append({
        "id": str(uuid.uuid4()),
        "amount": round(amount, 2),
        "date": body.get("date") or date.today().isoformat(),
        "note": body.get("note", ""),
    })
    r["payments"] = payments
    fully = recompute_payment(r)
    markers = set(r.get("markers") or [])
    if fully:
        markers.add("paid")
    tmap = {t["marker_key"]: t for t in await get_templates(uid)}
    await db.reservations.update_one(
        {"id": reservation_id, "user_id": uid},
        {"$set": {"payments": payments, "finance": r["finance"], "markers": list(markers),
                  "marker_color": marker_color_for(list(markers), tmap)}})
    item = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    compute_display(item, await status_color_map(uid))
    return item


@api_router.delete("/reservations/{reservation_id}/payments/{payment_id}")
async def delete_payment(reservation_id: str, payment_id: str, user=Depends(get_current_user)):
    uid = user["user_id"]
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    payments = [p for p in (r.get("payments") or []) if p.get("id") != payment_id]
    r["payments"] = payments
    fully = recompute_payment(r)
    markers = set(r.get("markers") or [])
    if fully or r.get("paid_manual"):
        markers.add("paid")
    else:
        markers.discard("paid")
    tmap = {t["marker_key"]: t for t in await get_templates(uid)}
    await db.reservations.update_one(
        {"id": reservation_id, "user_id": uid},
        {"$set": {"payments": payments, "finance": r["finance"], "markers": list(markers),
                  "marker_color": marker_color_for(list(markers), tmap)}})
    item = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    compute_display(item, await status_color_map(uid))
    return item


@api_router.patch("/reservations/{reservation_id}/commission")
async def set_commission(reservation_id: str, body: dict, user=Depends(get_current_user)):
    uid = user["user_id"]
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    amount = float(body.get("amount") or 0)
    if amount < 0:
        raise HTTPException(status_code=400, detail="Montant invalide")
    fin = dict(r.get("finance") or {})
    fin["commission"] = round(amount, 2)
    await db.reservations.update_one(
        {"id": reservation_id, "user_id": uid}, {"$set": {"finance": fin}})
    item = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    compute_display(item, await status_color_map(uid))
    return item


@api_router.patch("/reservations/{reservation_id}/caution-validated")
async def set_caution_validated(reservation_id: str, payload: CautionValidatedIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    if payload.base_url:
        await db.channel_settings.update_one({"user_id": uid}, {"$set": {"public_base_url": payload.base_url}}, upsert=True)
    upd = {"caution_validated": payload.validated}
    keys_sent = False
    reason = "not_validated"
    if payload.validated:
        prop = await db.properties.find_one({"id": r.get("property_id"), "user_id": uid}, {"_id": 0}) or {}
        if r.get("keys_sent_at"):
            reason = "already_sent"
        else:
            try:
                keys_sent, reason = await _send_key_instructions(uid, r, prop, payload.base_url)
            except HTTPException as e:
                reason = f"send_error:{e.detail}"
            except Exception as e:
                reason = f"send_error:{e}"
            if keys_sent:
                upd["keys_sent_at"] = now_utc().isoformat()
    await db.reservations.update_one({"id": reservation_id, "user_id": uid}, {"$set": upd})
    item = await db.reservations.find_one({"id": reservation_id}, {"_id": 0})
    return {"caution_validated": payload.validated, "keys_sent": keys_sent,
            "reason": reason, "reservation": item}


@api_router.post("/reservations/{reservation_id}/send-keys")
async def send_keys(reservation_id: str, payload: SendKeysIn, user=Depends(get_current_user)):
    """Envoi manuel des instructions de clés au voyageur (sans exiger de caution)."""
    uid = user["user_id"]
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    if payload.base_url:
        await db.channel_settings.update_one({"user_id": uid}, {"$set": {"public_base_url": payload.base_url}}, upsert=True)
    prop = await db.properties.find_one({"id": r.get("property_id"), "user_id": uid}, {"_id": 0}) or {}
    keys_sent, reason = await _send_key_instructions(uid, r, prop, payload.base_url)
    if keys_sent:
        await db.reservations.update_one(
            {"id": reservation_id, "user_id": uid},
            {"$set": {"keys_sent_at": now_utc().isoformat()}})
    return {"keys_sent": keys_sent, "reason": reason}


@api_router.post("/reservations/{reservation_id}/send-deposit-link")
async def send_deposit_link(reservation_id: str, user=Depends(get_current_user)):
    """Envoie au voyageur le lien de paiement de la caution défini sur le logement."""
    uid = user["user_id"]
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    prop = await db.properties.find_one({"id": r.get("property_id"), "user_id": uid}, {"_id": 0}) or {}
    link = (prop.get("deposit_link") or "").strip()
    if not link:
        return {"sent": False, "reason": "no_deposit_link"}
    if r.get("source") != "lodgify" or not r.get("thread_uid") or not r.get("lodgify_id"):
        return {"sent": False, "reason": "no_messaging"}
    settings = await db.channel_settings.find_one({"user_id": uid}, {"_id": 0})
    if not settings or not settings.get("api_key"):
        return {"sent": False, "reason": "no_channel"}
    guest = r.get("guest_name") or ""
    pname = r.get("property_name") or prop.get("name") or "votre logement"
    body = (f"Bonjour {guest},".rstrip(",") + "\n"
            f"Afin de finaliser votre réservation pour {pname}, merci de régler la caution "
            f"via ce lien sécurisé :\n{link}\n\nMerci et à bientôt !")
    adapter = LodgifyAdapter(settings["api_key"])
    async with httpx.AsyncClient(timeout=30) as http:
        await adapter.send_message(http, r["lodgify_id"], body, "Caution")
    await db.reservations.update_one(
        {"id": reservation_id, "user_id": uid},
        {"$set": {"deposit_link_sent_at": now_utc().isoformat()}})
    return {"sent": True, "reason": "sent"}


@api_router.get("/deposits/pending")
async def deposits_pending(user=Depends(get_current_user)):
    """Cautions à suivre : arrivées à venir (hors Airbnb) dont la caution n'est pas validée,
    pour un logement ayant un lien de caution. Signale les arrivées J-1 (urgent)."""
    uid = user["user_id"]
    props = await db.properties.find(
        {"user_id": uid, "deposit_link": {"$nin": [None, ""]}, **_prop_scope(user)},
        {"_id": 0, "id": 1, "name": 1}).to_list(2000)
    if not props:
        return []
    prop_ids = [p["id"] for p in props]
    pname = {p["id"]: p["name"] for p in props}
    today = date.today()
    q = {
        "user_id": uid,
        "property_id": {"$in": prop_ids},
        "status": {"$nin": ["annulee"]},
        "check_in": {"$gte": today.isoformat()},
        "caution_validated": {"$ne": True},
        "platform": {"$ne": "Airbnb"},
    }
    res = await db.reservations.find(
        q, {"_id": 0, "id": 1, "guest_name": 1, "property_id": 1, "check_in": 1, "platform": 1,
            "deposit_link_sent_at": 1, "deposit_reminder_sent_at": 1}
    ).sort("check_in", 1).to_list(500)
    out = []
    for r in res:
        try:
            days = (date.fromisoformat(r["check_in"]) - today).days
        except Exception:
            days = None
        out.append({
            "reservation_id": r["id"], "guest_name": r.get("guest_name", ""),
            "property_name": pname.get(r["property_id"], ""), "check_in": r.get("check_in"),
            "platform": r.get("platform", ""),
            "sent": bool(r.get("deposit_link_sent_at")),
            "reminder": bool(r.get("deposit_reminder_sent_at")),
            "days_until": days,
            "urgent": days is not None and days <= 1,
        })
    return out


@api_router.get("/reservations/recent-confirmed")
async def recent_confirmed(since: Optional[str] = None, user=Depends(get_current_user)):
    """Réservations confirmées reçues depuis la dernière visite (paramètre `since` = timestamp ISO).
    Sert au bandeau de félicitations sur l'accueil. Renvoie le nombre et la dernière réservation."""
    uid = user["user_id"]
    q = {
        "user_id": uid,
        "status": {"$nin": ["annulee", "demande"]},
        **_prop_scope(user, "property_id"),
    }
    if since:
        q["created_at"] = {"$gt": since}
    else:
        # Sans référence, on ne remonte rien (évite un bandeau au tout premier chargement).
        return {"count": 0, "latest": None}
    res = await db.reservations.find(
        q, {"_id": 0, "id": 1, "guest_name": 1, "property_id": 1, "check_in": 1,
            "created_at": 1, "platform": 1}
    ).sort("created_at", -1).to_list(200)
    if not res:
        return {"count": 0, "latest": None}
    pids = list({r["property_id"] for r in res if r.get("property_id")})
    props = await db.properties.find({"id": {"$in": pids}}, {"_id": 0, "id": 1, "name": 1}).to_list(2000)
    pname = {p["id"]: p["name"] for p in props}
    top = res[0]
    return {
        "count": len(res),
        "latest": {
            "reservation_id": top["id"],
            "guest_name": top.get("guest_name", ""),
            "property_name": pname.get(top.get("property_id"), ""),
            "check_in": top.get("check_in"),
            "platform": top.get("platform", ""),
        },
    }



@api_router.get("/payments/pending")
async def payments_pending(user=Depends(get_current_user)):
    """Réservations à venir dont le solde n'est pas réglé avant l'arrivée."""
    uid = user["user_id"]
    today = date.today()
    q = {
        "user_id": uid,
        "status": {"$nin": ["annulee"]},
        "check_in": {"$gte": today.isoformat()},
        **_prop_scope(user, "property_id"),
    }
    res = await db.reservations.find(q, {"_id": 0}).sort("check_in", 1).to_list(1000)
    out = []
    for r in res:
        if "paid" in (r.get("markers") or []):
            continue
        fin = r.get("finance") or {}
        due = round(float(fin.get("due") or 0), 2)
        if due <= 0:
            continue
        try:
            days = (date.fromisoformat(r["check_in"]) - today).days
        except Exception:
            days = None
        out.append({
            "reservation_id": r["id"], "guest_name": r.get("guest_name", ""),
            "property_name": r.get("property_name", ""), "check_in": r.get("check_in"),
            "platform": r.get("platform", ""), "due": due,
            "total": round(float(fin.get("total") or 0), 2),
            "days_until": days, "urgent": days is not None and days <= 2,
        })
    return out


@api_router.patch("/reservations/{reservation_id}/checklist")
async def set_reservation_checklist(reservation_id: str, payload: ChecklistIn, user=Depends(get_current_user)):
    """Met à jour la check-list d'arrivée d'une réservation (caution, clés, livret, ménage).
    Le champ `checklist` est hors ReservationIn → préservé par le PUT principal."""
    uid = user["user_id"]
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    current = {k: bool((r.get("checklist") or {}).get(k)) for k in CHECKLIST_KEYS}
    for k in CHECKLIST_KEYS:
        if k in (payload.checklist or {}):
            current[k] = bool(payload.checklist[k])
    await db.reservations.update_one({"id": reservation_id, "user_id": uid}, {"$set": {"checklist": current}})
    return {"checklist": current}


@api_router.delete("/reservations/{reservation_id}")
async def delete_reservation(reservation_id: str, user=Depends(get_current_user)):
    r = await db.reservations.find_one({"id": reservation_id, "user_id": user["user_id"]}, {"_id": 0})
    await db.reservations.delete_one({"id": reservation_id, "user_id": user["user_id"]})
    if r:
        await _set_property_rooms_availability(user["user_id"], r.get("property_id"), r.get("check_in"), r.get("check_out"), False)
        await enqueue_channex_ari(user["user_id"], r.get("property_id"), r.get("check_in"), r.get("check_out"), rates=False)
    return {"ok": True}


@api_router.post("/reservations/{reservation_id}/checkout")
async def create_checkout(reservation_id: str, payload: CheckoutIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    fin = r.get("finance") or {}
    # Montant défini côté serveur, jamais fourni librement par le client
    if payload.kind == "deposit":
        amount = float(payload.amount or 0)
        label = "Caution"
    else:
        due = float(fin.get("due") or 0)
        total = float(fin.get("total") or r.get("total_price") or 0)
        default_amount = due if due > 0 else total
        amount = float(payload.amount) if payload.amount else default_amount
        label = "Paiement réservation"
    amount = round(amount, 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Montant invalide")

    currency = (fin.get("currency") or "EUR").lower()
    origin = payload.origin_url.rstrip("/")
    success_url = f"{origin}/reservation-form?id={reservation_id}&stripe=success"
    cancel_url = f"{origin}/reservation-form?id={reservation_id}&stripe=cancel"

    client = stripe_client()
    req = CheckoutSessionRequest(
        amount=amount,
        currency=currency,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={"reservation_id": reservation_id, "user_id": uid, "kind": payload.kind},
    )
    session = await client.create_checkout_session(req)

    await db.payment_transactions.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "reservation_id": reservation_id,
        "kind": payload.kind,
        "session_id": session.session_id,
        "amount": amount,
        "currency": currency,
        "label": label,
        "payment_status": "initiated",
        "status": "open",
        "processed": False,
        "created_at": now_utc().isoformat(),
    })
    return {"url": session.url, "session_id": session.session_id}


@api_router.get("/checkout/status/{session_id}")
async def checkout_status(session_id: str, user=Depends(get_current_user)):
    tx = await db.payment_transactions.find_one({"session_id": session_id, "user_id": user["user_id"]}, {"_id": 0})
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction inconnue")
    client = stripe_client()
    st = await client.get_checkout_status(session_id)
    await db.payment_transactions.update_one(
        {"session_id": session_id}, {"$set": {"payment_status": st.payment_status, "status": st.status}})
    if st.payment_status == "paid" and not tx.get("processed"):
        await _apply_stripe_payment(tx)
    return {
        "kind": tx["kind"],
        "amount": tx["amount"],
        "status": st.status,
        "payment_status": st.payment_status,
    }


@api_router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()
    sig = request.headers.get("Stripe-Signature")
    client = stripe_client()
    try:
        event = await client.handle_webhook(body, sig)
    except Exception:
        raise HTTPException(status_code=400, detail="Webhook invalide")
    sid = getattr(event, "session_id", None)
    if event.payment_status == "paid" and sid:
        tx = await db.payment_transactions.find_one({"session_id": sid}, {"_id": 0})
        if tx and not tx.get("processed"):
            await _apply_stripe_payment(tx)
    return {"received": True}

