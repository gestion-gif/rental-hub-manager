# ruff: noqa: F403, F405
from core import *  # noqa: F401


@api_router.get("/preferences")
async def get_preferences(user=Depends(get_current_user)):
    doc = await db.preferences.find_one({"user_id": user["user_id"]}, {"_id": 0})
    statuses = _build_statuses(doc)
    return {
        "statuses": statuses,
        "status_colors": {s["key"]: s["color"] for s in statuses},
        "commission_rates": _build_commission_rates(doc),
        "payment_methods": _build_payment_methods(doc),
        "ai_auto_draft": bool((doc or {}).get("ai_auto_draft", True)),
        "vat_subjected": bool((doc or {}).get("vat_subjected", False)),
        "company": _build_company(doc),
        "online_checkin": _build_checkin(doc),
        "monthly_report_enabled": bool((doc or {}).get("monthly_report_enabled", True)),
        "review_request_enabled": bool((doc or {}).get("review_request_enabled", False)),
        "review_request_days": int((doc or {}).get("review_request_days", 1)),
        "cleaning_offset_days": int((doc or {}).get("cleaning_offset_days", 0)),
        "getyourguide_url": (doc or {}).get("getyourguide_url", "") or "",
        "payment_reminders": _build_payment_reminders(doc),
        "auto_charge": _build_auto_charge(doc),
        "arrival_email": _build_arrival_email(doc),
        "public_site": _build_public_site(doc),
    }


