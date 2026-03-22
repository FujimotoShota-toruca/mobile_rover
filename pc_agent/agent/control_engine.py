from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .models import TelemetryFrame
from .vision_processor import VisionHint


@dataclass
class ControlCommand:
    mode: str
    payload: dict


class ControlEngine:
    def step(
        self,
        telemetry: Optional[TelemetryFrame],
        vision_hint: Optional[VisionHint],
    ) -> ControlCommand | None:
        if telemetry is None:
            return None

        # TODO: ここにローバー制御則を差し込む
        return ControlCommand(mode="noop", payload={})
