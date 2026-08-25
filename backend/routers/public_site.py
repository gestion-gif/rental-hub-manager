# ruff: noqa: F403, F405
from core import *  # noqa: F401


@api_router.get("/public/site/{slug}")
async def public_site(slug: str):
    uid, prefs = await _resolve_public_site(slug)
    props = await db.properties.find({"user_id": uid}, {"_id": 0}).to_list(500)
    published = [_public_prop_card(p) for p in props if p.get("published") is not False]
    published.sort(key=lambda x: x["name"].lower())
    company = _build_company(prefs)
    ps = _build_public_site(prefs)
    return {"slug": slug, "company": company, "properties": published, "count": len(published),
            "showcase": ps.get("showcase")}


@api_router.get("/public/site/{slug}/property/{property_id}")
async def public_property(slug: str, property_id: str):
    uid, prefs = await _resolve_public_site(slug)
    prop = await db.properties.find_one({"id": property_id, "user_id": uid}, {"_id": 0})
    if not prop or prop.get("published") is False:
        raise HTTPException(status_code=404, detail="Logement indisponible")
    today = date.today()
    horizon = (today + timedelta(days=365)).isoformat()
    booked = await _booked_dates(uid, property_id, today.isoformat(), horizon)
    policy = None
    pol_id = prop.get("booking_policy_id")
    if pol_id:
        policy = await db.booking_policies.find_one({"id": pol_id, "user_id": uid}, {"_id": 0})
    card = _public_prop_card(prop)
    card.update({
        "unavailable_dates": sorted(booked),
        "default_cleaning_fee": prop.get("default_cleaning_fee", 0),
        "tourist_tax_pct": prop.get("tourist_tax_pct", 0),
        "booking_policy": policy,
    })
    return card


@api_router.post("/public/site/{slug}/quote")
async def public_quote(slug: str, payload: PublicQuoteIn):
    uid, _ = await _resolve_public_site(slug)
    return await _public_quote(uid, payload.property_id, payload.check_in,
                               payload.check_out, payload.guests, payload.promo_code,
                               payload.supplements)


@api_router.post("/public/site/{slug}/request")
async def public_booking_request(slug: str, payload: PublicBookingIn):
    """Demande de réservation sans paiement (le gestionnaire valide dans l'app)."""
    uid, _ = await _resolve_public_site(slug)
    q = await _public_quote(uid, payload.property_id, payload.check_in, payload.check_out,
                            payload.guests, payload.promo_code, payload.supplements)
    rid = await _create_public_reservation(uid, q, payload, "demande", slug)
    r = await db.reservations.find_one({"id": rid, "user_id": uid}, {"_id": 0})
    asyncio.create_task(_send_request_ack(uid, r, slug, (payload.origin_url or "").rstrip("/")))
    return {"reservation_id": rid, "status": "demande", "total": q["total"]}


@api_router.post("/public/site/{slug}/checkout")
async def public_checkout(slug: str, payload: PublicBookingIn):
    """Réservation + paiement en ligne (Stripe Checkout hébergé)."""
    uid, _ = await _resolve_public_site(slug)
    q = await _public_quote(uid, payload.property_id, payload.check_in, payload.check_out,
                            payload.guests, payload.promo_code, payload.supplements)
    pay_now = round(float(q.get("deposit_amount") or q["total"]), 2)
    if pay_now <= 0:
        raise HTTPException(status_code=400, detail="Montant invalide")
    rid = await _create_public_reservation(uid, q, payload, "demande", slug)
    origin = (payload.origin_url or "").rstrip("/")
    success_url = f"{origin}/book/{slug}/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/book/{slug}/{payload.property_id}?stripe=cancel"
    client = stripe_client()
    req = CheckoutSessionRequest(
        amount=pay_now, currency="eur",
        success_url=success_url, cancel_url=cancel_url,
        metadata={"reservation_id": rid, "user_id": uid, "kind": "public_booking", "slug": slug},
    )
    session = await client.create_checkout_session(req)
    await db.payment_transactions.insert_one({
        "id": str(uuid.uuid4()), "user_id": uid, "reservation_id": rid,
        "kind": "public_booking", "session_id": session.session_id,
        "amount": pay_now, "currency": "eur", "label": q.get("deposit_label") or "Réservation site",
        "is_deposit": bool(q.get("deposit_label")), "balance_due": q.get("balance_due", 0),
        "origin": origin, "slug": slug,
        "payment_status": "initiated", "status": "open", "processed": False,
        "created_at": now_utc().isoformat(),
    })
    return {"url": session.url, "session_id": session.session_id, "reservation_id": rid, "amount": pay_now}


