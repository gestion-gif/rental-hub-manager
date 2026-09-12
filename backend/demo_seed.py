"""Compte de démonstration isolé pour les validateurs App Store / Play Store.

- Tenant séparé (user_id dédié) : AUCUN accès aux vraies données.
- Login e-mail/mot de passe via l'écran de connexion existant.
- Re-seed automatique si les données démo deviennent obsolètes (plus aucune
  réservation future) ou si la version du seed change.
"""
import uuid
from datetime import date, timedelta

from core import db, now_utc
from helpers import hash_password, norm_email

DEMO_UID = "demo_store_review"
DEMO_MEMBER_ID = "demo-member-stores"
DEMO_EMAIL = "demo.stores@casaneo.app"
DEMO_PASSWORD = "CasaneoDemo2026!"
DEMO_SEED_VERSION = 1

_PERMISSIONS = [
    "access_booking_payments", "access_guest_module", "access_owner_statements",
    "access_pm_modules", "access_pm_website", "access_properties_section",
    "access_website_builder", "alert_guest_leaving", "alert_missing_deposit",
    "alert_missing_payment", "booking_images_manage", "download_booking_report",
    "edit_calendar_bookings", "edit_checkin_checkout_times",
    "edit_delete_booking_comments", "edit_guest_portal_settings", "edit_property",
    "edit_property_contacts", "manage_property_policies", "manage_property_settings",
    "manage_unavailable_only", "pm_chat", "property_images_manage", "share_alerts",
    "share_images_mobile", "sync_ical", "view_add_booking_comments",
    "view_alert_icons", "view_booking_amount", "view_booking_images",
    "view_booking_notes", "view_booking_source", "view_detailed_payment",
    "view_guest_contact", "view_guest_details", "view_guest_name",
    "view_nonrevenue_charts", "view_owner_email", "view_owner_info",
    "view_photo_album", "view_property_images", "view_revenue_charts",
]

_PROPERTIES = [
    {
        "id": "demo-prop-villa",
        "name": "Villa Azur — Vue mer",
        "address": "12 chemin des Restanques", "city": "Antibes", "postal_code": "06600",
        "capacity": 8, "bedrooms": 4, "surface": 160, "base_price": 320,
        "default_cleaning_fee": 90,
        "description": "Villa de démonstration avec piscine et vue mer panoramique.",
        "image_url": "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200&q=80",
        "amenities": ["Piscine", "Wi-Fi", "Climatisation", "Parking"],
    },
    {
        "id": "demo-prop-studio",
        "name": "Studio Lumière — Centre-ville",
        "address": "4 rue Masséna", "city": "Nice", "postal_code": "06000",
        "capacity": 2, "bedrooms": 1, "surface": 28, "base_price": 85,
        "default_cleaning_fee": 40,
        "description": "Studio de démonstration en plein cœur de Nice.",
        "image_url": "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=80",
        "amenities": ["Wi-Fi", "Climatisation"],
    },
    {
        "id": "demo-prop-mas",
        "name": "Mas des Oliviers",
        "address": "Route de Gordes", "city": "Gordes", "postal_code": "84220",
        "capacity": 6, "bedrooms": 3, "surface": 120, "base_price": 210,
        "default_cleaning_fee": 70,
        "description": "Mas provençal de démonstration au milieu des oliviers.",
        "image_url": "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1200&q=80",
        "amenities": ["Piscine", "Wi-Fi", "Jardin", "Barbecue"],
    },
]


def _fin(stay: float, fees: float, taxes: float, paid: float):
    total = round(stay + fees + taxes, 2)
    return {
        "currency": "EUR", "total": total, "paid": paid,
        "due": round(max(total - paid, 0), 2), "stay": stay, "fees": fees,
        "taxes": taxes, "addons": 0.0, "promotions": 0.0, "commission": 0.0,
        "vat": 0.0, "quote_status": "Agreed", "policy_payments": "",
        "policy_cancellation": "", "damage_deposit": "",
    }


