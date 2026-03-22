from __future__ import annotations

from .control_engine import ControlEngine
from .models import TelemetryFrame
from .telemetry_store import TelemetryStore
from .vehicle_bridge import VehicleBridge
from .vision_processor import VisionHint, VisionProcessor


class LocalPipeline:
    def __init__(self) -> None:
        self.store = TelemetryStore()
        self.vision = VisionProcessor()
        self.control = ControlEngine()
        self.vehicle = VehicleBridge()

    def ingest_telemetry(self, telemetry: TelemetryFrame) -> None:
        self.store.append(telemetry)
        vision_hint = VisionHint()
        command = self.control.step(telemetry, vision_hint)
        if command is not None:
            self.vehicle.send(command)
