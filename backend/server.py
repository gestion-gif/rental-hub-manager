# ruff: noqa: F403, F405
from core import *  # noqa: F401,F403
from core import app, api_router, client
from core import _drain_channex_outbox  # noqa: F401
from core import process_channex_bookings  # noqa: F401

# Import router modules so their endpoints register on api_router
from routers import (  # noqa: F401
    auth, properties, reservations, public_site, interventions, ical, dashboard,
    analytics, ai, preferences, channex, policies, push, sync, inbox, team, owners,
    statements, reviews, promotions, templates, automations, files, messaging,
    accounting, supplements, api_keys, billing,
)

# Route handlers referenced by the background loops below
from routers.statements import owner_statement
from routers.analytics import analytics_kpi


async def _ical_auto_sync_loop():
    """Boucle de synchro iCal automatique : fréquence configurable par logement."""
    await asyncio.sleep(60)  # laisser l'app démarrer
    while True:
        try:
            props = await db.properties.find(
                {"ical_links.0": {"$exists": True}},
                {"_id": 0, "id": 1, "user_id": 1, "ical_last_sync": 1, "ical_sync_frequency": 1}).to_list(2000)
            for p in props:
                freq = p.get("ical_sync_frequency") or "daily"
                threshold = _FREQ_SECONDS.get(freq, _FREQ_SECONDS["daily"])
                last = p.get("ical_last_sync")
                stale = True
                if last:
                    try:
                        stale = (now_utc() - datetime.fromisoformat(last)).total_seconds() > threshold
                    except Exception:
                        stale = True
                if stale:
                    try:
                        await run_ical_sync(p["user_id"], p["id"])
                    except Exception:
                        logger.exception("auto ical sync failed for %s", p.get("id"))
                    await asyncio.sleep(2)  # espacer les appels externes
        except Exception:
            logger.exception("auto ical loop error")
        await asyncio.sleep(3600)  # revérifier chaque heure


async def _ai_draft_loop():
    """Boucle de fond : pré-génère les brouillons IA pour les nouveaux messages voyageurs."""
    await asyncio.sleep(90)
    while True:
        try:
            uids = set(await db.channel_settings.distinct("user_id"))
            uids |= set(await db.channex_settings.distinct("user_id"))
            for uid in uids:
                try:
                    await _generate_drafts_for_user(uid)
                except Exception:
                    logger.exception("ai draft error for %s", uid)
        except Exception:
            logger.exception("ai draft loop error")
        await asyncio.sleep(1800)  # toutes les 30 min


async def _trial_reminder_loop():
    """Quotidien : email de rappel aux comptes en essai à ~4 jours de la fin (J+10)."""
    await asyncio.sleep(240)
    while True:
        try:
            now_iso = now_utc().isoformat()
            limit_iso = (now_utc() + timedelta(days=4)).isoformat()
            users = await db.users.find({
                "billing.exempt": {"$ne": True},
                "billing.status": {"$nin": ["active", "trialing"]},
                "billing.trial_reminder_sent": {"$ne": True},
                "billing.trial_ends_at": {"$gt": now_iso, "$lt": limit_iso},
                "email": {"$nin": [None, ""]},
            }, {"_id": 0, "user_id": 1, "email": 1, "name": 1, "billing": 1}).to_list(200)
            for u in users:
                try:
                    ends = u["billing"].get("trial_ends_at", "")[:10]
                    days = max(1, (datetime.fromisoformat(u["billing"]["trial_ends_at"]) - now_utc()).days)
                    html = f"""
                    <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
                      <h2 style="color:#020830">Votre essai Casanéo se termine bientôt</h2>
                      <p>Bonjour {u.get('name') or ''},</p>
                      <p>Votre essai gratuit se termine dans <strong>{days} jour{'s' if days > 1 else ''}</strong>
                      (le {ends}). Pour continuer à gérer vos réservations, calendriers et messages voyageurs
                      sans interruption, choisissez une formule dès maintenant :</p>
                      <ul>
                        <li><strong>Starter</strong> — 39 €/mois · jusqu'à 3 logements</li>
                        <li><strong>Essentiel</strong> — 79 €/mois · jusqu'à 10 logements</li>
                        <li><strong>Pro</strong> — 149 €/mois · jusqu'à 25 logements</li>
                        <li><strong>Scale</strong> — 249 €/mois · jusqu'à 50 logements</li>
                      </ul>
                      <p>Rendez-vous dans l'app : <strong>Réglages → Abonnement</strong>.</p>
                      <p>Vos données sont conservées en sécurité, même si l'essai expire.</p>
                      <p style="color:#888">L'équipe Casanéo</p>
                    </div>"""
                    await send_email(to=u["email"],
                                     subject=f"⏳ Plus que {days} jour{'s' if days > 1 else ''} d'essai Casanéo",
                                     html=html)
                    await db.users.update_one(
                        {"user_id": u["user_id"]},
                        {"$set": {"billing.trial_reminder_sent": True}})
                    logger.info("trial reminder sent to %s", u["email"])
                except Exception:
                    logger.exception("trial reminder failed for %s", u.get("email"))
        except Exception:
            logger.exception("trial reminder loop error")
        await asyncio.sleep(86400)


