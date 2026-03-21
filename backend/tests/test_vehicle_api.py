from __future__ import annotations

from fastapi.testclient import TestClient
import pytest

from app.main import app, vehicle_bridge


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.mark.asyncio
async def test_vehicle_move_endpoint(monkeypatch) -> None:
    async def fake_move(base_url: str, move: str) -> dict:
        return {"ok": True, "url": f"{base_url}/cmd?move={move}", "payload": {"text": "ACK"}}

    monkeypatch.setattr(vehicle_bridge, "move", fake_move)
    with TestClient(app) as client:
        response = client.post(
            "/api/vehicle/move",
            json={"base_url": "http://example.local", "move": "forward"},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["payload"]["text"] == "ACK"


def test_vehicle_battery_status_endpoint(monkeypatch, client: TestClient) -> None:
    async def fake_status(base_url: str) -> dict:
        return {"ok": True, "payload": {"state": "MONITOR", "vbat": 5.1}}

    monkeypatch.setattr(vehicle_bridge, "battery_status", fake_status)
    response = client.post("/api/vehicle/battery/status", json={"base_url": "http://example.local"})
    assert response.status_code == 200
    body = response.json()
    assert body["payload"]["state"] == "MONITOR"
    assert body["payload"]["vbat"] == 5.1
