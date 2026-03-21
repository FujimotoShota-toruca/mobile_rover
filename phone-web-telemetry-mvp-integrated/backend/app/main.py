from __future__ import annotations

import os
import time
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .control_bridge import HttpVehicleBridge
from .models import (
    BatterySetRequest,
    DeviceInfo,
    Envelope,
    SessionCreateRequest,
    SessionInfo,
    VehicleBaseRequest,
    VehicleMoveRequest,
)
from .session_manager import SessionManager


app = FastAPI(title="phone-web-telemetry-mvp")
manager = SessionManager()
vehicle_bridge = HttpVehicleBridge()

cors_allow_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ALLOW_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,https://localhost:5173",
    ).split(",")
    if origin.strip()
]
cors_allow_origin_regex = os.getenv(
    "CORS_ALLOW_ORIGIN_REGEX",
    r"^https?://([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+(?::\d+)?$",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_allow_origins,
    allow_origin_regex=cors_allow_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "ts": time.time()}


@app.post("/api/sessions")
async def create_session(req: SessionCreateRequest) -> dict[str, str]:
    manager.ensure_session(req.session_id)
    return {"session_id": req.session_id}


@app.get("/api/sessions/{session_id}", response_model=SessionInfo)
async def get_session(session_id: str) -> SessionInfo:
    session = manager.ensure_session(session_id)
    devices = [
        DeviceInfo(
            device_id=device.device_id,
            role=device.role,
            capabilities=device.capabilities,
            last_seen_at=device.last_seen_at,
        )
        for device in session.devices.values()
    ]
    return SessionInfo(
        session_id=session_id,
        devices=devices,
        latest_sensor=session.latest_sensor,
    )


@app.post("/api/vehicle/ping")
async def vehicle_ping(req: VehicleBaseRequest) -> dict[str, Any]:
    try:
        return await vehicle_bridge.ping(req.base_url)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/vehicle/move")
async def vehicle_move(req: VehicleMoveRequest) -> dict[str, Any]:
    try:
        return await vehicle_bridge.move(req.base_url, req.move)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/vehicle/battery/status")
async def vehicle_battery_status(req: VehicleBaseRequest) -> dict[str, Any]:
    try:
        return await vehicle_bridge.battery_status(req.base_url)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/vehicle/battery/action/{action}")
async def vehicle_battery_action(action: str, req: VehicleBaseRequest) -> dict[str, Any]:
    if action not in {"start", "stop", "monitor"}:
        raise HTTPException(status_code=400, detail=f"unsupported battery action: {action}")
    try:
        return await vehicle_bridge.battery_action(req.base_url, action)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/vehicle/battery/set")
async def vehicle_battery_set(req: BatterySetRequest) -> dict[str, Any]:
    try:
        return await vehicle_bridge.battery_set(req.base_url, req.target_current)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.websocket("/ws/session/{session_id}")
async def session_ws(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    current_device_id: str | None = None

    try:
        join_message = await websocket.receive_json()
        envelope = Envelope.model_validate(join_message)

        if envelope.type != "join" or not envelope.device_id:
            await websocket.send_json(
                {
                    "type": "error",
                    "session_id": session_id,
                    "payload": {"message": "first message must be join"},
                }
            )
            await websocket.close(code=1008)
            return

        current_device_id = envelope.device_id
        role = str(envelope.payload.get("role", "mobile_sender"))
        capabilities = envelope.payload.get("capabilities", {})

        await manager.register(
            session_id=session_id,
            device_id=current_device_id,
            role=role,
            websocket=websocket,
            capabilities=capabilities,
        )

        await websocket.send_json(
            {
                "type": "joined",
                "session_id": session_id,
                "device_id": current_device_id,
                "payload": {"server_time": time.time()},
            }
        )

        await manager.broadcast(
            session_id,
            {
                "type": "device_state",
                "session_id": session_id,
                "device_id": current_device_id,
                "payload": {
                    "online": True,
                    "role": role,
                    "capabilities": capabilities,
                },
            },
        )

        while True:
            raw = await websocket.receive_json()
            envelope = Envelope.model_validate(raw)
            if envelope.device_id:
                manager.touch(session_id, envelope.device_id)

            if envelope.type in {"sensor_batch", "device_state", "heartbeat"}:
                if envelope.type == "sensor_batch" and envelope.device_id:
                    manager.save_latest_sensor(session_id, envelope.device_id, envelope.payload)
                await manager.broadcast(session_id, envelope.model_dump())
                continue

            if envelope.type in {"command", "ack", "offer", "answer", "ice_candidate"}:
                target = envelope.target_device_id
                if not target:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "session_id": session_id,
                            "device_id": current_device_id,
                            "payload": {"message": "target_device_id is required"},
                        }
                    )
                    continue

                ok = await manager.send_to(session_id, target, envelope.model_dump())
                if not ok:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "session_id": session_id,
                            "device_id": current_device_id,
                            "payload": {"message": f"target device not found: {target}"},
                        }
                    )
                continue

            await websocket.send_json(
                {
                    "type": "error",
                    "session_id": session_id,
                    "device_id": current_device_id,
                    "payload": {"message": f"unsupported message type: {envelope.type}"},
                }
            )

    except WebSocketDisconnect:
        pass
    finally:
        if current_device_id:
            manager.unregister(session_id, current_device_id)
