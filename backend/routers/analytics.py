# ruff: noqa: F403, F405
from core import *  # noqa: F401


@api_router.get("/analytics/revenue")
async def analytics_revenue(year: Optional[int] = None, user=Depends(get_current_user)):
    if not _can(user, "view_revenue_charts"):
        raise HTTPException(status_code=403, detail="Accès aux revenus non autorisé")
    uid = user["user_id"]
    y = year or date.today().year
    props = await db.properties.find({"user_id": uid, **_prop_scope(user)}, {"_id": 0}).to_list(500)
    reservations = await db.reservations.find(
        {"user_id": uid, "status": {"$ne": "annulee"}, **_prop_scope(user, "property_id")}, {"_id": 0}).to_list(5000)

    def parse(d):
        try:
            return date.fromisoformat(d)
        except Exception:
            return None

    # Structure: per property → 12 mois {revenue, nights}
    per_prop = {p["id"]: {"revenue": [0.0] * 12, "nights": [0] * 12} for p in props}
    for r in reservations:
        pid = r.get("property_id")
        if pid not in per_prop:
            continue
        ci, co = parse(r.get("check_in")), parse(r.get("check_out"))
        if not ci or not co or co <= ci:
            continue
        total_nights = (co - ci).days
        fin = r.get("finance") or {}
        price = float(fin.get("total") or r.get("total_price") or 0)
        # Répartir les nuits (et le revenu au prorata) sur chaque mois de l'année demandée
        cur = ci
        while cur < co:
            if cur.year == y:
                m = cur.month - 1
                per_prop[pid]["nights"][m] += 1
                if total_nights > 0:
                    per_prop[pid]["revenue"][m] += price / total_nights
            cur = cur + timedelta(days=1)

    out_props = []
    totals_rev = [0.0] * 12
    totals_nights = [0] * 12
    days_per_month = [pycalendar.monthrange(y, m)[1] for m in range(1, 13)]
    for p in props:
        d = per_prop[p["id"]]
        monthly = []
        for m in range(12):
            rev = round(d["revenue"][m])
            nights = d["nights"][m]
            occ = round(min(nights / days_per_month[m] * 100, 100)) if days_per_month[m] else 0
            monthly.append({"month": m + 1, "revenue": rev, "nights": nights, "occupancy": occ})
            totals_rev[m] += d["revenue"][m]
            totals_nights[m] += nights
        total_rev = round(sum(d["revenue"]))
        total_nights_p = sum(d["nights"])
        avg_occ = round(min(total_nights_p / sum(days_per_month) * 100, 100)) if props else 0
        out_props.append({
            "id": p["id"], "name": p.get("name", "Logement"),
            "monthly": monthly, "total_revenue": total_rev, "avg_occupancy": avg_occ,
        })

    n_props = max(len(props), 1)
    totals_monthly = []
    for m in range(12):
        occ = round(min(totals_nights[m] / (days_per_month[m] * n_props) * 100, 100)) if days_per_month[m] else 0
        totals_monthly.append({"month": m + 1, "revenue": round(totals_rev[m]), "nights": totals_nights[m], "occupancy": occ})
    total_rev_all = round(sum(totals_rev))
    avg_occ_all = round(min(sum(totals_nights) / (sum(days_per_month) * n_props) * 100, 100))

    return {
        "year": y,
        "properties": out_props,
        "totals": {
            "monthly": totals_monthly,
            "total_revenue": total_rev_all,
            "avg_occupancy": avg_occ_all,
        },
    }


