from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

from .base import VehicleBridge


class HttpVehicleBridge(VehicleBridge):
    def _normalize_base_url(self, base_url: str) -> str:
        normalized = base_url.strip().rstrip("/")
        if not normalized.startswith(("http://", "https://")):
            normalized = f"http://{normalized}"
        return normalized

    async def _fetch_json_or_text(self, url: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            if "application/json" in content_type:
                return {
                    "ok": True,
                    "url": url,
                    "payload": response.json(),
                }
            return {
                "ok": True,
                "url": url,
                "payload": {"text": response.text},
            }

    async def ping(self, base_url: str) -> dict[str, Any]:
        return await self._fetch_json_or_text(f"{self._normalize_base_url(base_url)}/ping")

    async def move(self, base_url: str, move: str) -> dict[str, Any]:
        return await self._fetch_json_or_text(
            f"{self._normalize_base_url(base_url)}/cmd?move={quote(move)}"
        )

    async def battery_status(self, base_url: str) -> dict[str, Any]:
        return await self._fetch_json_or_text(f"{self._normalize_base_url(base_url)}/battery/status")

    async def battery_action(self, base_url: str, action: str) -> dict[str, Any]:
        return await self._fetch_json_or_text(
            f"{self._normalize_base_url(base_url)}/battery/{quote(action)}"
        )

    async def battery_set(self, base_url: str, target_current: float) -> dict[str, Any]:
        return await self._fetch_json_or_text(
            f"{self._normalize_base_url(base_url)}/battery/set?target_current={quote(str(target_current))}"
        )
