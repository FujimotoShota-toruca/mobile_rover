from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field


class Vector3(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0


class RotationRate(BaseModel):
    alpha: float = 0.0
    beta: float = 0.0
    gamma: float = 0.0


class Orientation(BaseModel):
    alpha: Optional[float] = None
    beta: Optional[float] = None
    gamma: Optional[float] = None


class Motion(BaseModel):
    accel: Vector3 = Field(default_factory=Vector3)
    rotation_rate: RotationRate = Field(default_factory=RotationRate, alias="rotationRate")


class TelemetryFrame(BaseModel):
    type: Literal["telemetry"]
    device_id: str = Field(alias="deviceId")
    timestamp: int
    motion: Motion = Field(default_factory=Motion)
    orientation: Orientation = Field(default_factory=Orientation)


class CommandMessage(BaseModel):
    type: Literal["command"]
    command_id: str = Field(alias="commandId")
    command: str
    params: dict = Field(default_factory=dict)
    timestamp: int


class AckMessage(BaseModel):
    type: Literal["ack"]
    command_id: str = Field(alias="commandId")
    status: Literal["ok", "error"]
    message: Optional[str] = None
    timestamp: int
