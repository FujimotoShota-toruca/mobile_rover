from __future__ import annotations

from fastapi.testclient import TestClient
import pytest

from app.main import app, manager


@pytest.fixture(autouse=True)
def reset_manager_state() -> None:
    manager.sessions.clear()
    yield
    manager.sessions.clear()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _join_message(session_id: str, device_id: str, role: str) -> dict:
    return {
        "type": "join",
        "session_id": session_id,
        "device_id": device_id,
        "payload": {
            "role": role,
            "capabilities": {
                "motion": role == "mobile_sender",
                "orientation": role == "mobile_sender",
                "camera": False,
            },
        },
    }


def _drain_until_type(ws, expected_type: str) -> dict:
    for _ in range(5):
        message = ws.receive_json()
        if message["type"] == expected_type:
            return message
    raise AssertionError(f"message type {expected_type} was not received")


def test_health_check(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "ts" in body


def test_create_session_and_get_session(client: TestClient) -> None:
    create_response = client.post("/api/sessions", json={"session_id": "lab-demo-001"})
    assert create_response.status_code == 200
    assert create_response.json()["session_id"] == "lab-demo-001"

    get_response = client.get("/api/sessions/lab-demo-001")
    assert get_response.status_code == 200
    body = get_response.json()
    assert body["session_id"] == "lab-demo-001"
    assert body["devices"] == []
    assert body["latest_sensor"] == {}


def test_ws_requires_join_as_first_message(client: TestClient) -> None:
    with client.websocket_connect("/ws/session/lab-demo-001") as ws:
        ws.send_json(
            {
                "type": "heartbeat",
                "session_id": "lab-demo-001",
                "device_id": "pc-001",
                "payload": {},
            }
        )
        error_message = ws.receive_json()
        assert error_message["type"] == "error"
        assert error_message["payload"]["message"] == "first message must be join"



def test_sensor_command_and_ack_flow(client: TestClient) -> None:
    session_id = "lab-demo-001"

    with client.websocket_connect(f"/ws/session/{session_id}") as pc_ws:
        pc_ws.send_json(_join_message(session_id, "pc-001", "pc_viewer"))
        assert _drain_until_type(pc_ws, "joined")["device_id"] == "pc-001"
        _drain_until_type(pc_ws, "device_state")

        with client.websocket_connect(f"/ws/session/{session_id}") as mobile_ws:
            mobile_ws.send_json(_join_message(session_id, "mobile-001", "mobile_sender"))
            assert _drain_until_type(mobile_ws, "joined")["device_id"] == "mobile-001"
            _drain_until_type(mobile_ws, "device_state")

            pc_device_state = _drain_until_type(pc_ws, "device_state")
            assert pc_device_state["device_id"] == "mobile-001"

            sensor_message = {
                "type": "sensor_batch",
                "session_id": session_id,
                "device_id": "mobile-001",
                "payload": {
                    "sent_at": 1000,
                    "samples": [
                        {
                            "ts": 1000,
                            "motion": {
                                "accel": {"x": 1, "y": 2, "z": 3},
                                "gyro": {"x": 4, "y": 5, "z": 6},
                            },
                            "orientation": {"alpha": 7, "beta": 8, "gamma": 9},
                        }
                    ],
                },
            }
            mobile_ws.send_json(sensor_message)

            pc_sensor = _drain_until_type(pc_ws, "sensor_batch")
            assert pc_sensor["device_id"] == "mobile-001"
            assert pc_sensor["payload"]["samples"][0]["orientation"]["gamma"] == 9

            command_message = {
                "type": "command",
                "session_id": session_id,
                "device_id": "pc-001",
                "target_device_id": "mobile-001",
                "payload": {
                    "cmd_id": "cmd-001",
                    "command": "ping",
                    "params": {},
                },
            }
            pc_ws.send_json(command_message)

            mobile_command = _drain_until_type(mobile_ws, "command")
            assert mobile_command["payload"]["command"] == "ping"
            assert mobile_command["target_device_id"] == "mobile-001"

            ack_message = {
                "type": "ack",
                "session_id": session_id,
                "device_id": "mobile-001",
                "target_device_id": "pc-001",
                "payload": {
                    "cmd_id": "cmd-001",
                    "status": "ok",
                    "executed_at": 2000,
                },
            }
            mobile_ws.send_json(ack_message)

            pc_ack = _drain_until_type(pc_ws, "ack")
            assert pc_ack["payload"]["cmd_id"] == "cmd-001"
            assert pc_ack["payload"]["status"] == "ok"

            session_response = client.get(f"/api/sessions/{session_id}")
            assert session_response.status_code == 200
            latest_sensor = session_response.json()["latest_sensor"]
            assert latest_sensor["mobile-001"]["samples"][0]["motion"]["accel"]["z"] == 3
