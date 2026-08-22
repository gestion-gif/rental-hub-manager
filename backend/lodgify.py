"""Lodgify Public API integration layer (provider-neutral adapter + mapping).

Self-contained: no database dependency. Imported by server.py.
"""
import re
import html as htmllib
import asyncio
from typing import Optional

import httpx
from fastapi import HTTPException

SOURCE_LABELS = {
    "AirbnbIntegration": "Airbnb",
    "Airbnb": "Airbnb",
    "BookingComIntegration": "Booking.com",
    "BookingCom": "Booking.com",
    "HomeAwayIntegration": "Vrbo",
    "HomeAway": "Vrbo",
    "Vrbo": "Vrbo",
    "Manual": "Direct",
    "OwnerWebsite": "Site web",
    "Website": "Site web",
    "Direct": "Direct",
}

LODGIFY_STATUS_MAP = {
    "Booked": "confirmee",
    "Open": "demande",
    "Tentative": "demande",
    "Declined": "annulee",
    "Expired": "annulee",
    "Canceled": "annulee",
    "Cancelled": "annulee",
}


def source_label(src: Optional[str]) -> str:
    if not src:
        return "Direct"
    if src in SOURCE_LABELS:
        return SOURCE_LABELS[src]
    return src.replace("Integration", "").strip() or "Direct"


def strip_html(text: str) -> str:
    if not text:
        return ""
    t = text.replace("<br/>", "\n").replace("<br>", "\n").replace("<br />", "\n")
    t = re.sub(r"<[^>]+>", "", t)
    t = htmllib.unescape(t)
    return t.strip()


class LodgifyAdapter:
    """Thin async client for the Lodgify Public API v2. Auth via X-ApiKey header."""

    BASE = "https://api.lodgify.com/v2"

    def __init__(self, api_key: str):
        self.api_key = api_key

    def _headers(self):
        return {"X-ApiKey": self.api_key, "Accept": "application/json"}

    async def _get(self, http: httpx.AsyncClient, path: str, params: dict = None):
        for attempt in range(3):
            r = await http.get(f"{self.BASE}{path}", params=params or {}, headers=self._headers())
            if r.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                await asyncio.sleep(2 ** attempt)
                continue
            if r.status_code == 401 or r.status_code == 403:
                raise HTTPException(status_code=400, detail="Clé API Lodgify invalide")
            if r.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"Lodgify {r.status_code}")
            return r.json()
        raise HTTPException(status_code=502, detail="Lodgify indisponible")

    async def validate(self, http):
        body = await self._get(http, "/properties", {"page": 1, "size": 1, "includeCount": "true"})
        return body.get("count", len(body.get("items", [])))

    async def list_properties(self, http):
        page, out = 1, []
        while True:
            body = await self._get(http, "/properties", {"page": page, "size": 50, "includeCount": "true"})
            items = body.get("items", [])
            out.extend(items)
            if len(items) < 50:
                return out
            page += 1

    async def list_bookings(self, http, stay="All"):
        page, out = 1, []
        while True:
            body = await self._get(http, "/reservations/bookings",
                                   {"page": page, "size": 50, "stayFilter": stay, "includeCount": "true"})
            items = body.get("items", [])
            out.extend(items)
            if len(items) < 50 or page >= 20:
                return out
            page += 1

    async def get_thread(self, http, uid):
        return await self._get(http, f"/messaging/{uid}")

    async def send_message(self, http, booking_id: str, message: str, subject: str = ""):
        payload = [{
            "subject": subject or "Re:",
            "message": message,
            "type": "Owner",
            "send_notification": True,
        }]
        r = await http.post(
            f"https://api.lodgify.com/v1/reservation/{booking_id}/messages",
            json=payload,
            headers={**self._headers(), "Content-Type": "application/json"},
        )
        if r.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Lodgify envoi {r.status_code}")
        return r.status_code


def map_lodgify_property(lp: dict) -> dict:
    img = lp.get("image_url") or ""
    if img.startswith("//"):
        img = "https:" + img
    return {
        "name": lp.get("name") or lp.get("internal_name") or f"Logement {lp.get('id')}",
        "location": lp.get("city") or lp.get("country") or "",
        "image_url": img,
        "base_price": 0,
        "capacity": 2,
        "bedrooms": 1,
        "owner": "",
        "surface": 0,
        "address": lp.get("address") or "",
        "postal_code": lp.get("zip") or "",
        "city": lp.get("city") or "",
        "address_complement": "",
        "description": strip_html(lp.get("description") or "")[:1000],
        "rooms": [],
        "amenities": [],
        "seasons": [],
        "ical_links": [],
        "lodgify_id": str(lp.get("id")),
    }
