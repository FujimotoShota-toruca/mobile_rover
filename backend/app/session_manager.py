from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket


@dataclass
class DeviceConnection:
    device_id: str
    role: str
    websocket: WebSocket
    capabilities: dict[str, Any] = field(default_factory=dict)
    last_seen_at: float = field(default_factory=time.time)


@dataclass
class SessionState:
    session_id: str
    devices: dict[str, DeviceConnection] = field(default_factory=dict)
    latest_sensor: dict[str, Any] = field(default_factory=dict)


class SessionManager:
    def __init__(self) -> None:
        self.sessions: dict[str, SessionState] = {}

    def ensure_session(self, session_id: str) -> SessionState:
        if session_id not in self.sessions:
            self.sessions[session_id] = SessionState(session_id=session_id)
        return self.sessions[session_id]

    async def register(
        self,
        session_id: str,
        device_id: str,
        role: str,
        websocket: WebSocket,
        capabilities: dict[str, Any],
    ) -> None:
        session = self.ensure_session(session_id)
        session.devices[device_id] = DeviceConnection(
            device_id=device_id,
            role=role,
            websocket=websocket,
            capabilities=capabilities,
        )

    def unregister(self, session_id: str, device_id: str) -> None:
        session = self.sessions.get(session_id)
        if not session:
            return
        session.devices.pop(device_id, None)
        if not session.devices:
            self.sessions.pop(session_id, None)

    def touch(self, session_id: str, device_id: str) -> None:
        session = self.sessions.get(session_id)
        if not session or device_id not in session.devices:
            return
        session.devices[device_id].last_seen_at = time.time()

    def save_latest_sensor(self, session_id: str, device_id: str, payload: dict[str, Any]) -> None:
        session = self.ensure_session(session_id)
        session.latest_sensor[device_id] = payload
        self.touch(session_id, device_id)

    async def broadcast(self, session_id: str, message: dict[str, Any]) -> None:
        session = self.sessions.get(session_id)
        if not session:
            return
        stale: list[str] = []
        for device_id, conn in session.devices.items():
            try:
                await conn.websocket.send_json(message)
            except Exception:
                stale.append(device_id)
        for device_id in stale:
            self.unregister(session_id, device_id)

    async def send_to(self, session_id: str, target_device_id: str, message: dict[str, Any]) -> bool:
        session = self.sessions.get(session_id)
        if not session:
            return False
        conn = session.devices.get(target_device_id)
        if not conn:
            return False
        try:
            await conn.websocket.send_json(message)
            return True
        except Exception:
            self.unregister(session_id, target_device_id)
            return False
