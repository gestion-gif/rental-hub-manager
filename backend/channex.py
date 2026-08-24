"""Channex.io Public API v1 integration layer (provider-neutral adapter).

Self-contained: no database dependency. Imported by server.py.
Auth via `user-api-key` header. Read-only foundation (properties / room types /
rate plans). Writes (ARI) and bookings/webhooks are added in later phases.
"""
import asyncio
from typing import Optional

import httpx
from fastapi import HTTPException

CHANNEX_BASES = {
    "staging": "https://staging.channex.io/api/v1",
    "production": "https://app.channex.io/api/v1",
}


def base_for(environment: str) -> str:
    return CHANNEX_BASES.get((environment or "staging").lower(), CHANNEX_BASES["staging"])


class ChannexAdapter:
    """Thin async client for the Channex Public API v1. Auth via user-api-key header."""

    def __init__(self, api_key: str, environment: str = "staging"):
        self.api_key = api_key
        self.environment = (environment or "staging").lower()
        self.base = base_for(self.environment)

    def _headers(self):
        return {"user-api-key": self.api_key, "Content-Type": "application/json"}

    async def _get(self, http: httpx.AsyncClient, path: str, params: dict = None):
        for attempt in range(3):
            r = await http.get(f"{self.base}{path}", params=params or {}, headers=self._headers())
            if r.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                await asyncio.sleep(2 ** attempt)
                continue
            if r.status_code in (401, 403):
                raise HTTPException(status_code=400, detail="Clé API Channex invalide")
            if r.status_code == 404:
                raise HTTPException(status_code=400, detail="API Channex introuvable (vérifiez l'environnement staging/production)")
            if r.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"Channex {r.status_code}")
            return r.json()
        raise HTTPException(status_code=502, detail="Channex indisponible")

    @staticmethod
    def _page(page=1, limit=100):
        return {"pagination[page]": page, "pagination[limit]": min(limit, 100)}

    async def validate(self, http) -> int:
        """Returns the number of properties visible with this key (also proves auth)."""
        body = await self._get(http, "/properties", self._page(1, 100))
        meta = body.get("meta") or {}
        return int(meta.get("total", len(body.get("data", []))))

    async def list_properties(self, http) -> list:
        page, out = 1, []
        while True:
            body = await self._get(http, "/properties", self._page(page, 100))
            data = body.get("data", [])
            out.extend(data)
            meta = body.get("meta") or {}
            total = int(meta.get("total", len(out)))
            if len(out) >= total or not data:
                return out
            page += 1

    async def list_room_types(self, http, property_id: str) -> list:
        body = await self._get(http, "/room_types",
                               {**self._page(), "filter[property_id]": property_id})
        return body.get("data", [])

    async def list_rate_plans(self, http, property_id: str) -> list:
        body = await self._get(http, "/rate_plans",
                               {**self._page(), "filter[property_id]": property_id})
        return body.get("data", [])

    async def _post(self, http: httpx.AsyncClient, path: str, payload: dict):
        """POST with retry/backoff on 429 & 5xx (respects Channex rate limits)."""
        for attempt in range(4):
            r = await http.post(f"{self.base}{path}", json=payload, headers=self._headers())
            if (r.status_code == 429 or r.status_code >= 500) and attempt < 3:
                await asyncio.sleep(2 ** attempt)
                continue
            if r.status_code in (401, 403):
                raise HTTPException(status_code=400, detail="Clé API Channex invalide")
            if r.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"Channex {r.status_code}: {r.text[:200]}")
            return r.json()
        raise HTTPException(status_code=502, detail="Channex indisponible")

    async def push_availability(self, http, values: list) -> list:
        """1 appel: disponibilité (toutes chambres). Retourne les task ids Channex."""
        body = await self._post(http, "/availability", {"values": values})
        return [t.get("id") for t in (body.get("data") or []) if isinstance(t, dict)]

    async def push_restrictions(self, http, values: list) -> list:
        """1 appel: tarifs + restrictions (tous rate plans). Retourne les task ids Channex."""
        body = await self._post(http, "/restrictions", {"values": values})
        return [t.get("id") for t in (body.get("data") or []) if isinstance(t, dict)]

    async def booking_feed(self, http) -> list:
        """Révisions de réservation NON acquittées (source primaire des réservations Channex)."""
        body = await self._get(http, "/booking_revisions/feed")
        return body.get("data", [])

    async def ack_revision(self, http, revision_id: str):
        """Acquitte une révision : elle ne réapparaîtra plus dans le feed."""
        return await self._post(http, f"/booking_revisions/{revision_id}/ack", {})

    async def send_booking_message(self, http, booking_id: str, message: str):
        """Envoie un message dans le fil de la réservation (Booking.com / Airbnb via Channex)."""
        return await self._post(http, f"/bookings/{booking_id}/messages", {"message": {"message": message}})

    async def list_webhooks(self, http) -> list:
        body = await self._get(http, "/webhooks")
        return body.get("data", [])

    async def create_webhook(self, http, callback_url: str, event_mask: str = "booking"):
        payload = {"webhook": {"callback_url": callback_url, "event_mask": event_mask,
                               "is_active": True, "send_data": True, "is_global": True}}
        return await self._post(http, "/webhooks", payload)

    async def list_rates(self, http, property_id: str, date_from: str, date_to: str) -> dict:
        """Nightly rates (ARI) for a property over a window.
        Returns {rate_plan_id: {date: {'rate': '150.00', ...}}}. Rates are already in main
        currency units (e.g. '150.00' EUR)."""
        q = {"filter[property_id]": property_id, "filter[date][gte]": date_from,
             "filter[date][lte]": date_to, "filter[restrictions][]": "rate"}
        body = await self._get(http, "/restrictions", q)
        data = body.get("data")
        return data if isinstance(data, dict) else {}


def map_channex_property(p: dict) -> dict:
    """Normalize a Channex property record to a light provider-neutral shape."""
    a = (p or {}).get("attributes") or {}
    return {
        "channex_id": p.get("id"),
        "title": a.get("title") or a.get("name") or "(sans nom)",
        "currency": a.get("currency"),
        "country": a.get("country"),
        "city": a.get("city"),
        "property_type": a.get("property_type"),
    }


def map_channex_room(r: dict) -> dict:
    a = (r or {}).get("attributes") or {}
    return {
        "channex_room_type_id": r.get("id"),
        "title": a.get("title") or a.get("name") or "(sans nom)",
        "occ_adults": a.get("occ_adults"),
        "count_of_rooms": a.get("count_of_rooms"),
    }


def map_channex_rate_plan(rp: dict) -> dict:
    a = (rp or {}).get("attributes") or {}
    return {
        "channex_rate_plan_id": rp.get("id"),
        "channex_room_type_id": a.get("room_type_id"),
        "title": a.get("title") or a.get("name") or "(sans nom)",
        "currency": a.get("currency"),
    }
