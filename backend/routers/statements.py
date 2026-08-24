# ruff: noqa: F403, F405
from core import *  # noqa: F401


@api_router.get("/statement-expenses")
async def list_expenses(month: str, property_id: str = "", user=Depends(get_current_user)):
    q = {"user_id": user["user_id"], "month": month, **_prop_scope(user, "property_id")}
    if property_id:
        q["property_id"] = property_id
    docs = await db.statement_expenses.find(q, {"_id": 0}).sort("created_at", 1).to_list(500)
    return docs


@api_router.post("/statement-expenses")
async def create_expense(payload: ExpenseIn, user=Depends(get_current_user)):
    if not payload.label.strip():
        raise HTTPException(status_code=400, detail="Libellé requis")
    doc = payload.dict()
    doc["label"] = doc["label"].strip()
    doc["charge_to"] = doc["charge_to"] if doc["charge_to"] in ("owner", "concierge") else "owner"
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    await db.statement_expenses.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.delete("/statement-expenses/{expense_id}")
async def delete_expense(expense_id: str, user=Depends(get_current_user)):
    await db.statement_expenses.delete_one({"id": expense_id, "user_id": user["user_id"]})
    return {"ok": True}


@api_router.get("/owner-statement")
async def owner_statement(month: str = "", start: str = "", end: str = "",
                          property_id: str = "", user=Depends(get_current_user)):
    """Relevé par logement sur un mois OU une plage de dates : ventilation + revenus.

    Règles: frais de gestion = % logement x nuitées ; ménage -> conciergerie ;
    taxe de séjour -> reversée à la commune ; revenu propriétaire = nuitées -
    frais de gestion - commissions plateforme - dépenses propriétaire.
    Réservations retenues : arrivée (check_in) dans la période, hors annulées.
    """
    start_d, end_d, period_key, period_label = _resolve_period(month, start, end)

    pq = {"user_id": user["user_id"], **_prop_scope(user, "id")}
    if property_id:
        pq["id"] = property_id
    properties = await db.properties.find(pq, {"_id": 0}).to_list(500)

    statements = []
    for p in properties:
        pid = p["id"]
        reservations = await db.reservations.find(
            {"user_id": user["user_id"], "property_id": pid,
             "check_in": {"$gte": start_d, "$lt": end_d}, "status": {"$nin": ["annulee", "bloque"]}},
            {"_id": 0}).sort("check_in", 1).to_list(1000)
        lines = []
        t_nights = t_clean = t_tax = t_comm = 0.0
        t_tax_sejour = t_tax_regional = 0.0
        _tp = float(p.get("tourist_tax_pct") or 0)
        _rp = float(p.get("regional_tax_pct") or 0)
        _tot_pct = _tp + _rp
        for r in reservations:
            a = _res_amounts(r)
            t_nights += a["nights"]; t_clean += a["cleaning"]; t_tax += a["tax"]; t_comm += a["commission"]
            # Répartition taxe de séjour / taxe additionnelle régionale (proportionnelle aux taux du logement)
            if _tot_pct > 0:
                sej = round(a["tax"] * _tp / _tot_pct, 2)
            else:
                sej = a["tax"]
            reg = round(a["tax"] - sej, 2)
            t_tax_sejour += sej; t_tax_regional += reg
            lines.append({
                "id": r.get("id"), "guest_name": r.get("guest_name"),
                "platform": r.get("platform"), "check_in": r.get("check_in"),
                "check_out": r.get("check_out"), **a,
            })
        expenses = await db.statement_expenses.find(
            {"user_id": user["user_id"], "property_id": pid, "month": period_key}, {"_id": 0}).to_list(500)
        owner_exp = round(sum(float(e.get("amount") or 0) for e in expenses if e.get("charge_to") == "owner"), 2)
        concierge_exp = round(sum(float(e.get("amount") or 0) for e in expenses if e.get("charge_to") == "concierge"), 2)

        pct = float(p.get("management_fee_pct") or 0)
        mgmt_fee = round(t_nights * pct / 100.0, 2)
        # Commission OTA : override manuel éventuel (par logement/période) sinon somme auto
        ov = await db.statement_overrides.find_one(
            {"user_id": user["user_id"], "property_id": pid, "month": period_key}, {"_id": 0})
        comm_override = None
        if ov and ov.get("commission") is not None:
            comm_override = round(float(ov.get("commission") or 0), 2)
        eff_comm = comm_override if comm_override is not None else round(t_comm, 2)
        owner_revenue = round(t_nights - mgmt_fee - eff_comm - owner_exp, 2)
        concierge_revenue = round(mgmt_fee + t_clean - concierge_exp, 2)

        send_log = await db.statement_sends.find_one(
            {"user_id": user["user_id"], "property_id": pid, "month": period_key}, {"_id": 0})

        statements.append({
            "property_id": pid, "property_name": p.get("name"), "owner": p.get("owner"),
            "management_fee_pct": pct, "reservations_count": len(lines), "lines": lines,
            "last_sent_at": (send_log or {}).get("sent_at"),
            "last_sent_to": (send_log or {}).get("to"),
            "totals": {
                "nights": round(t_nights, 2), "cleaning": round(t_clean, 2),
                "tax": round(t_tax, 2), "commission": eff_comm,
                "tax_sejour": round(t_tax_sejour, 2), "tax_regional": round(t_tax_regional, 2),
                "commission_auto": round(t_comm, 2), "commission_override": comm_override,
                "management_fee": mgmt_fee, "owner_expenses": owner_exp,
                "concierge_expenses": concierge_exp,
                "owner_revenue": owner_revenue, "concierge_revenue": concierge_revenue,
                "tourist_tax_to_reverse": round(t_tax, 2),
            },
            "expenses": expenses,
        })
    return {"month": period_key, "period_key": period_key, "period_label": period_label, "statements": statements}


