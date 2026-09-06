# ruff: noqa: F403, F405
from core import *  # noqa: F401


@api_router.get("/interventions")
async def list_interventions(property_id: Optional[str] = None, user=Depends(get_current_user)):
    query = {"user_id": user["user_id"], **_prop_scope(user, "property_id")}
    if property_id:
        query["property_id"] = property_id
    # Les ménages passés sont conservés (historique) mais exclus de la liste courante
    today_iso = date.today().isoformat()
    query["$or"] = [{"kind": {"$ne": "menage"}}, {"date": {"$gte": today_iso}}]
    items = await db.interventions.find(query, {"_id": 0}).sort("date", 1).to_list(1000)
    return items


@api_router.get("/cleaning-history")
async def cleaning_history(property_id: Optional[str] = None, user=Depends(get_current_user)):
    """Historique des ménages : passés + ceux du jour déjà faits, avec intervenant et statut."""
    uid = user["user_id"]
    today_iso = date.today().isoformat()
    q = {"user_id": uid, "kind": "menage", **_prop_scope(user, "property_id"),
         "$or": [{"date": {"$lt": today_iso}}, {"done": True}]}
    if property_id:
        q["property_id"] = property_id
    items = await db.interventions.find(q, {"_id": 0}).sort("date", -1).to_list(500)
    props = await db.properties.find(
        {"user_id": uid, **_prop_scope(user)}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
    pmap = {p["id"]: p.get("name", "Logement") for p in props}
    out = [{
        "id": iv["id"], "date": iv.get("date"), "property_id": iv["property_id"],
        "property_name": pmap.get(iv["property_id"], "Logement"),
        "intervenant": iv.get("intervenant") or "", "done": bool(iv.get("done")),
        "not_done_reason": iv.get("not_done_reason") or "",
        "description": iv.get("description") or "",
    } for iv in items if iv["property_id"] in pmap]
    return {"items": out, "total": len(out)}


@api_router.post("/interventions")
async def create_intervention(payload: InterventionIn, user=Depends(get_current_user)):
    doc = payload.dict()
    if doc.get("intervenants"):
        doc["intervenant"] = ", ".join([x for x in doc["intervenants"] if x])
    elif doc.get("intervenant"):
        doc["intervenants"] = [doc["intervenant"]]
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["created_at"] = now_utc().isoformat()
    await db.interventions.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/interventions/{intervention_id}")
async def update_intervention(intervention_id: str, payload: InterventionIn, user=Depends(get_current_user)):
    data = payload.dict()
    if data.get("intervenants"):
        data["intervenant"] = ", ".join([x for x in data["intervenants"] if x])
    elif data.get("intervenant"):
        data["intervenants"] = [data["intervenant"]]
    res = await db.interventions.update_one(
        {"id": intervention_id, "user_id": user["user_id"]},
        {"$set": data},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Intervention not found")
    item = await db.interventions.find_one({"id": intervention_id}, {"_id": 0})
    return item


@api_router.delete("/interventions/{intervention_id}")
async def delete_intervention(intervention_id: str, user=Depends(get_current_user)):
    await db.interventions.delete_one({"id": intervention_id, "user_id": user["user_id"]})
    return {"ok": True}


@api_router.get("/cleaning-schedule")
async def cleaning_schedule(day: Optional[str] = None, user=Depends(get_current_user)):
    """Vue quotidienne : départs, ménages, interventions, remises de clés,
    cautions à encaisser et arrivées (vérification caution le jour de l'arrivée)."""
    uid = user["user_id"]
    try:
        target = date.fromisoformat(day) if day else date.today()
    except ValueError:
        target = date.today()
    tstr = target.isoformat()
    scope = _prop_scope(user, "property_id")
    props = await db.properties.find(
        {"user_id": uid, **_prop_scope(user)}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
    pmap = {p["id"]: p.get("name", "Logement") for p in props}

    deps = await db.reservations.find(
        {"user_id": uid, "check_out": tstr, "status": {"$nin": ["annulee", "bloque"]}, **scope}, {"_id": 0}).to_list(500)
    departures = [{
        "id": r["id"], "property_id": r["property_id"],
        "property_name": pmap.get(r["property_id"], "Logement"),
        "guest_name": r.get("guest_name"), "checkout_time": r.get("checkout_time") or "",
        "platform": r.get("platform") or "",
        "internal_note": r.get("internal_note") or "",
    } for r in deps if r["property_id"] in pmap]

    arr = await db.reservations.find(
        {"user_id": uid, "check_in": tstr, "status": {"$nin": ["annulee", "bloque"]}, **scope}, {"_id": 0}).to_list(500)
    arrivals = [{
        "id": r["id"], "property_id": r["property_id"],
        "property_name": pmap.get(r["property_id"], "Logement"),
        "guest_name": r.get("guest_name"), "checkin_time": r.get("checkin_time") or "",
        "platform": r.get("platform") or "",
        "deposit_collected": bool((r.get("finance") or {}).get("deposit_collected")),
        "deposit_amount": (r.get("finance") or {}).get("deposit_amount") or 0,
        "damage_deposit": r.get("damage_deposit") or "",
        "internal_note": r.get("internal_note") or "",
        "guest_lang": r.get("guest_lang") or "",
    } for r in arr if r["property_id"] in pmap]

    # Toutes les interventions du jour, regroupées par type
    ivs = await db.interventions.find(
        {"user_id": uid, "date": tstr, **scope}, {"_id": 0}).to_list(1000)

    # Note interne de la réservation associée (affichée sur les ménages du jour)
    since = (target - timedelta(days=14)).isoformat()
    past = await db.reservations.find(
        {"user_id": uid, "check_out": {"$gte": since, "$lte": tstr},
         "status": {"$nin": ["annulee", "bloque"]}, "internal_note": {"$nin": [None, ""]}, **scope},
        {"_id": 0, "property_id": 1, "check_out": 1, "internal_note": 1}).to_list(500)
    note_map = {}
    for r in sorted(past, key=lambda x: x.get("check_out") or ""):
        note_map[r["property_id"]] = r.get("internal_note") or ""

    def _iv(iv):
        return {
            "id": iv["id"], "property_id": iv["property_id"],
            "property_name": pmap.get(iv["property_id"], "Logement"),
            "description": iv.get("description", ""), "intervenant": iv.get("intervenant", ""),
            "done": bool(iv.get("done")),
            "caution_amount": iv.get("caution_amount") or 0,
            "caution_debited": bool(iv.get("caution_debited")),
        }

    cleanings, interventions, key_handovers, cautions = [], [], [], []
    for iv in ivs:
        if iv["property_id"] not in pmap:
            continue
        kind = iv.get("kind", "menage")
        item = _iv(iv)
        if kind == "menage":
            item["internal_note"] = note_map.get(iv["property_id"], "")
            cleanings.append(item)
        elif kind == "remise_cles":
            key_handovers.append(item)
        elif kind == "caution":
            cautions.append(item)
        else:
            interventions.append(item)

    departures.sort(key=lambda x: (x["checkout_time"] or "~", x["property_name"]))
    arrivals.sort(key=lambda x: (x["checkin_time"] or "~", x["property_name"]))
    for lst in (cleanings, interventions, key_handovers, cautions):
        lst.sort(key=lambda x: x["property_name"])

    return {
        "date": tstr,
        "departures": departures,
        "arrivals": arrivals,
        "cleanings": cleanings,
        "interventions": interventions,
        "key_handovers": key_handovers,
        "cautions": cautions,
    }


class RescheduleIn(BaseModel):
    date: str


@api_router.patch("/interventions/{intervention_id}/reschedule")
async def reschedule_cleaning(intervention_id: str, payload: RescheduleIn, user=Depends(get_current_user)):
    """Décale la date d'une tâche non faite (ménage, intervention, remise de clés) —
    uniquement si possible : la nouvelle date doit rester avant (ou le jour de)
    la prochaine arrivée du logement."""
    iv = await db.interventions.find_one(
        {"id": intervention_id, "user_id": user["user_id"]}, {"_id": 0})
    if not iv or (user.get("allowed_property_ids") is not None
                  and iv.get("property_id") not in user["allowed_property_ids"]):
        raise HTTPException(status_code=404, detail="Tâche introuvable")
    if iv.get("kind") == "caution":
        raise HTTPException(status_code=400, detail="Les cautions ne peuvent pas être décalées")
    if iv.get("done"):
        raise HTTPException(status_code=400, detail="Cette tâche est déjà faite")
    try:
        new_date = date.fromisoformat(payload.date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Date invalide")
    if new_date < date.today():
        raise HTTPException(status_code=400, detail="La date doit être aujourd'hui ou plus tard")
    # « Si possible » : le ménage doit être terminé avant la prochaine arrivée
    cur = str(iv.get("date") or "")
    nxt = await db.reservations.find(
        {"user_id": user["user_id"], "property_id": iv["property_id"],
         "status": {"$nin": ["annulee"]}, "check_in": {"$gte": cur or date.today().isoformat()}},
        {"_id": 0, "check_in": 1, "guest_name": 1}).sort("check_in", 1).limit(1).to_list(1)
    if nxt and new_date.isoformat() > nxt[0]["check_in"]:
        d = date.fromisoformat(nxt[0]["check_in"]).strftime("%d/%m")
        raise HTTPException(
            status_code=400,
            detail=f"Impossible : une arrivée est prévue le {d}. La tâche doit être faite au plus tard ce jour-là.")
    await db.interventions.update_one(
        {"id": intervention_id, "user_id": user["user_id"]},
        {"$set": {"date": new_date.isoformat()}})
    return {"id": intervention_id, "date": new_date.isoformat(),
            "limit": (nxt[0]["check_in"] if nxt else None)}


@api_router.patch("/interventions/{intervention_id}/done")
async def set_intervention_done(intervention_id: str, payload: DoneIn, user=Depends(get_current_user)):
    """Marquer une tâche (ménage, intervention, remise de clés) comme faite.
    Autorisé au personnel de terrain. La caution N'EST PAS gérée ici."""
    iv = await db.interventions.find_one(
        {"id": intervention_id, "user_id": user["user_id"]}, {"_id": 0})
    if not iv or (user.get("allowed_property_ids") is not None
                  and iv.get("property_id") not in user["allowed_property_ids"]):
        raise HTTPException(status_code=404, detail="Intervention introuvable")
    if iv.get("kind") == "caution":
        raise HTTPException(status_code=403, detail="La caution ne peut pas être modifiée ici")
    await db.interventions.update_one(
        {"id": intervention_id, "user_id": user["user_id"]},
        {"$set": {"done": payload.done}})
    return {"id": intervention_id, "done": payload.done}


@api_router.patch("/interventions/{intervention_id}/caution")
async def set_caution_state(intervention_id: str, payload: CautionActionIn, user=Depends(get_current_user)):
    """Marquer une caution comme encaissée (debited=true) ou rendue (debited=false)."""
    iv = await db.interventions.find_one(
        {"id": intervention_id, "user_id": user["user_id"]}, {"_id": 0})
    if not iv or (user.get("allowed_property_ids") is not None
                  and iv.get("property_id") not in user["allowed_property_ids"]):
        raise HTTPException(status_code=404, detail="Intervention introuvable")
    await db.interventions.update_one(
        {"id": intervention_id, "user_id": user["user_id"]},
        {"$set": {"caution_debited": payload.debited, "done": payload.done}})
    return {"id": intervention_id, "caution_debited": payload.debited, "done": payload.done}