@api_router.get("/preferences/arrival-email-preview")
async def arrival_email_preview(property_id: Optional[str] = None, user=Depends(get_current_user)):
    """Aperçu de l'email d'arrivée tel que le voyageur le recevra, pour un logement donné."""
    uid = user["user_id"]
    doc = await db.preferences.find_one({"user_id": uid}, {"_id": 0}) or {}
    cfg = _build_arrival_email(doc)
    q = {"user_id": uid}
    if property_id:
        q["id"] = property_id
    prop = await db.properties.find_one(q, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Logement introuvable")
    brand = _build_company(doc).get("name") or "Casanéo"
    ch = await db.channel_settings.find_one({"user_id": uid}, {"_id": 0}) or {}
    base = (ch.get("public_base_url") or "").rstrip("/")
    ci = date.today() + timedelta(days=max(cfg["days_before"], 1))
    sample = {"guest_name": "Jean Dupont", "property_name": prop.get("name"),
              "check_in": ci.isoformat(), "check_out": (ci + timedelta(days=3)).isoformat(),
              "checkin_time": "16:00"}
    content = _compose_arrival_email(brand, sample, prop, base, (cfg.get("extra_message") or "").strip())
    if not content:
        return {"empty": True, "property_name": prop.get("name")}
    return {"empty": False, "subject": content["subject"], "parts": content["parts"],
            "days_before": cfg["days_before"], "property_name": prop.get("name")}


@api_router.put("/preferences")
async def update_preferences(payload: PreferencesIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    set_doc = {"user_id": uid}

    if payload.statuses is not None or payload.status_colors is not None:
        if payload.statuses is not None:
            cleaned = []
            seen = set()
            for s in payload.statuses:
                key = str(s.get("key") or "").strip()
                label = str(s.get("label") or "").strip()
                color = str(s.get("color") or "#8E8E93").strip()
                if not key or key in seen:
                    continue
                seen.add(key)
                cleaned.append({"key": key, "label": label or key, "color": color})
            # Always keep the core statuses so existing reservations stay valid
            for d in DEFAULT_STATUSES:
                if d["key"] not in seen:
                    cleaned.append(d)
                    seen.add(d["key"])
            statuses = cleaned
        else:
            colors = {**DEFAULT_STATUS_COLORS, **(payload.status_colors or {})}
            statuses = [{**s, "color": colors.get(s["key"], s["color"])} for s in DEFAULT_STATUSES]
        set_doc["statuses"] = statuses
        set_doc["status_colors"] = {s["key"]: s["color"] for s in statuses}

    if payload.commission_rates is not None:
        rates = {}
        for k, v in payload.commission_rates.items():
            try:
                rates[str(k)] = max(0.0, min(100.0, float(v)))
            except Exception:
                continue
        set_doc["commission_rates"] = {**DEFAULT_COMMISSION_RATES, **rates}

    if payload.payment_methods is not None:
        pm = {}
        for k in DEFAULT_PAYMENT_METHODS:
            if k in payload.payment_methods:
                pm[k] = bool(payload.payment_methods[k])
        set_doc["payment_methods"] = {**DEFAULT_PAYMENT_METHODS, **pm}

    if payload.ai_auto_draft is not None:
        set_doc["ai_auto_draft"] = bool(payload.ai_auto_draft)

    if payload.vat_subjected is not None:
        set_doc["vat_subjected"] = bool(payload.vat_subjected)

    if payload.payment_reminders is not None:
        c = payload.payment_reminders or {}
        mode = c.get("mode") if c.get("mode") in ("all", "direct") else "all"
        excl = [str(p).strip() for p in (c.get("excluded_platforms") or []) if str(p).strip()][:10]
        days = []
        for d in (c.get("days") or [7, 3]):
            try:
                v = int(d)
                if 1 <= v <= 30 and v not in days:
                    days.append(v)
            except Exception:
                continue
        set_doc["payment_reminders"] = {
            "enabled": bool(c.get("enabled", False)), "mode": mode,
            "excluded_platforms": excl, "days": sorted(days or [7, 3], reverse=True),
        }

    if payload.auto_charge is not None:
        c = payload.auto_charge or {}
        try:
            days = int(c.get("days_before", 60))
        except Exception:
            days = 60
        set_doc["auto_charge"] = {"enabled": bool(c.get("enabled", False)),
                                  "days_before": max(1, min(365, days))}

    if payload.arrival_email is not None:
        c = payload.arrival_email or {}
        try:
            days = int(c.get("days_before", 2))
        except Exception:
            days = 2
        set_doc["arrival_email"] = {
            "enabled": bool(c.get("enabled", False)),
            "days_before": max(0, min(14, days)),
            "extra_message": str(c.get("extra_message") or "").strip()[:1500],
        }

    if payload.company is not None:
        set_doc["company"] = {k: str(payload.company.get(k) or "").strip() for k in _COMPANY_KEYS}

    if payload.online_checkin is not None:
        c = payload.online_checkin or {}
        pre_in = c.get("predefined") or {}
        predefined = {k: bool(pre_in.get(k, DEFAULT_CHECKIN["predefined"][k])) for k in CHECKIN_PREDEFINED_KEYS}
        predefined["guests_count"] = True  # toujours obligatoire
        custom = []
        for q in (c.get("custom_questions") or [])[:5]:
            label = str((q or {}).get("label") or "").strip()
            if label:
                custom.append({"id": str((q or {}).get("id") or uuid.uuid4().hex[:8]), "label": label})
        set_doc["online_checkin"] = {
            "enabled": bool(c.get("enabled", False)),
            "require_before_arrival": bool(c.get("require_before_arrival", False)),
            "auto_reminders": bool(c.get("auto_reminders", True)),
            "predefined": predefined,
            "custom_questions": custom,
        }

    if payload.monthly_report_enabled is not None:
        set_doc["monthly_report_enabled"] = bool(payload.monthly_report_enabled)
    if payload.review_request_enabled is not None:
        set_doc["review_request_enabled"] = bool(payload.review_request_enabled)
    if payload.review_request_days is not None:
        set_doc["review_request_days"] = max(0, min(30, int(payload.review_request_days)))

    cleaning_offset_changed = False
    if payload.cleaning_offset_days is not None:
        new_offset = max(0, min(14, int(payload.cleaning_offset_days)))
        prev = await db.preferences.find_one({"user_id": uid}, {"_id": 0, "cleaning_offset_days": 1})
        if int((prev or {}).get("cleaning_offset_days", 0)) != new_offset:
            cleaning_offset_changed = True
        set_doc["cleaning_offset_days"] = new_offset

    if payload.getyourguide_url is not None:
        set_doc["getyourguide_url"] = str(payload.getyourguide_url or "").strip()

    if payload.public_site is not None:
        ps = payload.public_site or {}
        existing = await db.preferences.find_one({"user_id": uid}, {"_id": 0})
        cur = (existing or {}).get("public_site") or {}
        slug = str(ps.get("slug") or cur.get("slug") or "").strip().lower()
        if not slug:
            comp = (existing or {}).get("company") or {}
            slug = _slugify(comp.get("name") or ps.get("name") or "site")
        else:
            slug = _slugify(slug)
        # unicité du slug entre comptes
        clash = await db.preferences.find_one(
            {"public_site.slug": slug, "user_id": {"$ne": uid}}, {"_id": 0})
        if clash:
            slug = f"{slug}-{uid[:6]}"
        dep = ps["deposit_policy_id"] if ("deposit_policy_id" in ps) else cur.get("deposit_policy_id")
        cur_sc = cur.get("showcase") or {}
        sc_in = ps.get("showcase") if isinstance(ps.get("showcase"), dict) else None
        showcase = {
            "enabled": bool((sc_in or {}).get("enabled", cur_sc.get("enabled", False))),
            "title": str((sc_in or {}).get("title", cur_sc.get("title", "")) or ""),
            "intro": str((sc_in or {}).get("intro", cur_sc.get("intro", "")) or ""),
            "hero_photo": str((sc_in or {}).get("hero_photo", cur_sc.get("hero_photo", "")) or ""),
        }
        set_doc["public_site"] = {
            "enabled": bool(ps.get("enabled", False)), "slug": slug,
            "deposit_policy_id": str(dep or ""),
            "balance_auto": bool(ps.get("balance_auto", cur.get("balance_auto", True))),
            "balance_days": int(ps.get("balance_days", cur.get("balance_days", 7))),
            "showcase": showcase,
        }

    await db.preferences.update_one({"user_id": uid}, {"$set": set_doc}, upsert=True)
    if cleaning_offset_changed:
        await regenerate_auto_cleanings(uid)
    doc = await db.preferences.find_one({"user_id": uid}, {"_id": 0})
    statuses = _build_statuses(doc)
    return {
        "statuses": statuses,
        "status_colors": {s["key"]: s["color"] for s in statuses},
        "commission_rates": _build_commission_rates(doc),
        "payment_methods": _build_payment_methods(doc),
        "ai_auto_draft": bool((doc or {}).get("ai_auto_draft", True)),
        "vat_subjected": bool((doc or {}).get("vat_subjected", False)),
        "company": _build_company(doc),
        "online_checkin": _build_checkin(doc),
        "monthly_report_enabled": bool((doc or {}).get("monthly_report_enabled", True)),
        "review_request_enabled": bool((doc or {}).get("review_request_enabled", False)),
        "review_request_days": int((doc or {}).get("review_request_days", 1)),
        "cleaning_offset_days": int((doc or {}).get("cleaning_offset_days", 0)),
        "getyourguide_url": (doc or {}).get("getyourguide_url", "") or "",
        "payment_reminders": _build_payment_reminders(doc),
        "arrival_email": _build_arrival_email(doc),
        "public_site": _build_public_site(doc),
    }

