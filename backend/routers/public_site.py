# ruff: noqa: F403, F405
from core import *  # noqa: F401
from fastapi.responses import HTMLResponse, Response


@api_router.get("/public/sitemap.xml")
async def public_sitemap(request: Request):
    """Sitemap XML des pages publiques (accueil vitrine + sites de réservation)."""
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").split(",")[0].strip()
    if host.endswith("casaneo.pro"):
        host = "www.casaneo.pro"
    base = f"https://{host}" if host else ""
    urls = [f"{base}/"]
    prefs_all = await db.preferences.find(
        {"public_site.enabled": True}, {"_id": 0, "user_id": 1, "public_site": 1}).to_list(200)
    for pf in prefs_all:
        slug = ((pf.get("public_site") or {}).get("slug") or "").strip()
        if not slug:
            continue
        urls.append(f"{base}/book/{slug}")
        props = await db.properties.find(
            {"user_id": pf["user_id"]}, {"_id": 0, "id": 1, "published": 1}).to_list(500)
        for p in props:
            if p.get("published") is not False:
                urls.append(f"{base}/book/{slug}/{p['id']}")
    today = date.today().isoformat()
    body = "\n".join(f"  <url><loc>{u}</loc><lastmod>{today}</lastmod></url>" for u in urls)
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
           f"{body}\n</urlset>")
    return Response(content=xml, media_type="application/xml")


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



# ---------------------------------------------------------------------------
# Politique de confidentialité publique (exigée par App Store / Play Store)
# ---------------------------------------------------------------------------
_PRIVACY_HTML = """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Politique de confidentialité — Casanéo Terrain</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 760px;
         margin: 0 auto; padding: 32px 20px 64px; line-height: 1.65; color: #1c1c1e; background:#fff; }
  @media (prefers-color-scheme: dark) { body { background:#0B1330; color:#F0F3FB; } h1,h2 { color:#fff; } .muted{color:#8E99BF;} }
  header { display:flex; align-items:center; gap:14px; margin-bottom: 28px; }
  header img { height: 52px; border-radius: 10px; }
  h1 { font-size: 26px; margin: 0; }
  h2 { font-size: 19px; margin-top: 32px; }
  .muted { color: #6e6e73; font-size: 14px; }
  ul { padding-left: 22px; }
  a { color: #2f6fed; }
</style>
</head>
<body>
<header>
  <img src="/api/assets/casaneo-logo.png" alt="Casanéo">
  <div><h1>Politique de confidentialité</h1>
  <div class="muted">Application « Casanéo Terrain » — Dernière mise à jour : 1ᵉʳ septembre 2026</div></div>
</header>

<p>Casanéo Terrain est une application de gestion de locations saisonnières (channel manager) éditée par
<strong>MHP Gestion</strong>. La présente politique décrit les données traitées par l'application,
les finalités de ce traitement et vos droits.</p>

<h2>1. Données collectées</h2>
<ul>
  <li><strong>Compte utilisateur</strong> : nom, adresse e-mail et photo de profil transmis lors de la connexion
      (Google Sign-In via Emergent Auth, ou identifiants e-mail/mot de passe pour les membres d'équipe —
      les mots de passe sont stockés sous forme hachée).</li>
  <li><strong>Données d'activité</strong> : logements, réservations, tarifs, relevés, écritures comptables
      et messages saisis ou synchronisés dans l'application.</li>
  <li><strong>Données voyageurs</strong> : nom, coordonnées, dates de séjour et messages transmis par les
      plateformes de réservation (Booking.com, Airbnb…) via le channel manager Channex, uniquement pour la
      gestion des séjours.</li>
  <li><strong>Paiements</strong> : les paiements sont traités par <strong>Stripe</strong>. Les numéros de carte
      ne sont jamais stockés par Casanéo Terrain ; les cartes des plateformes sont conservées dans le coffre
      certifié PCI-DSS de Channex.</li>
  <li><strong>Photos</strong> : si vous l'autorisez, l'accès à l'appareil photo / galerie sert uniquement à
      joindre des photos (états des lieux, logements). Aucune analyse n'en est faite à d'autres fins.</li>
</ul>

<h2>2. Finalités</h2>
<ul>
  <li>Fournir les fonctionnalités de l'application : gestion des réservations, calendriers, tarifs,
      messagerie voyageurs, relevés propriétaires, comptabilité et facturation.</li>
  <li>Synchroniser les disponibilités et réservations avec les plateformes connectées.</li>
  <li>Envoyer les e-mails opérationnels que vous déclenchez ou programmez (confirmations, rappels, relevés).</li>
  <li>Proposer une assistance par intelligence artificielle (brouillons de réponses, résumés) — les contenus
      soumis à l'IA ne servent pas à entraîner des modèles.</li>
</ul>

<h2>3. Sous-traitants et destinataires</h2>
<ul>
  <li><strong>Emergent</strong> — hébergement de l'application et service d'authentification Google.</li>
  <li><strong>Channex.io</strong> — synchronisation avec les plateformes de réservation et stockage PCI des cartes.</li>
  <li><strong>Stripe</strong> — traitement des paiements.</li>
  <li><strong>Booking.com, Airbnb et plateformes connectées</strong> — échange des données de réservation.</li>
  <li><strong>Anthropic / OpenAI</strong> (via Emergent) — fonctionnalités d'assistance IA.</li>
  <li><strong>Resend</strong> (via Emergent) — envoi d'e-mails transactionnels.</li>
</ul>
<p>Aucune donnée n'est vendue à des tiers ni utilisée à des fins publicitaires.</p>

<h2>4. Durée de conservation</h2>
<p>Les données sont conservées pendant la durée d'utilisation du service, puis le temps des obligations
légales applicables (notamment comptables : jusqu'à 10 ans pour les pièces comptables). Les données peuvent
être supprimées sur demande dans les limites de ces obligations.</p>

<h2>5. Sécurité</h2>
<p>Les échanges sont chiffrés (HTTPS/TLS). L'accès aux données est restreint par authentification et par un
système de rôles (propriétaire, membres, personnel). Les mots de passe sont hachés et les cartes bancaires ne
transitent jamais en clair par nos serveurs.</p>

<h2>6. Vos droits</h2>
<p>Conformément au RGPD, vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation et
de portabilité de vos données. <strong>Suppression de compte</strong> : vous pouvez demander la suppression
de votre compte et des données associées à tout moment en écrivant à l'adresse ci-dessous ; elle sera
effectuée sous 30 jours (hors obligations légales de conservation).</p>

<h2>7. Contact</h2>
<p>Pour toute question relative à vos données ou pour exercer vos droits :<br>
<a href="mailto:gestion@mhpimmo.fr">gestion@mhpimmo.fr</a></p>
</body>
</html>"""


@api_router.get("/privacy")
async def privacy_policy():
    """Page publique de politique de confidentialité (App Store / Play Store)."""
    return HTMLResponse(content=_PRIVACY_HTML)