async def _channex_msg_review_loop():
    """Toutes les ~10 min : synchronise les fils de discussion (app Messages)
    et les avis OTA (app Reviews) Channex de chaque utilisateur."""
    await asyncio.sleep(60)
    while True:
        try:
            settings = await db.channex_settings.find(
                {"api_key": {"$nin": [None, ""]}}, {"_id": 0, "user_id": 1}).to_list(1000)
            for s in settings:
                try:
                    await sync_channex_threads(s["user_id"], force=True)
                except Exception:
                    logger.exception("channex threads sync error %s", s.get("user_id"))
                try:
                    await sync_channex_reviews(s["user_id"], force=True)
                except Exception:
                    logger.exception("channex reviews sync error %s", s.get("user_id"))
                await asyncio.sleep(2)
        except Exception:
            logger.exception("channex msg/review loop error")
        await asyncio.sleep(600)


app.include_router(api_router)


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def enforce_write_permissions(request, call_next):
    """Seuls le compte principal (Google) et les membres Administrateur peuvent modifier.
    Le personnel de terrain (nettoyage/intervenant) peut uniquement marquer une tâche faite."""
    method = request.method
    path = request.url.path
    if method in ("POST", "PUT", "PATCH", "DELETE") and path.startswith("/api") and path != "/api/auth/logout":
        auth = request.headers.get("authorization", "")
        token = auth[7:].strip() if auth[:7].lower() == "bearer " else None
        if token:
            session = await db.user_sessions.find_one({"session_token": token})
            if session and session.get("kind") == "member":
                member = await db.members.find_one({"id": session.get("member_id")})
                role = (member or {}).get("role", "member")
                if role != "admin":
                    is_field = role in ("cleaning", "intervenant")
                    allowed = is_field and path.startswith("/api/interventions/") and path.endswith("/done")
                    if not allowed:
                        from starlette.responses import JSONResponse
                        return JSONResponse(
                            status_code=403,
                            content={"detail": "Modification réservée à l'administrateur et au compte principal."})
    return await call_next(request)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.properties.create_index("user_id")
    await db.reservations.create_index("user_id")
    await db.interventions.create_index("user_id")
    await db.api_keys.create_index("key_hash", unique=True)
    try:
        from demo_seed import ensure_demo_account
        await ensure_demo_account()
    except Exception:
        logger.exception("demo account seed failed")
    asyncio.create_task(automation_scheduler())
    asyncio.create_task(_ical_auto_sync_loop())
    asyncio.create_task(_lodgify_auto_sync_loop())
    asyncio.create_task(_ai_draft_loop())
    asyncio.create_task(_statement_reminder_loop())
    asyncio.create_task(_monthly_report_loop())
    asyncio.create_task(_public_site_loop())
    asyncio.create_task(_channex_outbox_loop())
    asyncio.create_task(_channex_bookings_loop())
    asyncio.create_task(_channex_msg_review_loop())
    asyncio.create_task(_trial_reminder_loop())
    asyncio.create_task(_payment_reminder_loop())
    asyncio.create_task(_auto_charge_loop())


async def _auto_charge_loop():
    """Toutes les ~6 h : encaissement auto des cartes Booking.com (Channex → Stripe)
    pour les comptes ayant activé l'option, selon leur délai avant arrivée."""
    await asyncio.sleep(150)
    while True:
        try:
            prefs = await db.preferences.find(
                {"auto_charge.enabled": True}, {"_id": 0, "user_id": 1}).to_list(1000)
            for p in prefs:
                try:
                    r = await run_auto_charge_for_user(p["user_id"])
                    if r.get("charged") or r.get("errors"):
                        logger.info("auto-charge %s: %s", p["user_id"], r)
                except Exception:
                    logger.exception("auto charge failed for %s", p["user_id"])
        except Exception:
            logger.exception("auto charge loop error")
        await asyncio.sleep(6 * 3600)


