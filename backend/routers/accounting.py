# ruff: noqa: F403, F405
import base64
from typing import Optional, List

from core import *  # noqa: F401,F403
from core import _prop_scope, _res_amounts, _resolve_period, make_chat
from emergentintegrations.llm.chat import ImageContent


# ---------------------------------------------------------------------------
# Catégories & TVA par défaut
# ---------------------------------------------------------------------------
DEFAULT_CATEGORIES = {
    "recette": [
        "Nuitées / Loyer",
        "Ménage refacturé",
        "Taxe de séjour",
        "Acompte",
        "Frais divers",
    ],
    "depense": [
        "Ménage",
        "Maintenance / Travaux",
        "Charges (eau/élec/gaz)",
        "Assurance",
        "Fournitures",
        "Honoraires / Sous-traitance",
        "Marketing",
        "Abonnements",
        "Taxe de séjour reversée",
        "Autre",
    ],
}
DEFAULT_VAT_RATES = [0, 5.5, 10, 20]


class TransactionIn(BaseModel):
    type: str                       # recette | depense
    date: str                       # YYYY-MM-DD
    amount_ttc: float = 0
    vat_rate: float = 0
    category: str = ""
    property_id: Optional[str] = None
    owner_id: Optional[str] = None
    channel: Optional[str] = None   # pour les recettes (Airbnb, Booking, Direct…)
    supplier: Optional[str] = None  # pour les dépenses (fournisseur)
    description: str = ""
    receipt_path: Optional[str] = None


class RecurringIn(BaseModel):
    label: str
    category: str = ""
    amount_ttc: float = 0
    vat_rate: float = 0
    property_id: Optional[str] = None
    owner_id: Optional[str] = None
    supplier: Optional[str] = None
    frequency: str = "monthly"      # monthly | quarterly | yearly
    day_of_month: int = 1
    start_date: str = ""            # YYYY-MM-DD
    end_date: Optional[str] = None  # YYYY-MM-DD (optionnel)
    active: bool = True


def _split_tva(ttc, rate):
    ttc = round(float(ttc or 0), 2)
    rate = float(rate or 0)
    ht = round(ttc / (1 + rate / 100.0), 2) if rate else ttc
    vat = round(ttc - ht, 2)
    return ht, vat


def _shape_tx(payload: dict) -> dict:
    ht, vat = _split_tva(payload.get("amount_ttc"), payload.get("vat_rate"))
    return {
        "type": payload.get("type", "depense"),
        "date": payload.get("date"),
        "amount_ttc": round(float(payload.get("amount_ttc") or 0), 2),
        "vat_rate": float(payload.get("vat_rate") or 0),
        "amount_ht": ht,
        "vat_amount": vat,
        "category": payload.get("category") or "",
        "property_id": payload.get("property_id") or None,
        "owner_id": payload.get("owner_id") or None,
        "channel": payload.get("channel") or None,
        "supplier": payload.get("supplier") or None,
        "description": payload.get("description") or "",
        "receipt_path": payload.get("receipt_path") or None,
    }


async def _prop_owner_maps(uid: str):
    props = await db.properties.find({"user_id": uid}, {"_id": 0, "id": 1, "name": 1, "owner_id": 1}).to_list(3000)
    pname = {p["id"]: p.get("name", "") for p in props}
    powner = {p["id"]: p.get("owner_id") for p in props}
    owners = await db.owners.find({"user_id": uid}, {"_id": 0, "id": 1, "name": 1}).to_list(3000)
    oname = {o["id"]: o.get("name", "") for o in owners}
    return pname, powner, oname


# ---------------------------------------------------------------------------
# Génération des dépenses récurrentes (paresseuse)
# ---------------------------------------------------------------------------
def _period_dates(rec: dict):
    """Retourne la liste des dates d'échéance (YYYY-MM-DD) de start_date jusqu'à aujourd'hui."""
    try:
        start = date.fromisoformat(rec["start_date"])
    except Exception:
        return []
    end = date.today()
    if rec.get("end_date"):
        try:
            e = date.fromisoformat(rec["end_date"])
            if e < end:
                end = e
        except Exception:
            pass
    freq = rec.get("frequency", "monthly")
    step = {"monthly": 1, "quarterly": 3, "yearly": 12}.get(freq, 1)
    day = max(1, min(28, int(rec.get("day_of_month") or 1)))
    out = []
    y, m = start.year, start.month
    while True:
        try:
            d = date(y, m, day)
        except Exception:
            d = date(y, m, 28)
        if d > end:
            break
        if d >= start:
            out.append(d.isoformat())
        m += step
        while m > 12:
            m -= 12
            y += 1
    return out


