from __future__ import annotations

from typing import Any

from app.session_manager import SessionManager


class FakeWebSocket:
    def __init__(self, fail: bool = False) -> None:
        self.sent: list[dict[str, Any]] = []
        self.fail = fail

    async def send_json(self, message: dict[str, Any]) -> None:
        if self.fail:
            raise RuntimeError("send failed")
        self.sent.append(message)


async def _register_device(
    manager: SessionManager,
    session_id: str,
    device_id: str,
    role: str,
    websocket: FakeWebSocket,
) -> None:
    await manager.register(
        session_id=session_id,
        device_id=device_id,
        role=role,
        websocket=websocket,  # type: ignore[arg-type]
        capabilities={"motion": True},
    )


import pytest


@pytest.mark.asyncio
async def test_register_and_latest_sensor_save() -> None:
    manager = SessionManager()
    ws = FakeWebSocket()

    await _register_device(manager, "s1", "mobile-001", "mobile_sender", ws)
    manager.save_latest_sensor(
        "s1",
        "mobile-001",
        {"samples": [{"ts": 123, "orientation": {"alpha": 1}}]},
    )

    session = manager.ensure_session("s1")
    assert "mobile-001" in session.devices
    assert session.latest_sensor["mobile-001"]["samples"][0]["ts"] == 123


@pytest.mark.asyncio
async def test_broadcast_sends_to_all_connected_devices() -> None:
    manager = SessionManager()
    ws1 = FakeWebSocket()
    ws2 = FakeWebSocket()

    await _register_device(manager, "s1", "pc-001", "pc_viewer", ws1)
    await _register_device(manager, "s1", "mobile-001", "mobile_sender", ws2)

    message = {"type": "heartbeat", "session_id": "s1", "payload": {"ok": True}}
    await manager.broadcast("s1", message)

    assert ws1.sent[-1] == message
    assert ws2.sent[-1] == message


@pytest.mark.asyncio
async def test_send_to_returns_false_when_target_missing() -> None:
    manager = SessionManager()
    ws1 = FakeWebSocket()
    await _register_device(manager, "s1", "pc-001", "pc_viewer", ws1)

    ok = await manager.send_to("s1", "mobile-404", {"type": "command"})
    assert ok is False


@pytest.mark.asyncio
async def test_send_to_unregisters_stale_connection_on_send_error() -> None:
    manager = SessionManager()
    broken_ws = FakeWebSocket(fail=True)

    await _register_device(manager, "s1", "mobile-001", "mobile_sender", broken_ws)
    ok = await manager.send_to("s1", "mobile-001", {"type": "command"})

    assert ok is False
    assert "mobile-001" not in manager.ensure_session("s1").devices
