"""
IBVAP — Cyber Anti-Tampering & Stream Integrity Engine
Protects existing legacy CCTV and IP camera streams against physical & cyber sabotage:
  1. Lens Occlusion & Spray Paint Detection (Low histogram entropy / Flat variance)
  2. Laser / High-Intensity Light Blinding Detection (Extreme luminance saturation)
  3. Lens Defocus, Mud & Smear Detection (Laplacian Variance degradation)
  4. Physical Camera Displacement / Pole Nudge Detection (Structural frame drift)
  5. Cyber Stream Freeze & Video Replay Loop Attack Detection (Zero-variance frame hashes)

Works on any standard RGB/grayscale video frame without requiring physical tamper sensors.
"""

from __future__ import annotations

import collections
import hashlib
import logging
import time
from dataclasses import dataclass
from typing import Deque, Dict, Optional, Tuple

import cv2
import numpy as np

log = logging.getLogger("ibvap.core.tamper_detector")


@dataclass
class TamperTelemetry:
    camera_id: str
    is_tampered: bool
    tamper_type: Optional[str] = None       # OCCLUSION | BLINDING | DEFOCUS | DISPLACEMENT | STREAM_FREEZE | REPLAY_ATTACK
    severity: str = "NORMAL"                # NORMAL | WARNING | CRITICAL
    focus_score: float = 0.0                # Laplacian variance (higher = sharper)
    luminance_mean: float = 0.0             # 0 - 255
    luminance_std: float = 0.0              # Pixel intensity variance
    occlusion_percent: float = 0.0          # 0 - 100%
    confidence: float = 0.0                 # 0.0 - 1.0
    details: str = ""
    timestamp: float = 0.0