@api_router.put("/statement-commission")
async def set_statement_commission(payload: CommissionOverrideIn, user=Depends(get_current_user)):
    """Fixe (ou réinitialise) la commission OTA du relevé pour un logement/mois."""
    uid = user["user_id"]
    q = {"user_id": uid, "property_id": payload.property_id, "month": payload.month}
    if payload.commission is None:
        await db.statement_overrides.delete_one(q)
        return {"commission_override": None}
    val = round(float(payload.commission), 2)
    await db.statement_overrides.update_one(q, {"$set": {**q, "commission": val}}, upsert=True)
    return {"commission_override": val}


@api_router.post("/owner-statement/email")
async def email_owner_statement(payload: StatementEmailIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    prop = await db.properties.find_one({"id": payload.property_id, "user_id": uid}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Logement introuvable")
    owner_email = ""
    owner_name = prop.get("owner") or ""
    if prop.get("owner_id"):
        owner = await db.owners.find_one({"id": prop["owner_id"], "user_id": uid}, {"_id": 0})
        if owner:
            owner_email = (owner.get("email") or "").strip()
            owner_name = owner.get("name") or owner_name
    if not owner_email:
        return {"sent": False, "reason": "no_owner_email"}
    data = await owner_statement(month=payload.month, start=payload.start, end=payload.end,
                                 property_id=payload.property_id, user=user)
    stmts = data.get("statements") or []
    if not stmts:
        return {"sent": False, "reason": "no_data"}
    s = stmts[0]
    period_key = data.get("period_key")
    period_label = data.get("period_label")
    prefs = await db.preferences.find_one({"user_id": uid}, {"_id": 0})
    company = _build_company(prefs)
    logo_url = _logo_url_from_base(payload.base_url or (await db.channel_settings.find_one({"user_id": uid}) or {}).get("public_base_url", ""), company)
    subject = f"Relevé {period_label} — {s.get('property_name')}"
    html = _statement_html(payload.month, s, company, logo_url, period_label)
    await send_email(to=owner_email, subject=subject, html=html)
    await _record_statement_send(uid, payload.property_id, period_key, owner_email)
    return {"sent": True, "to": owner_email, "owner_name": owner_name}


@api_router.post("/owner-statement/email-all")
async def email_all_owner_statements(payload: StatementEmailAllIn, user=Depends(get_current_user)):
    """Envoie à chaque propriétaire UN SEUL email regroupant tous ses logements pour la période."""
    uid = user["user_id"]
    data = await owner_statement(month=payload.month, start=payload.start, end=payload.end,
                                 property_id="", user=user)
    stmts = data.get("statements") or []
    if not stmts:
        return {"sent": 0, "results": [], "reason": "no_data"}
    period_key = data.get("period_key")
    period_label = data.get("period_label")

    # Regroupe les logements par propriétaire (owner_id)
    prop_ids = [s["property_id"] for s in stmts]
    props = await db.properties.find({"user_id": uid, "id": {"$in": prop_ids}}, {"_id": 0}).to_list(500)
    prop_by_id = {p["id"]: p for p in props}

    groups: dict = {}
    for s in stmts:
        p = prop_by_id.get(s["property_id"], {})
        oid = p.get("owner_id") or f"__noid__{s['property_id']}"
        groups.setdefault(oid, {"owner_id": p.get("owner_id"), "owner_fallback": p.get("owner") or "", "statements": []})
        groups[oid]["statements"].append(s)

    prefs = await db.preferences.find_one({"user_id": uid}, {"_id": 0})
    company = _build_company(prefs)
    logo_url = _logo_url_from_base(payload.base_url or (await db.channel_settings.find_one({"user_id": uid}) or {}).get("public_base_url", ""), company)

    results = []
    sent = 0
    for grp in groups.values():
        owner_email = ""
        owner_name = grp["owner_fallback"]
        if grp["owner_id"]:
            owner = await db.owners.find_one({"id": grp["owner_id"], "user_id": uid}, {"_id": 0})
            if owner:
                owner_email = (owner.get("email") or "").strip()
                owner_name = owner.get("name") or owner_name
        names = ", ".join(st.get("property_name") or "" for st in grp["statements"])
        if not owner_email:
            results.append({"owner_name": owner_name or "?", "properties": names, "sent": False, "reason": "no_owner_email"})
            continue
        subject = f"Relevé {period_label} — {owner_name}" if owner_name else f"Relevé {period_label}"
        html = _combined_statement_html(payload.month, grp["statements"], owner_name, company, logo_url, period_label)
        await send_email(to=owner_email, subject=subject, html=html)
        for st in grp["statements"]:
            await _record_statement_send(uid, st["property_id"], period_key, owner_email)
        sent += 1
        results.append({"owner_name": owner_name, "properties": names, "sent": True, "to": owner_email})
    return {"sent": sent, "results": results}


@api_router.get("/owner-statement/pending-send")
async def owner_statement_pending_send(month: str = "", user=Depends(get_current_user)):
    """Relevés du mois écoulé (par défaut) non encore envoyés au propriétaire.
    Un logement est 'à envoyer' s'il a des réservations sur la période, un propriétaire
    avec email, et aucun enregistrement d'envoi (statement_sends) pour cette période."""
    uid = user["user_id"]
    if not month:
        today = now_utc().date()
        first = today.replace(day=1)
        prev = first - timedelta(days=1)
        month = f"{prev.year:04d}-{prev.month:02d}"
    data = await owner_statement(month=month, property_id="", user=user)
    stmts = data.get("statements") or []
    period_key = data.get("period_key")
    period_label = data.get("period_label")
    pending = []
    for s in stmts:
        if (s.get("reservations_count") or 0) == 0:
            continue
        if s.get("last_sent_at"):
            continue
        # propriétaire avec email ?
        prop = await db.properties.find_one({"id": s["property_id"], "user_id": uid}, {"_id": 0})
        owner_email = ""
        owner_name = (prop or {}).get("owner") or ""
        if prop and prop.get("owner_id"):
            owner = await db.owners.find_one({"id": prop["owner_id"], "user_id": uid}, {"_id": 0})
            if owner:
                owner_email = (owner.get("email") or "").strip()
                owner_name = owner.get("name") or owner_name
        pending.append({
            "property_id": s["property_id"], "property_name": s.get("property_name"),
            "owner_name": owner_name, "has_owner_email": bool(owner_email),
            "owner_revenue": s["totals"].get("owner_revenue"),
        })
    return {"month": month, "period_key": period_key, "period_label": period_label,
            "count": len(pending), "pending": pending}