async def _payment_reminder_loop():
    """Toutes les ~4 h : relances de paiement (J-7/J-3) pour les comptes ayant activé l'option."""
    await asyncio.sleep(90)
    while True:
        try:
            docs = await db.preferences.find(
                {"payment_reminders.enabled": True}, {"_id": 0, "user_id": 1}).to_list(1000)
            for doc in docs:
                uid = doc.get("user_id")
                if not uid:
                    continue
                try:
                    await run_payment_reminders_for_user(uid)
                except Exception:
                    logger.exception("relance paiement error %s", uid)
        except Exception:
            logger.exception("payment reminder loop error")
        await asyncio.sleep(4 * 3600)


async def _channex_bookings_loop():
    """Poll de secours du feed des réservations Channex (+ acquittement) toutes les ~90 s.
    Complète le webhook (Channex recommande feed + webhook)."""
    await asyncio.sleep(45)
    while True:
        try:
            settings = await db.channex_settings.find(
                {"api_key": {"$nin": [None, ""]}}, {"_id": 0, "user_id": 1}).to_list(1000)
            for s in settings:
                try:
                    await process_channex_bookings(s["user_id"])
                except Exception:
                    logger.exception("channex bookings poll error %s", s.get("user_id"))
                await asyncio.sleep(2)
        except Exception:
            logger.exception("channex bookings loop error")
        await asyncio.sleep(90)


async def _channex_outbox_loop():
    """Vide la file d'attente ARI→Channex (push delta événementiel) toutes les ~8 s."""
    await asyncio.sleep(20)
    while True:
        try:
            await _drain_channex_outbox()
        except Exception:
            logger.exception("channex outbox loop error")
        await asyncio.sleep(8)


async def _lodgify_auto_sync_loop():
    """Synchronise automatiquement les réservations Lodgify de chaque utilisateur.
    Tick toutes les 5 min ; chaque utilisateur est synchronisé selon son intervalle réglable
    (channel_settings.sync_interval_min, défaut 30 min)."""
    await asyncio.sleep(90)  # laisser le serveur démarrer
    while True:
        try:
            settings = await db.channel_settings.find(
                {}, {"_id": 0, "user_id": 1, "last_sync": 1, "sync_interval_min": 1, "api_key": 1}).to_list(1000)
            now = now_utc()
            for s in settings:
                if not s.get("api_key"):
                    continue
                interval = int(s.get("sync_interval_min") or 30)
                due = True
                ls = s.get("last_sync")
                if ls:
                    try:
                        last = datetime.fromisoformat(ls)
                        due = (now - last) >= timedelta(minutes=interval)
                    except Exception:
                        due = True
                if not due:
                    continue
                try:
                    await run_channel_sync(s["user_id"])
                except Exception:
                    logger.exception("lodgify auto-sync error for %s", s.get("user_id"))
        except Exception:
            logger.exception("lodgify auto-sync loop error")
        await asyncio.sleep(300)


async def automation_scheduler():
    """Every 30 min, send due automatic messages for all connected users."""
    while True:
        try:
            uids = await db.channel_settings.distinct("user_id")
            for uid in uids:
                try:
                    await run_automations_for_user(uid)
                except Exception:
                    logger.exception("automation error for %s", uid)
        except Exception:
            logger.exception("automation scheduler loop error")
        await asyncio.sleep(1800)


