"""Pure, stateless helpers & constants extracted from server.py.

These functions have no database or request coupling, which keeps them easy to
unit-test and keeps server.py focused on routing/orchestration.
"""
import re
from hashlib import sha256
from datetime import datetime, timezone, date
from typing import Optional

from pwdlib import PasswordHash

_pwd = PasswordHash.recommended()
_DUMMY_HASH = _pwd.hash("not-a-real-password")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(p: str) -> str:
    return _pwd.hash(p)


def verify_password(p: str, stored: Optional[str]) -> bool:
    return _pwd.verify(p, stored or _DUMMY_HASH)


def norm_email(v: str) -> str:
    return (v or "").strip().lower()


def hash_token(raw: str) -> str:
    return sha256(raw.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Statuses / payments / commissions defaults
# ---------------------------------------------------------------------------
DEFAULT_STATUSES = [
    {"key": "demande", "label": "Demande", "color": "#FF9500"},
    {"key": "confirmee", "label": "Confirmée", "color": "#34C759"},
    {"key": "arrivee", "label": "Arrivée", "color": "#32ADE6"},
    {"key": "depart", "label": "Départ", "color": "#8E8E93"},
    {"key": "bloque", "label": "Bloqué", "color": "#6E6E73"},
    {"key": "annulee", "label": "Annulée", "color": "#FF3B30"},
]
DEFAULT_STATUS_COLORS = {s["key"]: s["color"] for s in DEFAULT_STATUSES}
CORE_STATUS_KEYS = {s["key"] for s in DEFAULT_STATUSES}

DEFAULT_COMMISSION_RATES = {
    "Airbnb": 15.5, "Booking.com": 15.0, "Vrbo": 8.0, "Direct": 0.0, "Site web": 0.0,
}

# Passerelles/méthodes de paiement. Stripe & paiements manuels actifs par défaut.
DEFAULT_PAYMENT_METHODS = {
    "stripe": True,
    "paypal": False,
    "manual": True,
}


def _build_payment_methods(doc):
    return {**DEFAULT_PAYMENT_METHODS, **((doc or {}).get("payment_methods") or {})}


def _build_commission_rates(doc):
    return {**DEFAULT_COMMISSION_RATES, **((doc or {}).get("commission_rates") or {})}


def _build_statuses(doc):
    """Return the full statuses list for a preferences doc, migrating legacy status_colors."""
    if doc and isinstance(doc.get("statuses"), list) and doc["statuses"]:
        return doc["statuses"]
    colors = (doc or {}).get("status_colors") or {}
    return [{**s, "color": colors.get(s["key"], s["color"])} for s in DEFAULT_STATUSES]


# ---------------------------------------------------------------------------
# Finance / display helpers
# ---------------------------------------------------------------------------
def compute_display(r: dict, cmap: dict):
    """Attach display_status/display_color driven by dates (arrivée/départ) + markers."""
    status = r.get("status")
    today = date.today()

    def p(d):
        try:
            return date.fromisoformat(d)
        except Exception:
            return None

    ci, co = p(r.get("check_in")), p(r.get("check_out"))
    if status == "annulee":
        ds, color = "annulee", cmap.get("annulee")
    elif ci and co:
        if today < ci:
            ds = status
            color = r.get("marker_color") or cmap.get(status)
        elif today < co:
            ds, color = "arrivee", cmap.get("arrivee")
        else:
            ds, color = "depart", cmap.get("depart")
    else:
        ds = status
        color = r.get("marker_color") or cmap.get(status)
    r["display_status"] = ds
    r["display_color"] = color
    return r


def recompute_payment(r: dict):
    """Recompute finance.paid/due from acomptes (payments) + manual full-paid flag."""
    fin = dict(r.get("finance") or {})
    total = float(fin.get("total") or r.get("total_price") or 0)
    payments = r.get("payments") or []
    s = sum(float(p.get("amount") or 0) for p in payments)
    lod = float(fin.get("_lodgify_paid") or 0)
    paid = total if r.get("paid_manual") else max(lod, s)
    if total:
        paid = min(paid, total)
    fin["paid"] = round(paid, 2)
    fin["due"] = round(max(0.0, total - paid), 2)
    r["finance"] = fin
    return total > 0 and paid + 0.01 >= total


def marker_color_for(markers, tmap):
    best_order, best_color = -1, None
    for k in (markers or []):
        t = tmap.get(k)
        if t and t.get("order", 100) > best_order:
            best_order = t["order"]
            best_color = t["color"]
    return best_color


# ---------------------------------------------------------------------------
# iCal parsing (import from Airbnb/Booking .ics feeds)
# ---------------------------------------------------------------------------
def _unfold_ical(text: str):
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out = []
    for ln in lines:
        if ln[:1] in (" ", "\t") and out:
            out[-1] += ln[1:]
        else:
            out.append(ln)
    return out


def _parse_ical_date(val: str):
    m = re.search(r"(\d{8})", val)
    if not m:
        return None
    s = m.group(1)
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"


def parse_ical(text: str):
    events = []
    cur = None
    for ln in _unfold_ical(text):
        stripped = ln.strip()
        if stripped == "BEGIN:VEVENT":
            cur = {}
        elif stripped == "END:VEVENT":
            if cur is not None:
                events.append(cur)
            cur = None
        elif cur is not None and ":" in ln:
            key, val = ln.split(":", 1)
            key = key.split(";")[0].upper()
            if key == "DTSTART":
                cur["start"] = _parse_ical_date(val)
            elif key == "DTEND":
                cur["end"] = _parse_ical_date(val)
            elif key == "SUMMARY":
                cur["summary"] = val.strip()
            elif key == "DESCRIPTION":
                cur["description"] = val.strip().replace("\\n", "\n").replace("\\,", ",")
            elif key == "UID":
                cur["uid"] = val.strip()
    return events


_BLOCK_SUMMARIES = {
    "reserved", "not available", "closed", "blocked", "unavailable",
    "airbnb (not available)", "closed - not available", "busy",
}

# Mots-clés identifiant un blocage/jour tampon (PAS une vraie réservation).
# NB : "reserved" (Airbnb) est une vraie réservation → volontairement absent.
_BLOCK_KEYWORDS = ("not available", "unavailable", "blocked", "busy", "indisponible", "blocage")


def _is_block_summary(summary: str) -> bool:
    """Vrai si l'évènement iCal est un blocage (jours tampons) et non une réservation."""
    s = (summary or "").strip().lower()
    if not s:
        return False
    return any(k in s for k in _BLOCK_KEYWORDS)


# ---------------------------------------------------------------------------
# iCal export (public .ics feed)
# ---------------------------------------------------------------------------
def _ics_date(d: str) -> str:
    return (d or "").replace("-", "")


def _ics_escape(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")


def _build_ics(prop: dict, reservations: list) -> str:
    now = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Casanéo//Channel Manager//FR",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_ics_escape(prop.get('name', 'Logement'))}",
    ]
    for r in reservations:
        ci, co = _ics_date(r.get("check_in")), _ics_date(r.get("check_out"))
        if not ci or not co:
            continue
        uid = r.get("ical_uid") or f"{r.get('id')}@staypilot"
        lines += [
            "BEGIN:VEVENT",
            f"UID:{_ics_escape(uid)}",
            f"DTSTAMP:{now}",
            f"DTSTART;VALUE=DATE:{ci}",
            f"DTEND;VALUE=DATE:{co}",
            "SUMMARY:Réservé (Casanéo)",
            "STATUS:CONFIRMED",
            "TRANSP:OPAQUE",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"