@api_router.get("/analytics/kpi")
async def analytics_kpi(month: str = "", start: str = "", end: str = "",
                        user=Depends(get_current_user)):
    """Synthèse conciergerie sur une période (mois OU plage) : revenus conciergerie
    vs propriétaires, frais de gestion, commissions, taux d'occupation global,
    top logements. Réutilise les règles comptables du relevé propriétaire."""
    if not _can(user, "view_revenue_charts"):
        raise HTTPException(status_code=403, detail="Accès aux revenus non autorisé")
    uid = user["user_id"]
    if not (month or (start and end)):
        month = date.today().strftime("%Y-%m")
    start_d, end_excl, period_key, period_label = _resolve_period(month, start, end)
    sd = date.fromisoformat(start_d)
    ed = date.fromisoformat(end_excl)  # exclusive
    period_days = max((ed - sd).days, 1)

    props = await db.properties.find(
        {"user_id": uid, **_prop_scope(user)}, {"_id": 0}).to_list(500)

    reservations = await db.reservations.find(
        {"user_id": uid, "property_id": {"$in": [p["id"] for p in props]},
         "check_in": {"$gte": start_d, "$lt": end_excl},
         "status": {"$nin": ["annulee", "bloque"]}}, {"_id": 0}).to_list(5000)

    by_prop = {p["id"]: [] for p in props}
    for r in reservations:
        pid = r.get("property_id")
        if pid in by_prop:
            by_prop[pid].append(r)

    # Nuits réservées sur la période (pour l'occupation) — tous statuts occupants
    occ_res = await db.reservations.find(
        {"user_id": uid, "property_id": {"$in": [p["id"] for p in props]},
         "status": {"$nin": ["annulee"]},
         "check_in": {"$lt": end_excl}, "check_out": {"$gt": start_d}}, {"_id": 0}).to_list(5000)
    nights_by_prop = {p["id"]: 0 for p in props}
    for r in occ_res:
        pid = r.get("property_id")
        if pid not in nights_by_prop:
            continue
        try:
            ci = max(date.fromisoformat(r.get("check_in")), sd)
            co = min(date.fromisoformat(r.get("check_out")), ed)
        except Exception:
            continue
        if co > ci:
            nights_by_prop[pid] += (co - ci).days

    tot = {"nights": 0.0, "cleaning": 0.0, "tax": 0.0, "commission": 0.0,
           "management_fee": 0.0, "owner_revenue": 0.0, "concierge_revenue": 0.0,
           "reservations": 0, "booked_nights": 0}
    per_property = []
    for p in props:
        pid = p["id"]
        rs = by_prop.get(pid, [])
        t_nights = t_clean = t_tax = t_comm = 0.0
        for r in rs:
            a = _res_amounts(r)
            t_nights += a["nights"]; t_clean += a["cleaning"]
            t_tax += a["tax"]; t_comm += a["commission"]
        # dépenses & override commission (mois uniquement — cohérent avec le relevé)
        expenses = await db.statement_expenses.find(
            {"user_id": uid, "property_id": pid, "month": period_key}, {"_id": 0}).to_list(500)
        owner_exp = round(sum(float(e.get("amount") or 0) for e in expenses if e.get("charge_to") == "owner"), 2)
        concierge_exp = round(sum(float(e.get("amount") or 0) for e in expenses if e.get("charge_to") == "concierge"), 2)
        ov = await db.statement_overrides.find_one(
            {"user_id": uid, "property_id": pid, "month": period_key}, {"_id": 0})
        eff_comm = round(float(ov.get("commission") or 0), 2) if (ov and ov.get("commission") is not None) else round(t_comm, 2)
        pct = float(p.get("management_fee_pct") or 0)
        mgmt_fee = round(t_nights * pct / 100.0, 2)
        owner_rev = round(t_nights - mgmt_fee - eff_comm - owner_exp, 2)
        concierge_rev = round(mgmt_fee + t_clean - concierge_exp, 2)
        booked = nights_by_prop.get(pid, 0)
        occ = round(min(booked / period_days * 100, 100)) if period_days else 0

        tot["nights"] += t_nights; tot["cleaning"] += t_clean
        tot["tax"] += t_tax; tot["commission"] += eff_comm
        tot["management_fee"] += mgmt_fee
        tot["owner_revenue"] += owner_rev
        tot["concierge_revenue"] += concierge_rev
        tot["reservations"] += len(rs)
        tot["booked_nights"] += booked

        per_property.append({
            "id": pid, "name": p.get("name", "Logement"),
            "nights_revenue": round(t_nights, 2), "cleaning": round(t_clean, 2),
            "commission": eff_comm, "management_fee": mgmt_fee,
            "owner_revenue": owner_rev, "concierge_revenue": concierge_rev,
            "reservations": len(rs), "booked_nights": booked, "occupancy": occ,
        })

    n_props = max(len(props), 1)
    occ_all = round(min(tot["booked_nights"] / (period_days * n_props) * 100, 100)) if period_days else 0
    top_by_revenue = sorted(per_property, key=lambda x: -x["concierge_revenue"])[:5]
    top_by_occupancy = sorted(per_property, key=lambda x: -x["occupancy"])[:5]

    return {
        "period_key": period_key, "period_label": period_label,
        "period_days": period_days, "properties_count": len(props),
        "totals": {k: (round(v, 2) if isinstance(v, float) else v) for k, v in tot.items()},
        "occupancy_all": occ_all,
        "per_property": per_property,
        "top_by_revenue": top_by_revenue,
        "top_by_occupancy": top_by_occupancy,
    }


