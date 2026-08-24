# ruff: noqa: F403, F405
from core import *  # noqa: F401


@api_router.get("/dashboard")
async def dashboard(user=Depends(get_current_user)):
    uid = user["user_id"]
    today = date.today()
    today_str = today.isoformat()
    year, month = today.year, today.month
    days_in_month = pycalendar.monthrange(year, month)[1]
    month_start = date(year, month, 1)
    month_end = date(year, month, days_in_month)

    props = await db.properties.find({"user_id": uid, **_prop_scope(user)}, {"_id": 0}).to_list(500)
    reservations = await db.reservations.find(
        {"user_id": uid, **_prop_scope(user, "property_id")}, {"_id": 0}).to_list(2000)
    await db.interventions.delete_many(
        {"user_id": uid, "kind": "menage", "date": {"$lt": today_str}})
    interventions = await db.interventions.find(
        {"user_id": uid, **_prop_scope(user, "property_id")}, {"_id": 0}).sort("date", 1).to_list(1000)

    prop_map = {p["id"]: p for p in props}
    cmap = await status_color_map(uid)

    def parse(d):
        try:
            return date.fromisoformat(d)
        except Exception:
            return None

    arrivals_today = []
    departures_today = []
    current_stays = []
    revenue_month = 0.0
    booked_nights = 0

    for r in reservations:
        if r["status"] == "annulee":
            continue
        ci = parse(r.get("check_in"))
        co = parse(r.get("check_out"))
        pname = prop_map.get(r["property_id"], {}).get("name", "Logement")
        r_view = compute_display({**r, "property_name": pname}, cmap)
        if r.get("check_in") == today_str:
            arrivals_today.append(r_view)
        if r.get("check_out") == today_str:
            departures_today.append(r_view)
        # current stay: today is within [check_in, check_out) (checkout day excluded)
        if ci and co and ci <= today < co:
            current_stays.append(r_view)
        # revenue + occupancy for current month
        if ci and co and r["status"] in ("confirmee", "arrivee", "depart"):
            overlap_start = max(ci, month_start)
            overlap_end = min(co, month_end + timedelta(days=1))
            nights = (overlap_end - overlap_start).days
            if nights > 0:
                booked_nights += nights
            # revenue counted if check-in within month
            if month_start <= ci <= month_end:
                revenue_month += float(r.get("total_price", 0) or 0)

    current_stays.sort(key=lambda x: x.get("check_out") or "")

    capacity_nights = max(len(props) * days_in_month, 1)
    occupancy = round(min(booked_nights / capacity_nights * 100, 100))

    upcoming = 0
    for r in reservations:
        ci = parse(r.get("check_in"))
        if ci and ci >= today and r["status"] in ("demande", "confirmee"):
            upcoming += 1

    # Upcoming interventions (today and future), enriched with property name
    upcoming_interventions = []
    for iv in interventions:
        if iv.get("done"):
            continue
        d = parse(iv.get("date"))
        if d and d >= today:
            upcoming_interventions.append({
                **iv,
                "property_name": prop_map.get(iv["property_id"], {}).get("name", "Logement"),
            })
    upcoming_interventions.sort(key=lambda x: x.get("date") or "")

    return {
        "occupancy_rate": occupancy,
        "revenue_month": round(revenue_month) if _can(user, "view_revenue_charts") else None,
        "total_properties": len(props),
        "upcoming_count": upcoming,
        "current_stays": current_stays,
        "arrivals_today": arrivals_today,
        "departures_today": departures_today,
        "interventions": upcoming_interventions,
    }

