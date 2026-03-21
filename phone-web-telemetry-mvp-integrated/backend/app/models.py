from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


Role = Literal["mobile_sender", "pc_viewer", "admin"]
MessageType = Literal[
    "join",
    "joined",
    "sensor_batch",
    "device_state",
    "command",
    "ack",
    "offer",
    "answer",
    "ice_candidate",
    "heartbeat",
    "error",
]


class Envelope(BaseModel):
    type: MessageType
    session_id: str
    device_id: Optional[str] = None
    target_device_id: Optional[str] = None
    payload: dict[str, Any] = Field(default_factory=dict)


class SessionCreateRequest(BaseModel):
    session_id: str


class DeviceInfo(BaseModel):
    device_id: str
    role: Role
    capabilities: dict[str, Any] = Field(default_factory=dict)
    last_seen_at: float


class SessionInfo(BaseModel):
    session_id: str
    devices: list[DeviceInfo]
    latest_sensor: dict[str, Any] = Field(default_factory=dict)


class VehicleBaseRequest(BaseModel):
    base_url: str


class VehicleMoveRequest(VehicleBaseRequest):
    move: Literal["forward", "back", "left", "right", "stop", "ping"]


class BatterySetRequest(VehicleBaseRequest):
    target_current: float