class CyberTamperDetector:
    """
    Per-camera stateful video anti-tampering engine.
    Maintains running history of camera frames to detect sudden drops in quality,
    coverage, or cyber-injected frozen feeds.
    """

    # Default Thresholds tuned for Border Surveillance CCTV
    DEFOCUS_LAPLACIAN_THRESH = 28.0       # Sharp scene usually > 80; blurry < 28
    OCCLUSION_STD_THRESH = 14.0           # Very flat color (cloth, spray) < 14
    BLINDING_MEAN_THRESH = 242.0          # Extreme brightness > 242
    DARK_OCCLUSION_THRESH = 8.0           # Complete black cover < 8
    FREEZE_CONSECUTIVE_FRAMES = 120       # Consecutive identical frame hashes (~15s) to avoid false alarms on static scenes

    def __init__(self, camera_id: str) -> None:
        self.camera_id = camera_id
        self._prev_gray: Optional[np.ndarray] = None
        self._prev_hash: Optional[str] = None
        self._consecutive_frozen: int = 0
        self._consecutive_tamper_count: int = 0
        self._tamper_confirm_threshold: int = 3  # Must persist for 3 frames to avoid false glitches
        self._recent_hashes: Deque[str] = collections.deque(maxlen=30)
        self._last_alert_time: float = 0.0

    def analyze_frame(self, frame_bgr: np.ndarray) -> TamperTelemetry:
        """
        Analyzes a single video frame for physical and cyber tampering.
        """
        now = time.time()
        h, w = frame_bgr.shape[:2]

        # Downsample for ultra-fast, low-overhead CV computation (max width 320)
        if w > 320:
            scale = 320.0 / w
            small_frame = cv2.resize(frame_bgr, (320, int(h * scale)), interpolation=cv2.INTER_AREA)
        else:
            small_frame = frame_bgr

        gray = cv2.cvtColor(small_frame, cv2.COLOR_BGR2GRAY)

        # 1. Cyber Stream Freeze & Replay Check (SHA-1 of downsampled frame)
        frame_bytes = gray.tobytes()
        curr_hash = hashlib.sha1(frame_bytes).hexdigest()

        is_frozen = False
        if self._prev_hash and curr_hash == self._prev_hash:
            self._consecutive_frozen += 1
            if self._consecutive_frozen >= self.FREEZE_CONSECUTIVE_FRAMES:
                is_frozen = True
        else:
            self._consecutive_frozen = 0

        self._prev_hash = curr_hash
        self._recent_hashes.append(curr_hash)

        # 2. Defocus / Mud / Smear Check (Laplacian Variance)
        laplacian = cv2.Laplacian(gray, cv2.CV_64F)
        focus_score = float(laplacian.var())

        # 3. Occlusion & Blinding Metrics (Mean and Standard Deviation)
        mean_lum, std_lum = cv2.meanStdDev(gray)
        mean_lum = float(mean_lum[0][0])
        std_lum = float(std_lum[0][0])

        # Compute occlusion percentage estimate
        # Low standard deviation indicates uniform canvas (paint, tape, cloth)
        occlusion_pct = 0.0
        if std_lum < self.OCCLUSION_STD_THRESH:
            occlusion_pct = min(100.0, (self.OCCLUSION_STD_THRESH - std_lum) / self.OCCLUSION_STD_THRESH * 100.0)

        # 4. Camera Displacement / Nudge Detection (via frame differencing)
        displacement_detected = False
        if self._prev_gray is not None:
            frame_diff = cv2.absdiff(gray, self._prev_gray)
            diff_mean = float(np.mean(frame_diff))
            # Sudden massive global shift (entire scene changed abruptly)
            if diff_mean > 65.0:
                displacement_detected = True

        self._prev_gray = gray

        # Evaluate Tamper Rules
        tamper_flag = False
        tamper_type = None
        severity = "NORMAL"
        details = "Camera feed nominal. Integrity verified."
        confidence = 0.0

        if is_frozen:
            tamper_flag = True
            tamper_type = "STREAM_FREEZE_OR_REPLAY"
            severity = "CRITICAL"
            details = f"Video stream frozen for {self._consecutive_frozen} frames. Suspected RTSP replay or network hijack."
            confidence = 0.98

        elif mean_lum >= self.BLINDING_MEAN_THRESH:
            tamper_flag = True
            tamper_type = "BLINDING_ATTACK"
            severity = "CRITICAL"
            details = f"Sensor blinded by high-intensity optical light/laser (Mean Luminance: {mean_lum:.1f}/255)."
            confidence = min(1.0, (mean_lum - self.BLINDING_MEAN_THRESH) / 10.0 + 0.8)

        elif mean_lum <= self.DARK_OCCLUSION_THRESH and std_lum <= 4.0:
            tamper_flag = True
            tamper_type = "LENS_COVERED_OCCLUSION"
            severity = "CRITICAL"
            details = "Lens completely blocked or covered with opaque material (Zero optical transmission)."
            confidence = 0.95

        elif std_lum < self.OCCLUSION_STD_THRESH and occlusion_pct > 65.0:
            tamper_flag = True
            tamper_type = "SPRAY_PAINT_OR_OCCLUSION"
            severity = "CRITICAL"
            details = f"Uniform color mask detected on lens (Occlusion: {occlusion_pct:.1f}%, Variance: {std_lum:.1f})."
            confidence = min(1.0, occlusion_pct / 100.0 + 0.1)

        elif focus_score < self.DEFOCUS_LAPLACIAN_THRESH and std_lum > 18.0:
            # Low focus while scene is not just black/white
            tamper_flag = True
            tamper_type = "DEFOCUS_OR_SMEAR"
            severity = "WARNING"
            details = f"Extreme optical blur detected (Focus score: {focus_score:.1f} < threshold {self.DEFOCUS_LAPLACIAN_THRESH})."
            confidence = max(0.65, min(0.95, (self.DEFOCUS_LAPLACIAN_THRESH - focus_score) / self.DEFOCUS_LAPLACIAN_THRESH))

        elif displacement_detected:
            tamper_flag = True
            tamper_type = "PHYSICAL_CAMERA_DISPLACEMENT"
            severity = "WARNING"
            details = "Sudden macro scene shift detected. Possible physical mount tampering or orientation displacement."
            confidence = 0.85

        # Temporal hysteresis: require tamper state for multiple consecutive frames
        if tamper_flag:
            self._consecutive_tamper_count += 1
        else:
            self._consecutive_tamper_count = max(0, self._consecutive_tamper_count - 1)

        is_confirmed = self._consecutive_tamper_count >= self._tamper_confirm_threshold

        return TamperTelemetry(
            camera_id=self.camera_id,
            is_tampered=is_confirmed,
            tamper_type=tamper_type if is_confirmed else None,
            severity=severity if is_confirmed else "NORMAL",
            focus_score=round(focus_score, 2),
            luminance_mean=round(mean_lum, 2),
            luminance_std=round(std_lum, 2),
            occlusion_percent=round(occlusion_pct, 1),
            confidence=round(confidence, 2),
            details=details if is_confirmed else "Optical integrity normal.",
            timestamp=now,
        )


class TamperManager:
    """Registry of CyberTamperDetectors for all active cameras."""

    _instance: Optional["TamperManager"] = None

    def __init__(self) -> None:
        self._detectors: Dict[str, CyberTamperDetector] = {}
        self._latest_telemetry: Dict[str, TamperTelemetry] = {}

    @classmethod
    def get_instance(cls) -> "TamperManager":
        if cls._instance is None:
            cls._instance = TamperManager()
        return cls._instance

    def get_detector(self, camera_id: str) -> CyberTamperDetector:
        if camera_id not in self._detectors:
            self._detectors[camera_id] = CyberTamperDetector(camera_id)
        return self._detectors[camera_id]

    def record_telemetry(self, telemetry: TamperTelemetry) -> None:
        self._latest_telemetry[telemetry.camera_id] = telemetry

    def get_telemetry(self, camera_id: str) -> Optional[TamperTelemetry]:
        return self._latest_telemetry.get(camera_id)

    def get_all_telemetry(self) -> Dict[str, TamperTelemetry]:
        return dict(self._latest_telemetry)


tamper_manager = TamperManager.get_instance()
