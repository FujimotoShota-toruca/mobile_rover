from __future__ import annotations

import json
import time

from .models import TelemetryFrame
from .pipeline import LocalPipeline


SAMPLE = {
    "type": "telemetry",
    "deviceId": "mobile-001",
    "timestamp": 1774000000123,
    "motion": {
        "accel": {"x": 0.1, "y": -0.2, "z": 9.7},
        "rotationRate": {"alpha": 0.01, "beta": 0.02, "gamma": -0.01},
    },
    "orientation": {"alpha": 10.0, "beta": -5.0, "gamma": 30.0},
}


def main() -> None:
    pipe = LocalPipeline()
    for i in range(3):
        payload = dict(SAMPLE)
        payload["timestamp"] = int(time.time() * 1000)
        payload["motion"] = {
            **SAMPLE["motion"],
            "accel": {"x": i * 0.1, "y": -0.2, "z": 9.7},
        }
        frame = TelemetryFrame.model_validate(payload)
        pipe.ingest_telemetry(frame)
        print(json.dumps(frame.model_dump(by_alias=True), indent=2))
        time.sleep(0.2)


if __name__ == "__main__":
    main()
