from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class VehicleBridge(ABC):
    @abstractmethod
    async def ping(self, base_url: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    async def move(self, base_url: str, move: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    async def battery_status(self, base_url: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    async def battery_action(self, base_url: str, action: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    async def battery_set(self, base_url: str, target_current: float) -> dict[str, Any]:
        raise NotImplementedError