async def _statement_reminder_loop():
    """Début de mois : rappelle (email + push) au gestionnaire les relevés du mois
    écoulé restant à envoyer. Envoi unique par mois (collection reminders_sent)."""
    await asyncio.sleep(60)
    while True:
        try:
            today = now_utc().date()
            if today.day <= 7:  # fenêtre "début de mois"
                cur_month = f"{today.year:04d}-{today.month:02d}"
                first = today.replace(day=1)
                prev = first - timedelta(days=1)
                prev_month = f"{prev.year:04d}-{prev.month:02d}"
                owners = await db.users.find({}, {"_id": 0, "user_id": 1, "email": 1, "name": 1}).to_list(1000)
                for u in owners:
                    uid = u.get("user_id")
                    if not uid:
                        continue
                    already = await db.reminders_sent.find_one({"user_id": uid, "month": cur_month, "kind": "statement"})
                    if already:
                        continue
                    fake = {"user_id": uid, "role": "owner", "allowed_property_ids": None, "permissions": []}
                    try:
                        data = await owner_statement(month=prev_month, property_id="", user=fake)
                    except Exception:
                        continue
                    pending = [s for s in (data.get("statements") or [])
                               if (s.get("reservations_count") or 0) > 0 and not s.get("last_sent_at")]
                    if not pending:
                        continue
                    label = data.get("period_label") or prev_month
                    title = "Relevés à envoyer"
                    msg = f"{len(pending)} relevé(s) de {label} restent à envoyer à vos propriétaires."
                    # Push
                    try:
                        await send_push(recipients=[uid], data={"title": title, "message": msg, "action_url": "/statement"},
                                        idempotency_key=f"stmt-{uid}-{cur_month}")
                    except Exception as e:
                        logger.warning("push rappel relevés échoué: %s", e)
                    # Email au gestionnaire
                    email = (u.get("email") or "").strip()
                    if email:
                        items = "".join(f"<li>{escape(str(p.get('property_name') or ''))} — {escape(str(p.get('owner') or ''))}</li>"
                                        for p in pending)
                        html = (f"<div style='font-family:Arial,sans-serif;max-width:560px;margin:auto'>"
                                f"<h2 style='color:#2A6F9E'>Relevés à envoyer — {escape(label)}</h2>"
                                f"<p>{len(pending)} relevé(s) du mois écoulé restent à envoyer :</p>"
                                f"<ul>{items}</ul>"
                                f"<p style='color:#777'>Ouvrez Casanéo → Relevé pour les envoyer.</p></div>")
                        try:
                            await send_email(to=email, subject=f"Casanéo — {len(pending)} relevé(s) à envoyer ({label})", html=html)
                        except Exception as e:
                            logger.warning("email rappel relevés échoué: %s", e)
                    await db.reminders_sent.update_one(
                        {"user_id": uid, "month": cur_month, "kind": "statement"},
                        {"$set": {"user_id": uid, "month": cur_month, "kind": "statement",
                                  "count": len(pending), "sent_at": now_utc().isoformat()}}, upsert=True)
        except Exception:
            logger.exception("statement reminder loop error")
        await asyncio.sleep(6 * 3600)


async def _public_site_loop():
    """Site public : (1) lien de paiement du solde X jours avant l'arrivée,
    (2) rappel d'enregistrement à J-3 si le formulaire n'est pas rempli."""
    await asyncio.sleep(90)
    while True:
        try:
            today = now_utc().date()
            prefs_all = await db.preferences.find({"public_site.enabled": True}, {"_id": 0}).to_list(1000)
            for prefs in prefs_all:
                uid = prefs["user_id"]
                ps = prefs.get("public_site") or {}
                slug = ps.get("slug") or ""
                oc = prefs.get("online_checkin") or {}
                company = _build_company(prefs)
                brand = company.get("name") or "Casanéo"
                bal_days = int(ps.get("balance_days", 7))
                bal_auto = bool(ps.get("balance_auto", True))
                res = await db.reservations.find(
                    {"user_id": uid, "source": "site", "status": "confirmee"}, {"_id": 0}).to_list(3000)
                for r in res:
                    try:
                        ci = date.fromisoformat(r.get("check_in"))
                    except Exception:
                        continue
                    origin = (r.get("public_origin") or "").rstrip("/")
                    logo_url = _logo_url_from_base(origin, company)
                    # (1) Lien de paiement du solde
                    due = round(float((r.get("finance") or {}).get("due") or 0), 2)
                    if (bal_auto and due > 0 and not r.get("balance_link_sent_at")
                            and today <= ci and (ci - today).days <= bal_days):
                        email = (r.get("guest_email") or "").strip()
                        if email and origin and slug:
                            link = f"{origin}/book/{slug}/pay/{r['id']}"
                            html = (
                                "<div style='font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:16px'>"
                                f"{_company_header_html(company, logo_url)}"
                                "<h2 style='color:#111'>Réglez le solde de votre séjour</h2>"
                                f"<p style='color:#555;line-height:22px'>Bonjour {escape(r.get('guest_name') or '')}, "
                                f"votre arrivée à <b>{escape(r.get('property_name') or '')}</b> approche "
                                f"(le {r.get('check_in')}). Il reste <b>{_money(due)}</b> à régler.</p>"
                                f"<a href='{link}' style='display:inline-block;background:#17B0A6;color:#fff;"
                                "text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700'>Payer le solde</a>"
                                f"<p style='color:#aaa;font-size:12px;margin-top:24px'>{escape(brand)}</p></div>"
                            )
                            try:
                                await send_email(to=email, subject=f"{brand} — Solde de votre séjour", html=html)
                                await db.reservations.update_one({"user_id": uid, "id": r["id"]},
                                    {"$set": {"balance_link_sent_at": now_utc().isoformat()}})
                            except Exception as e:
                                logger.warning("email solde échoué: %s", e)
                    # (2) Rappel d'enregistrement J-3
                    if (oc.get("enabled") and oc.get("auto_reminders", True)
                            and not r.get("checkin_submission") and not r.get("checkin_reminder_sent_at")
                            and today <= ci and (ci - today).days <= 3):
                        email = (r.get("guest_email") or "").strip()
                        if email and origin and slug:
                            link = f"{origin}/book/{slug}/checkin/{r['id']}"
                            html = (
                                "<div style='font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:16px'>"
                                f"{_company_header_html(company, logo_url)}"
                                "<h2 style='color:#111'>Complétez votre enregistrement</h2>"
                                f"<p style='color:#555;line-height:22px'>Bonjour {escape(r.get('guest_name') or '')}, "
                                f"votre séjour à <b>{escape(r.get('property_name') or '')}</b> commence bientôt "
                                f"(le {r.get('check_in')}). Merci de compléter votre formulaire d'arrivée.</p>"
                                f"<a href='{link}' style='display:inline-block;background:#2A6F9E;color:#fff;"
                                "text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700'>Compléter mon enregistrement</a>"
                                f"<p style='color:#aaa;font-size:12px;margin-top:24px'>{escape(brand)}</p></div>"
                            )
                            try:
                                await send_email(to=email, subject=f"{brand} — Enregistrement à compléter", html=html)
                                await db.reservations.update_one({"user_id": uid, "id": r["id"]},
                                    {"$set": {"checkin_reminder_sent_at": now_utc().isoformat()}})
                            except Exception as e:
                                logger.warning("email rappel check-in échoué: %s", e)
        except Exception:
            logger.exception("public site loop error")
        await asyncio.sleep(6 * 3600)



        await asyncio.sleep(6 * 3600)


