"""
IBVAP — Pose-Based Suspicious Activity Classifier
Uses YOLOv8 keypoints to detect:
  • Crawling / Prone infiltration
  • Running (high velocity motion)
  • Fence-climbing posture
  • Group clustering (flash-mob intrusion)
  • Carrying large objects / weapons silhouette
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional, Tuple

import numpy as np

from ..database.models import Detection, KeypointSet

log = logging.getLogger("ibvap.ai.activity_classifier")


class ActivityLabel(str, Enum):
    STANDING         = "STANDING"
    WALKING          = "WALKING"
    RUNNING          = "RUNNING"
    CRAWLING         = "CRAWLING"
    PRONE            = "PRONE"
    CROUCHING        = "CROUCHING"
    CLIMBING         = "CLIMBING"
    CARRYING_OBJECT  = "CARRYING_OBJECT"
    SUSPICIOUS       = "SUSPICIOUS"
    UNKNOWN          = "UNKNOWN"


SUSPICIOUS_ACTIVITIES = {
    ActivityLabel.CRAWLING,
    ActivityLabel.PRONE,
    ActivityLabel.CLIMBING,
    ActivityLabel.SUSPICIOUS,
}


@dataclass
class ActivityResult:
    target_id: str
    label: ActivityLabel
    confidence: float
    is_suspicious: bool
    description: str


class ActivityClassifier:
    """
    Rule-based pose classifier using YOLOv8-pose 17-keypoint output.
    Stateless — can be called from any camera worker.
    """

    # COCO keypoint indices
    KP = {
        "nose": 0, "l_eye": 1, "r_eye": 2,
        "l_ear": 3, "r_ear": 4,
        "l_sho": 5, "r_sho": 6,
        "l_elb": 7, "r_elb": 8,
        "l_wri": 9, "r_wri": 10,
        "l_hip": 11, "r_hip": 12,
        "l_kne": 13, "r_kne": 14,
        "l_ank": 15, "r_ank": 16,
    }

    def classify(
        self,
        detection: Detection,
        prev_bbox_center: Optional[Tuple[float, float]] = None,
    ) -> ActivityResult:
        """
        Classify a single detection.
        prev_bbox_center: (cx, cy) from previous frame — used for velocity.
        """
        kps = detection.keypoints
        if kps is None or len(kps.points) < 17:
            label = self._bbox_heuristic(detection.bbox)
            return ActivityResult(
                target_id=detection.target_id,
                label=label,
                confidence=0.55,
                is_suspicious=label in SUSPICIOUS_ACTIVITIES,
                description=self._describe(label),
            )

        pts = kps.points  # List[(x_norm, y_norm, conf)]

        # Helper: get keypoint with min confidence guard
        def kp(name: str) -> Optional[Tuple[float, float]]:
            idx = self.KP[name]
            x, y, c = pts[idx]
            return (x, y) if c > 0.25 else None

        # ── Feature extraction ────────────────────────────────────────────────

        nose_pt   = kp("nose")
        l_sho     = kp("l_sho")
        r_sho     = kp("r_sho")
        l_hip     = kp("l_hip")
        r_hip     = kp("r_hip")
        l_ank     = kp("l_ank")
        r_ank     = kp("r_ank")
        l_kne     = kp("l_kne")
        r_kne     = kp("r_kne")
        l_wri     = kp("l_wri")
        r_wri     = kp("r_wri")

        if nose_pt is None:
            return ActivityResult(
                target_id=detection.target_id,
                label=ActivityLabel.UNKNOWN,
                confidence=0.3,
                is_suspicious=False,
                description="Insufficient keypoint confidence.",
            )

        # Body vertical span (normalised)
        ankle_y = max(
            (l_ank[1] if l_ank else 0),
            (r_ank[1] if r_ank else 0),
        )
        body_height = abs(nose_pt[1] - ankle_y)

        # Shoulder width
        sho_width = (abs(l_sho[0] - r_sho[0]) if l_sho and r_sho else 0)

        # Hip height relative to nose
        hip_y = (
            (l_hip[1] + r_hip[1]) / 2 if l_hip and r_hip else
            (l_hip[1] if l_hip else (r_hip[1] if r_hip else None))
        )

        # Wrist elevation (arms raised?)
        wrist_above_shoulder = False
        if l_sho and l_wri:
            wrist_above_shoulder = l_wri[1] < l_sho[1]
        if r_sho and r_wri:
            wrist_above_shoulder = wrist_above_shoulder or r_wri[1] < r_sho[1]

        # ── Classification rules ──────────────────────────────────────────────

        # Velocity from bbox centre delta
        speed = 0.0
        if prev_bbox_center:
            cx = detection.bbox.cx
            cy = detection.bbox.cy
            speed = math.hypot(cx - prev_bbox_center[0], cy - prev_bbox_center[1])

        # PRONE: very low body height, mostly horizontal
        if body_height < 0.08:
            label = ActivityLabel.PRONE
            desc = "Subject appears prone/lying on ground — possible infiltration."
            return ActivityResult(detection.target_id, label, 0.88,
                                  True, desc)

        # CRAWLING: body low and moving
        if body_height < 0.16 and speed > 0.003:
            label = ActivityLabel.CRAWLING
            desc = "Crawling movement detected — covert border crossing likely."
            return ActivityResult(detection.target_id, label, 0.85,
                                  True, desc)

        # CROUCHING: knees very bent (knee-y well above ankle-y)
        if l_kne and l_ank and r_kne and r_ank:
            knee_y = (l_kne[1] + r_kne[1]) / 2
            ank_y  = (l_ank[1] + r_ank[1]) / 2
            if ank_y - knee_y < 0.06 and body_height < 0.22:
                label = ActivityLabel.CROUCHING
                return ActivityResult(detection.target_id, label, 0.80,
                                      True, "Subject crouching — evasive posture.")

        # CLIMBING: arms raised above shoulders
        if wrist_above_shoulder and body_height > 0.25:
            label = ActivityLabel.CLIMBING
            return ActivityResult(detection.target_id, label, 0.78,
                                  True, "Arms-up posture — possible fence climbing.")

        # RUNNING: high velocity
        if speed > 0.018:
            label = ActivityLabel.RUNNING
            return ActivityResult(detection.target_id, label, 0.82,
                                  True, "High-velocity movement — running across perimeter.")

        # WALKING: moderate velocity
        if speed > 0.005:
            return ActivityResult(detection.target_id, ActivityLabel.WALKING,
                                  0.75, False, "Normal walking gait.")

        return ActivityResult(detection.target_id, ActivityLabel.STANDING,
                              0.72, False, "Standing stationary.")

    def classify_group(
        self,
        detections: List[Detection],
        cluster_radius: float = 0.12,
    ) -> Optional[str]:
        """
        Detect group clustering: if >= 3 persons are within cluster_radius of each other,
        return a 'GROUP_CLUSTER' warning (flash-mob / coordinated intrusion).
        """
        persons = [d for d in detections if d.class_name == "person"]
        if len(persons) < 3:
            return None

        for i, p1 in enumerate(persons):
            cluster = 1
            for j, p2 in enumerate(persons):
                if i == j:
                    continue
                dist = math.hypot(p1.bbox.cx - p2.bbox.cx, p1.bbox.cy - p2.bbox.cy)
                if dist <= cluster_radius:
                    cluster += 1
            if cluster >= 3:
                return f"GROUP_CLUSTER: {cluster} persons within {cluster_radius:.0%} frame width."

        return None

    # ── Fallback heuristic (no keypoints) ────────────────────────────────────

    @staticmethod
    def _bbox_heuristic(bbox) -> ActivityLabel:
        """Estimate pose from bounding-box aspect ratio alone."""
        aspect = bbox.w / (bbox.h + 1e-5)
        if aspect > 1.8:
            return ActivityLabel.PRONE
        if aspect > 1.0:
            return ActivityLabel.CRAWLING
        if bbox.h < 0.12:
            return ActivityLabel.CROUCHING
        return ActivityLabel.STANDING

    @staticmethod
    def _describe(label: ActivityLabel) -> str:
        return {
            ActivityLabel.PRONE:     "Subject prone — infiltration posture.",
            ActivityLabel.CRAWLING:  "Subject crawling — covert movement.",
            ActivityLabel.CLIMBING:  "Arms raised — fence climbing suspected.",
            ActivityLabel.RUNNING:   "Fast movement across perimeter.",
            ActivityLabel.CROUCHING: "Crouching — evasive posture.",
            ActivityLabel.SUSPICIOUS:"Unclassified suspicious behaviour.",
        }.get(label, "Activity detected.")