@api_router.get("/public/booking/status/{session_id}")
async def public_booking_status(session_id: str):
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction inconnue")
    client = stripe_client()
    st = await client.get_checkout_status(session_id)
    await db.payment_transactions.update_one(
        {"session_id": session_id}, {"$set": {"payment_status": st.payment_status, "status": st.status}})
    if st.payment_status == "paid" and not tx.get("processed"):
        await _apply_stripe_payment(tx)
    r = await db.reservations.find_one({"id": tx["reservation_id"]}, {"_id": 0})
    return {
        "payment_status": st.payment_status, "status": st.status,
        "reservation_status": (r or {}).get("status"),
        "amount": tx["amount"], "currency": tx.get("currency", "eur"),
    }


@api_router.get("/public/default-site")
async def public_default_site():
    """Renvoie le slug du premier site public activé (utile pour un domaine dédié)."""
    prefs = await db.preferences.find_one({"public_site.enabled": True}, {"_id": 0})
    if not prefs:
        raise HTTPException(status_code=404, detail="Aucun site actif")
    return {"slug": (prefs.get("public_site") or {}).get("slug", "")}


@api_router.get("/public/site/{slug}/checkin/{reservation_id}")
async def public_checkin_form(slug: str, reservation_id: str):
    uid, prefs = await _resolve_public_site(slug)
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Réservation introuvable")
    oc = _build_checkin(prefs)
    questions = []
    for key in CHECKIN_PREDEFINED_KEYS:
        if oc["predefined"].get(key):
            questions.append({"id": key, "label": CHECKIN_QUESTION_LABELS.get(key, key),
                              "required": key == "guests_count", "type": "upload" if key == "upload_id" else "text"})
    for q in oc["custom_questions"]:
        questions.append({"id": q["id"], "label": q["label"], "required": False, "type": "text"})
    return {
        "property_name": r.get("property_name", ""), "guest_name": r.get("guest_name", ""),
        "check_in": r.get("check_in", ""), "check_out": r.get("check_out", ""),
        "enabled": oc["enabled"], "questions": questions,
        "submitted": bool(r.get("checkin_submission")),
    }


@api_router.post("/public/site/{slug}/checkin/{reservation_id}")
async def public_checkin_submit(slug: str, reservation_id: str, payload: CheckinSubmissionIn):
    uid, _ = await _resolve_public_site(slug)
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Réservation introuvable")
    submission = {"answers": payload.answers or {}, "submitted_at": now_utc().isoformat()}
    await db.reservations.update_one(
        {"id": reservation_id, "user_id": uid},
        {"$set": {"checkin_submission": submission, "checkin_done": True}})
    return {"ok": True}


@api_router.get("/public/site/{slug}/reservation/{reservation_id}")
async def public_reservation_summary(slug: str, reservation_id: str):
    """Récap public d'une réservation (pour paiement du solde)."""
    uid, _ = await _resolve_public_site(slug)
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Réservation introuvable")
    fin = r.get("finance") or {}
    return {
        "property_name": r.get("property_name", ""), "guest_name": r.get("guest_name", ""),
        "check_in": r.get("check_in", ""), "check_out": r.get("check_out", ""),
        "total": round(float(fin.get("total") or 0), 2),
        "paid": round(float(fin.get("paid") or 0), 2),
        "due": round(float(fin.get("due") or 0), 2),
        "status": r.get("status"),
    }


@api_router.post("/public/site/{slug}/balance-checkout/{reservation_id}")
async def public_balance_checkout(slug: str, reservation_id: str, payload: dict = Body(default={})):
    """Crée une session Stripe pour payer le solde restant d'une réservation du site."""
    uid, _ = await _resolve_public_site(slug)
    r = await db.reservations.find_one({"id": reservation_id, "user_id": uid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Réservation introuvable")
    due = round(float((r.get("finance") or {}).get("due") or 0), 2)
    if due <= 0:
        raise HTTPException(status_code=400, detail="Aucun solde à régler")
    origin = (payload.get("origin_url") or r.get("public_origin") or "").rstrip("/")
    success_url = f"{origin}/book/{slug}/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/book/{slug}/pay/{reservation_id}?stripe=cancel"
    client = stripe_client()
    req = CheckoutSessionRequest(
        amount=due, currency="eur", success_url=success_url, cancel_url=cancel_url,
        metadata={"reservation_id": reservation_id, "user_id": uid, "kind": "public_balance", "slug": slug})
    session = await client.create_checkout_session(req)
    await db.payment_transactions.insert_one({
        "id": str(uuid.uuid4()), "user_id": uid, "reservation_id": reservation_id,
        "kind": "public_balance", "session_id": session.session_id,
        "amount": due, "currency": "eur", "label": "Solde site",
        "payment_status": "initiated", "status": "open", "processed": False,
        "created_at": now_utc().isoformat(),
    })
    return {"url": session.url, "session_id": session.session_id, "amount": due}