async def _monthly_report_loop():
    """Début de mois : envoie au gestionnaire le rapport d'activité du mois écoulé
    (récap global tous logements). Envoi unique par mois (reminders_sent kind=report)."""
    await asyncio.sleep(120)
    while True:
        try:
            today = now_utc().date()
            if today.day <= 3:
                cur_month = f"{today.year:04d}-{today.month:02d}"
                prev = today.replace(day=1) - timedelta(days=1)
                prev_month = f"{prev.year:04d}-{prev.month:02d}"
                owners = await db.users.find({}, {"_id": 0, "user_id": 1, "email": 1}).to_list(1000)
                for u in owners:
                    uid = u.get("user_id")
                    email = (u.get("email") or "").strip()
                    if not uid or not email:
                        continue
                    prefs = await db.preferences.find_one({"user_id": uid}, {"_id": 0}) or {}
                    if not prefs.get("monthly_report_enabled", True):
                        continue
                    already = await db.reminders_sent.find_one({"user_id": uid, "month": cur_month, "kind": "report"})
                    if already:
                        continue
                    fake = {"user_id": uid, "role": "owner", "allowed_property_ids": None, "permissions": []}
                    try:
                        kpi = await analytics_kpi(month=prev_month, user=fake)
                    except Exception:
                        continue
                    if (kpi.get("totals") or {}).get("reservations", 0) == 0:
                        continue
                    company = _build_company(prefs)
                    base = (await db.channel_settings.find_one({"user_id": uid}) or {}).get("public_base_url", "")
                    logo_url = _logo_url_from_base(base, company)
                    label = kpi.get("period_label") or prev_month
                    html = _monthly_report_html(label, kpi, company, logo_url)
                    try:
                        await send_email(to=email, subject=f"Casanéo — Rapport d'activité {label}", html=html)
                    except Exception as e:
                        logger.warning("email rapport mensuel échoué: %s", e)
                    await db.reminders_sent.update_one(
                        {"user_id": uid, "month": cur_month, "kind": "report"},
                        {"$set": {"user_id": uid, "month": cur_month, "kind": "report",
                                  "sent_at": now_utc().isoformat()}}, upsert=True)
        except Exception:
            logger.exception("monthly report loop error")
        await asyncio.sleep(6 * 3600)


async def shutdown_db_client():
    client.close()

