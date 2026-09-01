"""Calculs de tarification purs : suppléments, taxe de séjour, prix par jour, promos, plages ARI."""
from datetime import timedelta
from typing import Optional


def compute_supplement_amount(sup: dict, *, nights: int, nights_total: float, cleaning: float,
                              guests: int, bedrooms: int, quantity: int = 1) -> float:
    """Montant TTC d'un supplément selon son paramétrage."""
    amount = float(sup.get("amount") or 0)
    if (sup.get("calc_model") or "fixed") == "percent":
        base = float(nights_total or 0) + (float(cleaning or 0) if sup.get("percent_base") == "total" else 0.0)
        raw = base * amount / 100.0
    else:
        basis = sup.get("charge_basis") or "unique"
        mult = {"unique": 1, "per_quantity": max(1, int(quantity or 1)),
                "per_guest": max(1, int(guests or 1)), "per_room": max(1, int(bedrooms or 1))}.get(basis, 1)
        if (sup.get("period") or "per_stay") == "per_night":
            mult *= max(1, int(nights or 1))
        raw = amount * mult
    if not sup.get("price_includes_vat", True):
        raw *= 1 + float(sup.get("vat_rate") or 0) / 100.0
    return round(raw, 2)


def _match_promo(promos: list, code: str, property_id: str, check_in: str) -> Optional[dict]:
    code = (code or "").strip().upper()
    for p in promos:
        if not p.get("enabled", True):
            continue
        if p.get("require_code"):
            if not code or (p.get("code") or "").strip().upper() != code:
                continue
        pids = p.get("property_ids") or []
        if pids and property_id not in pids:
            continue
        if p.get("period_enabled"):
            if p.get("start_date") and check_in < p["start_date"]:
                continue
            if p.get("end_date") and check_in > p["end_date"]:
                continue
        return p
    return None


def real_tourist_tax(prop: dict, night_prices: list, occupants: int, taxable: int = 0) -> float:
    """Barème réel français : taux % du (prix de la nuit / occupants), plafonné par pers/nuit,
    + taxes additionnelles départementale et régionale (% de la taxe), × nuits × assujettis."""
    rate = float(prop.get("tourist_tax_pct") or 0) / 100.0
    cap = float(prop.get("tax_cap") or 0)
    dept = float(prop.get("tax_dept_pct") or 0) / 100.0
    reg = float(prop.get("regional_tax_pct") or 0) / 100.0
    occ = max(1, int(occupants or 1))
    tx = int(taxable or 0) or occ
    total = 0.0
    for p in night_prices:
        base = (float(p or 0) / occ) * rate
        if cap > 0:
            base = min(base, cap)
        total += base * (1 + dept + reg) * tx
    return round(total, 2)


DEFAULT_DYNAMIC_PRICING = {
    "enabled": False,
    "weekend_pct": 15,        # majoration vendredi/samedi
    "high_season_pct": 20,    # majoration si la date tombe dans une saison "haute"
    "lead_long_days": 45,     # au-delà → anticipation longue
    "lead_long_pct": 8,       # majoration anticipation longue
    "lead_last_days": 7,      # en deçà → dernière minute
    "lead_last_pct": -10,     # remise dernière minute
    "occ_high_pct": 12,       # majoration si occupation forte
    "occ_low_pct": -10,       # remise si occupation faible
    "market_weight": 40,      # % de poids du marché (comparables) vs prix de base
    "min_price": 0,
    "max_price": 0,
}


def _price_for_day(prop: dict, day_str: str):
    for s in (prop.get("seasons") or []):
        if s.get("start_date") and s.get("end_date") and s["start_date"] <= day_str <= s["end_date"]:
            return float(s.get("price") or 0)
    return float(prop.get("base_price") or 0)


def _is_high_season(prop: dict, day_str: str) -> bool:
    base = float(prop.get("base_price") or 0)
    for s in (prop.get("seasons") or []):
        if s.get("start_date") and s.get("end_date") and s["start_date"] <= day_str <= s["end_date"]:
            return float(s.get("price") or 0) > base
    return False


def _date_ranges(start, end, value_fn, build_fn):
    """Regroupe les jours consécutifs de même valeur en plages (payload ARI compact)."""
    out = []
    cur = start
    run_start = None
    run_val = None
    while cur <= end:
        v = value_fn(cur)
        if run_val is None:
            run_start, run_val = cur, v
        elif v != run_val:
            e = build_fn(run_val)
            e["date_from"] = run_start.isoformat()
            e["date_to"] = (cur - timedelta(days=1)).isoformat()
            out.append(e)
            run_start, run_val = cur, v
        cur += timedelta(days=1)
    if run_val is not None:
        e = build_fn(run_val)
        e["date_from"] = run_start.isoformat()
        e["date_to"] = end.isoformat()
        out.append(e)
    return out