async def _materialize_recurring(uid: str):
    recs = await db.acct_recurring.find({"user_id": uid, "active": True}, {"_id": 0}).to_list(1000)
    for rec in recs:
        for d in _period_dates(rec):
            exists = await db.transactions.find_one(
                {"user_id": uid, "recurring_id": rec["id"], "date": d}, {"_id": 1})
            if exists:
                continue
            tx = _shape_tx({
                "type": "depense",
                "date": d,
                "amount_ttc": rec.get("amount_ttc"),
                "vat_rate": rec.get("vat_rate"),
                "category": rec.get("category"),
                "property_id": rec.get("property_id"),
                "owner_id": rec.get("owner_id"),
                "supplier": rec.get("supplier"),
                "description": rec.get("label") or "Dépense récurrente",
            })
            tx.update({
                "id": str(uuid.uuid4()), "user_id": uid, "source": "recurring",
                "recurring_id": rec["id"], "created_at": now_utc().isoformat(),
            })
            await db.transactions.insert_one(tx)


# ---------------------------------------------------------------------------
# Méta (catégories, taux de TVA)
# ---------------------------------------------------------------------------
@api_router.get("/accounting/meta")
async def accounting_meta(user=Depends(get_current_user)):
    uid = user["user_id"]
    used = await db.transactions.distinct("category", {"user_id": uid})
    cats = {
        "recette": DEFAULT_CATEGORIES["recette"][:],
        "depense": DEFAULT_CATEGORIES["depense"][:],
    }
    for c in used:
        if c and c not in cats["recette"] and c not in cats["depense"]:
            cats["depense"].append(c)
    return {"categories": cats, "vat_rates": DEFAULT_VAT_RATES}


# ---------------------------------------------------------------------------
# Transactions CRUD
# ---------------------------------------------------------------------------
@api_router.get("/accounting/transactions")
async def list_transactions(
    from_: Optional[str] = None, to: Optional[str] = None, month: Optional[str] = None,
    type: Optional[str] = None, property_id: Optional[str] = None,
    owner_id: Optional[str] = None, category: Optional[str] = None,
    user=Depends(get_current_user),
):
    uid = user["user_id"]
    await _materialize_recurring(uid)
    q = {"user_id": uid, **_prop_scope(user, "property_id")}
    if month:
        sd, ed_excl, _, _ = _resolve_period(month=month)
        q["date"] = {"$gte": sd, "$lt": ed_excl}
    elif from_ and to:
        q["date"] = {"$gte": from_, "$lte": to}
    if type:
        q["type"] = type
    if property_id:
        q["property_id"] = property_id
    if owner_id:
        q["owner_id"] = owner_id
    if category:
        q["category"] = category
    items = await db.transactions.find(q, {"_id": 0}).sort("date", -1).to_list(5000)
    pname, _, oname = await _prop_owner_maps(uid)
    for it in items:
        it["property_name"] = pname.get(it.get("property_id"), "")
        it["owner_name"] = oname.get(it.get("owner_id"), "")
    return items


