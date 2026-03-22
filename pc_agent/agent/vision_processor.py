from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class VisionHint:
    target_visible: bool = False
    lateral_error_px: float = 0.0
    confidence: float = 0.0


class VisionProcessor:
    def process_frame(self, frame: Any) -> VisionHint:
        # TODO: OpenCV / AprilTag / line trace / object detection などをここへ追加
        return VisionHint()