@api_router.get("/properties/{property_id}/dynamic-pricing")
async def dynamic_pricing(property_id: str, start: str = "", end: str = "", user=Depends(get_current_user)):
    """Suggestions de prix/nuit (à valider) basées sur : prix des logements comparables
    du même secteur (même ville, capacité proche), taux d'occupation du logement, et
    règles (anticipation longue, haute saison, week-end). Retour par jour."""
    uid = user["user_id"]
    prop = await db.properties.find_one(
        {"id": property_id, "user_id": uid, **_prop_scope(user)}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    cfg = {**DEFAULT_DYNAMIC_PRICING, **((prop.get("dynamic_pricing") or {}))}

    try:
        sd = date.fromisoformat(start) if start else date.today().replace(day=1)
        ed = date.fromisoformat(end) if end else (sd + timedelta(days=31))
    except Exception:
        raise HTTPException(status_code=400, detail="Dates invalides (YYYY-MM-DD)")
    if ed < sd:
        ed = sd + timedelta(days=31)
    ed = min(ed, sd + timedelta(days=95))  # borne de sécurité

    # Comparables : même ville (sinon tout le portefeuille), capacité ±2, hors soi-même
    city = (prop.get("city") or prop.get("location") or "").strip().lower()
    cap = int(prop.get("capacity") or 0)
    all_props = await db.properties.find({"user_id": uid}, {"_id": 0}).to_list(500)
    comps = []
    for p in all_props:
        if p["id"] == property_id:
            continue
        pcity = (p.get("city") or p.get("location") or "").strip().lower()
        if city and pcity and city != pcity:
            continue
        if cap and p.get("capacity") and abs(int(p["capacity"]) - cap) > 2:
            continue
        comps.append(p)
    if not comps:  # repli : tout le portefeuille (hors soi)
        comps = [p for p in all_props if p["id"] != property_id]

    # Occupation prospective du logement (30 prochains jours à partir de sd)
    win_end = sd + timedelta(days=30)
    occ_res = await db.reservations.find(
        {"user_id": uid, "property_id": property_id, "status": {"$nin": ["annulee"]},
         "check_in": {"$lt": win_end.isoformat()}, "check_out": {"$gt": sd.isoformat()}}, {"_id": 0}).to_list(500)
    booked = 0
    for r in occ_res:
        try:
            ci = max(date.fromisoformat(r["check_in"]), sd)
            co = min(date.fromisoformat(r["check_out"]), win_end)
            if co > ci:
                booked += (co - ci).days
        except Exception:
            pass
    occ_rate = round(min(booked / 30 * 100, 100))

    mw = max(0.0, min(1.0, float(cfg["market_weight"]) / 100.0))
    today = date.today()
    days = []
    cur = sd
    while cur < ed:
        dstr = cur.isoformat()
        base = _price_for_day(prop, dstr)
        comp_prices = [_price_for_day(c, dstr) for c in comps if _price_for_day(c, dstr) > 0]
        market = round(sum(comp_prices) / len(comp_prices), 2) if comp_prices else base
        ref = base * (1 - mw) + market * mw
        factors = []
        adj = 0.0
        # Week-end
        if cur.weekday() in (4, 5):  # vendredi, samedi
            adj += float(cfg["weekend_pct"]); factors.append("week-end")
        # Haute saison
        if _is_high_season(prop, dstr):
            adj += float(cfg["high_season_pct"]); factors.append("haute saison")
        # Anticipation
        lead = (cur - today).days
        if lead >= int(cfg["lead_long_days"]):
            adj += float(cfg["lead_long_pct"]); factors.append("anticipation")
        elif 0 <= lead <= int(cfg["lead_last_days"]):
            adj += float(cfg["lead_last_pct"]); factors.append("dernière minute")
        # Occupation
        if occ_rate >= 70:
            adj += float(cfg["occ_high_pct"]); factors.append("forte occupation")
        elif occ_rate <= 30:
            adj += float(cfg["occ_low_pct"]); factors.append("faible occupation")
        suggested = ref * (1 + adj / 100.0)
        if float(cfg["min_price"]) > 0:
            suggested = max(suggested, float(cfg["min_price"]))
        if float(cfg["max_price"]) > 0:
            suggested = min(suggested, float(cfg["max_price"]))
        suggested = round(suggested)
        days.append({"date": dstr, "base": round(base), "market": round(market),
                     "suggested": suggested, "factors": factors,
                     "delta": suggested - round(base)})
        cur += timedelta(days=1)

    return {
        "property_id": property_id, "config": cfg, "occupancy_rate": occ_rate,
        "comps_count": len(comps), "market_city": prop.get("city") or prop.get("location") or "",
        "days": days,
    }


@api_router.post("/reports/monthly-activity/send")
async def send_monthly_report(payload: MonthlyReportIn, user=Depends(get_current_user)):
    """Génère et envoie par email au gestionnaire le récap global du mois (défaut : mois écoulé)."""
    if not _can(user, "view_revenue_charts"):
        raise HTTPException(status_code=403, detail="Accès aux revenus non autorisé")
    uid = user["user_id"]
    month = payload.month
    if not month:
        today = now_utc().date()
        prev = today.replace(day=1) - timedelta(days=1)
        month = f"{prev.year:04d}-{prev.month:02d}"
    kpi = await analytics_kpi(month=month, user=user)
    u = await db.users.find_one({"user_id": uid}, {"_id": 0})
    email = (u or {}).get("email", "").strip()
    if not email:
        return {"sent": False, "reason": "no_manager_email"}
    prefs = await db.preferences.find_one({"user_id": uid}, {"_id": 0})
    company = _build_company(prefs)
    logo_url = _logo_url_from_base(
        payload.base_url or (await db.channel_settings.find_one({"user_id": uid}) or {}).get("public_base_url", ""), company)
    label = kpi.get("period_label") or month
    html = _monthly_report_html(label, kpi, company, logo_url)
    await send_email(to=email, subject=f"Casanéo — Rapport d'activité {label}", html=html)
    return {"sent": True, "to": email, "period_label": label}