@api_router.post("/accounting/transactions")
async def create_transaction(payload: TransactionIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    tx = _shape_tx(payload.dict())
    tx.update({"id": str(uuid.uuid4()), "user_id": uid, "source": "manual",
               "created_at": now_utc().isoformat()})
    await db.transactions.insert_one(tx)
    return {"id": tx["id"]}


@api_router.put("/accounting/transactions/{tx_id}")
async def update_transaction(tx_id: str, payload: TransactionIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    existing = await db.transactions.find_one({"id": tx_id, "user_id": uid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Écriture introuvable")
    tx = _shape_tx(payload.dict())
    await db.transactions.update_one({"id": tx_id, "user_id": uid}, {"$set": tx})
    return {"ok": True}


@api_router.delete("/accounting/transactions/{tx_id}")
async def delete_transaction(tx_id: str, user=Depends(get_current_user)):
    uid = user["user_id"]
    res = await db.transactions.delete_one({"id": tx_id, "user_id": uid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Écriture introuvable")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Scan IA d'un justificatif (Claude Sonnet 4.6, vision)
# ---------------------------------------------------------------------------
@api_router.post("/accounting/scan-receipt")
async def scan_receipt(file: UploadFile = File(...), user=Depends(get_current_user)):
    data = await file.read()
    ct = (file.content_type or "").lower()
    if "png" in ct:
        mime = "image/png"
    elif "webp" in ct:
        mime = "image/webp"
    else:
        mime = "image/jpeg"
    b64 = base64.b64encode(data).decode("ascii")
    system = (
        "Tu es un assistant comptable. À partir de la photo d'un justificatif (ticket ou facture), "
        "tu extrais les informations clés. Réponds UNIQUEMENT par un objet JSON valide, sans texte autour."
    )
    prompt = (
        "Extrais du justificatif : supplier (nom du commerçant/fournisseur), date (format YYYY-MM-DD), "
        "amount_ttc (montant total TTC, nombre), vat_amount (montant de TVA, nombre ou null), "
        "vat_rate (taux de TVA en %, nombre ou null), currency (ex: EUR), "
        "category_guess (une catégorie de dépense probable en français). "
        'Format exact : {"supplier":"","date":"","amount_ttc":0,"vat_amount":null,"vat_rate":null,"currency":"EUR","category_guess":""}'
    )
    try:
        chat = make_chat(system, f"receipt-{user['user_id']}")
        raw = await chat.send_message(UserMessage(text=prompt, file_contents=[ImageContent(image_base64=b64)]))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Analyse IA échouée: {e}")
    txt = (raw or "").strip()
    if "```" in txt:
        txt = txt.split("```")[1]
        if txt.startswith("json"):
            txt = txt[4:]
    s, e = txt.find("{"), txt.rfind("}")
    parsed = {}
    if s != -1 and e != -1:
        try:
            parsed = json.loads(txt[s:e + 1])
        except Exception:
            parsed = {}
    return {
        "supplier": parsed.get("supplier") or "",
        "date": parsed.get("date") or "",
        "amount_ttc": parsed.get("amount_ttc") or 0,
        "vat_amount": parsed.get("vat_amount"),
        "vat_rate": parsed.get("vat_rate"),
        "currency": parsed.get("currency") or "EUR",
        "category_guess": parsed.get("category_guess") or "",
    }


# ---------------------------------------------------------------------------
# Dépenses récurrentes
# ---------------------------------------------------------------------------
@api_router.get("/accounting/recurring")
async def list_recurring(user=Depends(get_current_user)):
    uid = user["user_id"]
    items = await db.acct_recurring.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    pname, _, oname = await _prop_owner_maps(uid)
    for it in items:
        it["property_name"] = pname.get(it.get("property_id"), "")
        it["owner_name"] = oname.get(it.get("owner_id"), "")
    return items


@api_router.post("/accounting/recurring")
async def create_recurring(payload: RecurringIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    doc = payload.dict()
    doc.update({"id": str(uuid.uuid4()), "user_id": uid, "created_at": now_utc().isoformat()})
    await db.acct_recurring.insert_one(doc)
    await _materialize_recurring(uid)
    return {"id": doc["id"]}


@api_router.put("/accounting/recurring/{rec_id}")
async def update_recurring(rec_id: str, payload: RecurringIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    existing = await db.acct_recurring.find_one({"id": rec_id, "user_id": uid}, {"_id": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Récurrence introuvable")
    await db.acct_recurring.update_one({"id": rec_id, "user_id": uid}, {"$set": payload.dict()})
    await _materialize_recurring(uid)
    return {"ok": True}


@api_router.delete("/accounting/recurring/{rec_id}")
async def delete_recurring(rec_id: str, keep_generated: bool = True, user=Depends(get_current_user)):
    uid = user["user_id"]
    res = await db.acct_recurring.delete_one({"id": rec_id, "user_id": uid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Récurrence introuvable")
    if not keep_generated:
        await db.transactions.delete_many({"user_id": uid, "recurring_id": rec_id})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Import des revenus de réservations sur une période
# ---------------------------------------------------------------------------
@api_router.post("/accounting/import-revenues")
async def import_revenues(body: dict = Body(...), user=Depends(get_current_user)):
    uid = user["user_id"]
    sd, ed_excl, _, label = _resolve_period(
        month=body.get("month", ""), start=body.get("start", ""), end=body.get("end", ""))
    q = {
        "user_id": uid,
        "status": {"$nin": ["annulee", "demande"]},
        "check_in": {"$gte": sd, "$lt": ed_excl},
        **_prop_scope(user, "property_id"),
    }
    res = await db.reservations.find(q, {"_id": 0}).to_list(5000)
    pname, powner, _ = await _prop_owner_maps(uid)
    created = 0
    skipped = 0
    for r in res:
        exists = await db.transactions.find_one(
            {"user_id": uid, "source": "reservation", "reservation_id": r["id"]}, {"_id": 1})
        if exists:
            skipped += 1
            continue
        amt = _res_amounts(r)
        ttc = round(amt["nights"] + amt["cleaning"], 2)  # loyer + ménage (hors taxe de séjour)
        if ttc <= 0:
            continue
        pid = r.get("property_id")
        tx = _shape_tx({
            "type": "recette",
            "date": r.get("check_in"),
            "amount_ttc": ttc,
            "vat_rate": 0,
            "category": "Nuitées / Loyer",
            "property_id": pid,
            "owner_id": powner.get(pid),
            "channel": r.get("platform") or "Direct",
            "description": f"{r.get('guest_name', '')} · {pname.get(pid, '')} ({r.get('check_in')} → {r.get('check_out')})".strip(),
        })
        tx.update({"id": str(uuid.uuid4()), "user_id": uid, "source": "reservation",
                   "reservation_id": r["id"], "created_at": now_utc().isoformat()})
        await db.transactions.insert_one(tx)
        created += 1
    return {"created": created, "skipped": skipped, "period_label": label}


# ---------------------------------------------------------------------------
# Vue annuelle (mois par mois, avec comparaison N-1)
# ---------------------------------------------------------------------------
def _blank_months(year: int):
    return [{"month": f"{year}-{m:02d}", "recettes": 0.0, "depenses": 0.0,
             "recettes_ht": 0.0, "depenses_ht": 0.0} for m in range(1, 13)]


def _finalize_months(months: list):
    for m in months:
        for k in ("recettes", "depenses", "recettes_ht", "depenses_ht"):
            m[k] = round(m[k], 2)
        m["resultat"] = round(m["recettes"] - m["depenses"], 2)
        m["resultat_ht"] = round(m["recettes_ht"] - m["depenses_ht"], 2)
    return months


@api_router.get("/accounting/annual")
async def accounting_annual(
    year: int, property_id: Optional[str] = None,
    user=Depends(get_current_user),
):
    uid = user["user_id"]
    await _materialize_recurring(uid)
    q = {
        "user_id": uid, **_prop_scope(user, "property_id"),
        "date": {"$gte": f"{year - 1}-01-01", "$lte": f"{year}-12-31"},
    }
    if property_id:
        q["property_id"] = property_id
    items = await db.transactions.find(
        q, {"_id": 0, "date": 1, "type": 1, "amount_ttc": 1, "amount_ht": 1}).to_list(100000)

    months = _blank_months(year)
    prev = _blank_months(year - 1)
    for it in items:
        d = str(it.get("date") or "")
        try:
            y, mi = int(d[:4]), int(d[5:7]) - 1
        except Exception:
            continue
        if not 0 <= mi <= 11:
            continue
        target = months if y == year else prev if y == year - 1 else None
        if target is None:
            continue
        key = "recettes" if it.get("type") == "recette" else "depenses"
        target[mi][key] += float(it.get("amount_ttc") or 0)
        target[mi][key + "_ht"] += float(it.get("amount_ht") or 0)

    _finalize_months(months)
    _finalize_months(prev)

    def totals(ms):
        return {
            "recettes": round(sum(m["recettes"] for m in ms), 2),
            "depenses": round(sum(m["depenses"] for m in ms), 2),
            "resultat": round(sum(m["resultat"] for m in ms), 2),
            "resultat_ht": round(sum(m["resultat_ht"] for m in ms), 2),
        }

    return {"year": year, "months": months, "totals": totals(months),
            "prev_year": year - 1, "prev_months": prev, "prev_totals": totals(prev)}


# ---------------------------------------------------------------------------
# Compte de résultat (P&L) + TVA
# ---------------------------------------------------------------------------
@api_router.get("/accounting/summary")
async def accounting_summary(
    from_: Optional[str] = None, to: Optional[str] = None, month: Optional[str] = None,
    property_id: Optional[str] = None, owner_id: Optional[str] = None,
    user=Depends(get_current_user),
):
    uid = user["user_id"]
    await _materialize_recurring(uid)
    q = {"user_id": uid, **_prop_scope(user, "property_id")}
    if month:
        sd, ed_excl, _, label = _resolve_period(month=month)
        q["date"] = {"$gte": sd, "$lt": ed_excl}
    elif from_ and to:
        sd, ed_excl, _, label = _resolve_period(start=from_, end=to)
        q["date"] = {"$gte": from_, "$lte": to}
    else:
        label = "Toutes périodes"
    if property_id:
        q["property_id"] = property_id
    if owner_id:
        q["owner_id"] = owner_id
    items = await db.transactions.find(q, {"_id": 0}).to_list(20000)
    prefs = await db.preferences.find_one({"user_id": uid}, {"_id": 0, "vat_subjected": 1})
    pname, powner, oname = await _prop_owner_maps(uid)

    def blank():
        return {"ttc": 0.0, "ht": 0.0, "vat": 0.0}

    recettes, depenses = blank(), blank()
    cat_rec, cat_dep = {}, {}
    by_prop, by_owner = {}, {}
    for it in items:
        typ = it.get("type")
        ttc = float(it.get("amount_ttc") or 0)
        ht = float(it.get("amount_ht") or 0)
        vat = float(it.get("vat_amount") or 0)
        bucket = recettes if typ == "recette" else depenses
        bucket["ttc"] += ttc
        bucket["ht"] += ht
        bucket["vat"] += vat
        cmap = cat_rec if typ == "recette" else cat_dep
        c = it.get("category") or "Autre"
        cmap[c] = round(cmap.get(c, 0) + ttc, 2)
        pid = it.get("property_id") or "_none"
        oid = it.get("owner_id") or powner.get(it.get("property_id")) or "_none"
        bp = by_prop.setdefault(pid, {"name": pname.get(it.get("property_id"), "Non affecté"), "recettes": 0.0, "depenses": 0.0})
        bo = by_owner.setdefault(oid, {"name": oname.get(oid, "Non affecté"), "recettes": 0.0, "depenses": 0.0})
        if typ == "recette":
            bp["recettes"] += ttc
            bo["recettes"] += ttc
        else:
            bp["depenses"] += ttc
            bo["depenses"] += ttc

    def rnd(d):
        return {k: round(v, 2) for k, v in d.items()}

    for d in list(by_prop.values()) + list(by_owner.values()):
        d["recettes"] = round(d["recettes"], 2)
        d["depenses"] = round(d["depenses"], 2)
        d["resultat"] = round(d["recettes"] - d["depenses"], 2)

    tva_col = round(recettes["vat"], 2)
    tva_ded = round(depenses["vat"], 2)
    return {
        "period_label": label,
        "recettes": rnd(recettes),
        "depenses": rnd(depenses),
        "resultat": {
            "ttc": round(recettes["ttc"] - depenses["ttc"], 2),
            "ht": round(recettes["ht"] - depenses["ht"], 2),
        },
        "tva": {"collectee": tva_col, "deductible": tva_ded, "nette": round(tva_col - tva_ded, 2)},
        "vat_subjected": bool((prefs or {}).get("vat_subjected", False)),
        "by_category": {"recette": cat_rec, "depense": cat_dep},
        "by_property": sorted(by_prop.values(), key=lambda x: -(x["recettes"] + x["depenses"])),
        "by_owner": sorted(by_owner.values(), key=lambda x: -(x["recettes"] + x["depenses"])),
        "count": len(items),
    }
