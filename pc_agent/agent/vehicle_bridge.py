from __future__ import annotations

from .control_engine import ControlCommand


class VehicleBridge:
    def send(self, command: ControlCommand) -> None:
        # TODO: Pico W / CanSat / rover の実IFに接続
        print(f"[vehicle_bridge] send => {command}")
