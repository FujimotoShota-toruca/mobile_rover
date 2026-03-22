from agent.models import TelemetryFrame
from agent.telemetry_store import TelemetryStore


def test_store_latest() -> None:
    store = TelemetryStore(maxlen=3)
    frame = TelemetryFrame.model_validate(
        {
            "type": "telemetry",
            "deviceId": "mobile-001",
            "timestamp": 1,
            "motion": {
                "accel": {"x": 0.0, "y": 0.0, "z": 1.0},
                "rotationRate": {"alpha": 0.0, "beta": 0.0, "gamma": 0.0},
            },
            "orientation": {"alpha": 0.0, "beta": 0.0, "gamma": 0.0},
        }
    )
    store.append(frame)
    assert store.latest() is not None
    assert store.latest().device_id == "mobile-001"