def _demo_reservations():
    today = date.today()
    d = lambda n: (today + timedelta(days=n)).isoformat()  # noqa: E731
    rows = [
        # (prop, guest, platform, check_in, check_out, guests, status, stay, fees, taxes, paid)
        ("demo-prop-villa", "Camille Moreau", "Airbnb", d(-1), d(3), 6, "arrivee", 1280, 90, 48, 1418),
        ("demo-prop-studio", "Lucas Bernard", "Booking.com", d(-4), d(0), 2, "depart", 340, 40, 12, 392),
        ("demo-prop-villa", "Emma Fontaine", "Booking.com", d(5), d(12), 8, "confirmee", 2240, 90, 84, 0),
        ("demo-prop-mas", "Hugo Lambert", "Airbnb", d(7), d(11), 4, "confirmee", 840, 70, 28, 938),
        ("demo-prop-studio", "Léa Girard", "Direct", d(9), d(13), 2, "confirmee", 340, 40, 12, 100),
        ("demo-prop-mas", "Nathan Rousseau", "Direct", d(12), d(15), 5, "demande", 630, 70, 24, 0),
        ("demo-prop-studio", "Chloé Perrin", "Airbnb", d(8), d(10), 2, "annulee", 170, 40, 6, 0),
        ("demo-prop-villa", "Arthur Blanc", "Booking.com", d(-20), d(-15), 7, "depart", 1600, 90, 60, 1750),
        ("demo-prop-mas", "Manon Dubois", "Airbnb", d(-12), d(-8), 4, "depart", 840, 70, 28, 938),
    ]
    pnames = {p["id"]: p["name"] for p in _PROPERTIES}
    out = []
    for i, (pid, guest, platform, ci, co, guests, status, stay, fees, taxes, paid) in enumerate(rows):
        out.append({
            "id": f"demo-res-{i + 1}", "user_id": DEMO_UID,
            "property_id": pid, "property_name": pnames[pid],
            "guest_name": guest,
            "guest_email": "voyageur.demo@example.com", "guest_phone": "+33 6 00 00 00 00",
            "check_in": ci, "check_out": co, "checkin_time": "16:00", "checkout_time": "10:00",
            "guests": guests, "platform": platform, "source": "demo",
            "status": status, "confirmation_code": f"DEMO-{1000 + i}",
            "total_price": round(stay + fees + taxes, 2),
            "finance": _fin(stay, fees, taxes, paid),
            "payments": [], "notes": "", "markers": [], "checklist": {},
            "language": "fr", "created_at": now_utc().isoformat(),
        })
    return out


_REVIEWS = [
    ("demo-prop-villa", "Camille M.", 5, "Villa magnifique, piscine parfaite et accueil aux petits soins. Nous reviendrons !"),
    ("demo-prop-mas", "Hugo L.", 4, "Très beau mas provençal, calme absolu. Petit bémol sur la pression de la douche."),
    ("demo-prop-studio", "Léa G.", 5, "Studio idéalement placé, impeccable et lumineux. Communication au top."),
]


async def ensure_demo_account():
    """Crée / rafraîchit le compte démo pour les validateurs de stores (idempotent)."""
    u = await db.users.find_one({"user_id": DEMO_UID}, {"_id": 0, "demo_seed_version": 1})
    member_ok = await db.members.find_one({"id": DEMO_MEMBER_ID}, {"_id": 0, "id": 1})
    today = date.today().isoformat()
    has_future = await db.reservations.find_one(
        {"user_id": DEMO_UID, "check_in": {"$gte": today}}, {"_id": 0, "id": 1})
    if u and u.get("demo_seed_version") == DEMO_SEED_VERSION and member_ok and has_future:
        return False

    await db.users.update_one(
        {"user_id": DEMO_UID},
        {"$set": {
            "user_id": DEMO_UID, "email": DEMO_EMAIL, "name": "Démo Casanéo",
            "demo_seed_version": DEMO_SEED_VERSION,
            "created_at": now_utc().isoformat(),
        }}, upsert=True)
    await db.members.update_one(
        {"id": DEMO_MEMBER_ID},
        {"$set": {
            "id": DEMO_MEMBER_ID, "user_id": DEMO_UID,
            "email": DEMO_EMAIL, "email_normalized": norm_email(DEMO_EMAIL),
            "first_name": "Compte", "last_name": "Démo",
            "role": "admin", "permissions": _PERMISSIONS, "property_ids": [],
            "password_hash": hash_password(DEMO_PASSWORD),
            "active": True, "invite_status": "accepted", "language": "fr",
            "phone": "", "created_at": now_utc().isoformat(),
        }}, upsert=True)

    # Rafraîchit les données du tenant démo par UPSERTS idempotents (ids fixes) —
    # aucune suppression au démarrage (exigence de déploiement).
    now = now_utc().isoformat()
    props = []
    for p in _PROPERTIES:
        props.append({
            **p, "user_id": DEMO_UID, "created_at": now,
            "photos": [p["image_url"]], "ical_links": [], "seasons": [], "rooms": [],
            "published": False, "owner": "", "owner_id": "", "location": p["city"],
            "address_complement": "", "description": p["description"],
            "key_instructions": "", "key_photos": [], "welcome_book_url": "",
            "deposit_link": "", "getyourguide_url": "",
            "default_tourist_tax": 0, "tourist_tax_pct": 0, "tax_mode": "flat",
            "tax_cap": 0, "tax_dept_pct": 0, "regional_tax_pct": 0,
            "management_fee_pct": 0, "amenities": p["amenities"],
            "channex_id": None, "lodgify_id": None, "ical_export_token": str(uuid.uuid4()),
        })
    for doc in props:
        await db.properties.update_one({"id": doc["id"]}, {"$set": doc}, upsert=True)
    for doc in _demo_reservations():
        await db.reservations.update_one({"id": doc["id"]}, {"$set": doc}, upsert=True)
    for i, (pid, guest, rating, comment) in enumerate(_REVIEWS):
        doc = {
            "id": f"demo-review-{i + 1}", "user_id": DEMO_UID,
            "property_id": pid,
            "property_name": next(p["name"] for p in _PROPERTIES if p["id"] == pid),
            "guest_name": guest, "rating": rating, "comment": comment,
            "date": (date.today() - timedelta(days=10 + i * 7)).isoformat(),
            "source": "demo", "created_at": now,
        }
        await db.reviews.update_one({"id": doc["id"]}, {"$set": doc}, upsert=True)
    return True
