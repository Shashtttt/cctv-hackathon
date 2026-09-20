"""
IBVAP — Loitering & Dwell-Time Tracker
Maintains per-target, per-camera dwell timers and trajectory history.
Thread-safe for use from concurrent camera workers.
"""

from __future__ import annotations

import datetime
import threading
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Deque, Dict, Optional, Tuple

from ..config import settings


@dataclass
class DwellRecord:
    target_id: str
    camera_id: str
    entry_time: Optional[datetime.datetime] = None
    last_seen: datetime.datetime = field(default_factory=datetime.datetime.utcnow)
    dwell_seconds: float = 0.0
    is_in_zone: bool = False
    alerted: bool = False                # True once loitering alert has been fired
    positions: Deque[Tuple[float, float]] = field(
        default_factory=lambda: deque(maxlen=120)   # last 120 frames ~4s at 30fps
    )


class LoiteringTracker:
    """
    Tracks how long each target has been inside each virtual fence zone.
    One instance per camera worker (no cross-camera sharing needed).
    """

    def __init__(
        self,
        camera_id: str,
        loitering_threshold: float = settings.LOITERING_TIMEOUT_SECONDS,
    ) -> None:
        self.camera_id = camera_id
        self.threshold = loitering_threshold
        self._lock = threading.Lock()
        self._records: Dict[str, DwellRecord] = {}
        self._last_cleanup = datetime.datetime.utcnow()


    def update(
        self,
        target_id: str,
        is_in_zone: bool,
        position: Optional[Tuple[float, float]] = None,
        now: Optional[datetime.datetime] = None,
    ) -> DwellRecord:
        """
        Call once per frame per target.
        Returns the updated DwellRecord with current dwell_seconds.
        """
        if now is None:
            now = datetime.datetime.utcnow()

        with self._lock:
            rec = self._records.get(target_id)
            if rec is None:
                rec = DwellRecord(target_id=target_id, camera_id=self.camera_id)
                self._records[target_id] = rec

            rec.last_seen = now

            if position:
                rec.positions.append(position)

            if is_in_zone:
                if not rec.is_in_zone:
                    # Target just entered zone — start timer
                    rec.entry_time = now
                    rec.is_in_zone = True
                    rec.alerted = False
                else:
                    # Still in zone — accumulate dwell time
                    if rec.entry_time:
                        rec.dwell_seconds = (now - rec.entry_time).total_seconds()
            else:
                # Target left zone — reset timer
                rec.is_in_zone = False
                rec.dwell_seconds = 0.0
                rec.entry_time = None
                rec.alerted = False

            return rec

    def is_loitering(self, target_id: str) -> bool:
        """Return True if target has exceeded the loitering threshold."""
        with self._lock:
            rec = self._records.get(target_id)
            if rec is None:
                return False
            return rec.is_in_zone and rec.dwell_seconds >= self.threshold

    def should_fire_loitering_alert(self, target_id: str) -> bool:
        """
        Returns True once per loitering event (resets when target exits zone).
        Prevents repeated alerts for the same loitering event.
        """
        with self._lock:
            rec = self._records.get(target_id)
            if rec is None:
                return False
            if rec.is_in_zone and rec.dwell_seconds >= self.threshold and not rec.alerted:
                rec.alerted = True
                return True
            return False

    def get_dwell_seconds(self, target_id: str) -> float:
        """Return current dwell time for a target."""
        with self._lock:
            rec = self._records.get(target_id)
            return rec.dwell_seconds if rec else 0.0

    def get_all_records(self) -> Dict[str, DwellRecord]:
        with self._lock:
            return dict(self._records)

    def remove_target(self, target_id: str) -> None:
        with self._lock:
            self._records.pop(target_id, None)

    def cleanup_stale(self, stale_seconds: float = 30.0) -> int:
        """Remove records for targets not seen in the last stale_seconds. Returns count removed."""
        now = datetime.datetime.utcnow()
        with self._lock:
            stale_ids = [
                tid for tid, rec in self._records.items()
                if (now - rec.last_seen).total_seconds() > stale_seconds
            ]
            for tid in stale_ids:
                del self._records[tid]
        return len(stale_ids)

    def is_stationary(self, target_id: str, variance_threshold: float = 0.002) -> bool:
        """
        Returns True if the target's recent trajectory has very low variance
        (useful to distinguish loitering from slow movement vs. genuinely stationary).
        """
        with self._lock:
            rec = self._records.get(target_id)
            if not rec or len(rec.positions) < 10:
                return False
            xs = [p[0] for p in rec.positions]
            ys = [p[1] for p in rec.positions]
            import statistics
            var_x = statistics.variance(xs) if len(xs) > 1 else 0
            var_y = statistics.variance(ys) if len(ys) > 1 else 0
            return (var_x + var_y) < variance_threshold
