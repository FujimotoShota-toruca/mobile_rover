from __future__ import annotations

from collections import deque
from typing import Deque, Iterable

from .models import TelemetryFrame


class TelemetryStore:
    def __init__(self, maxlen: int = 5000) -> None:
        self._frames: Deque[TelemetryFrame] = deque(maxlen=maxlen)

    def append(self, frame: TelemetryFrame) -> None:
        self._frames.append(frame)

    def latest(self) -> TelemetryFrame | None:
        return self._frames[-1] if self._frames else None

    def tail(self, n: int = 10) -> Iterable[TelemetryFrame]:
        return list(self._frames)[-n:]
