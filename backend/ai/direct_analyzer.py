"""
IBVAP — Direct AI Frame Analyzer
Allows synchronous AI analysis on any frame (from webcam, upload, or API ingest).
Uses YOLOv8 pose estimation, YuNet face detection, SFace face recognition,
virtual fence intrusion, loitering dwell calculation, and COCO 17-keypoint skeleton overlay.
"""

from __future__ import annotations

import base64
import datetime
import io
import logging
import time
import uuid
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image

from ..config import settings
from ..database.models import (
    AlertRecord, BoundingBox, Detection, FrameResult, KeypointSet,
)
from .activity_classifier import ActivityClassifier
from .anpr_engine import ANPREngine
from .face_detector import FaceDetector
from .face_recognizer import FaceRecognizer
from ..core.virtual_fence import VirtualFenceEngine
from .yolo_detector import HUMAN_CLASSES, VEHICLE_CLASSES, YOLODetector

log = logging.getLogger("ibvap.ai.direct_analyzer")


class DirectAIAnalyzer:
    """
    Singleton AI analyzer for processing individual frames on-demand.
    """
    _instance: Optional["DirectAIAnalyzer"] = None

    def __init__(self) -> None:
        log.info("Initializing DirectAIAnalyzer with YOLOv8-pose, YuNet & SFace...")
        self.yolo = YOLODetector()
        self.face_det = FaceDetector()
        self.face_rec = FaceRecognizer()
        self.activity = ActivityClassifier()
        self.anpr = ANPREngine()
        self._prev_positions: Dict[str, Tuple[float, float]] = {}
        self._dwell_tracker: Dict[str, float] = {}   # target_id -> first_seen_ts
        self._last_alert_ts: Dict[str, float] = {}

    @classmethod
    def get_instance(cls) -> "DirectAIAnalyzer":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def process_frame(
        self,
        frame_bgr: np.ndarray,
        camera_id: str = "cam-01",
        camera_code: str = "CAM-01",
        fence_points: Optional[List[dict]] = None,
        analytics_modes: Optional[List[str]] = None,
        annotate: bool = False,
    ) -> FrameResult:
        """
        Process a single BGR frame with the full IBVAP AI pipeline.
        """
        h, w = frame_bgr.shape[:2]
        now = datetime.datetime.utcnow()
        now_ts = time.time()
        analytics_modes = analytics_modes or ["INTRUSION", "LOITERING", "FRS", "ANPR", "ACTIVITY"]

        # 1. YOLOv8 Pose & Human/Vehicle Detection
        detections: List[Detection] = self.yolo.detect(frame_bgr)
        alerts: List[AlertRecord] = []

        # 2. Virtual Fence setup
        fence_checker = None
        if fence_points and len(fence_points) >= 3:
            fence_checker = VirtualFenceEngine(camera_id, fence_points)

        fence_targets = []
        for det in detections:
            # Track dwell time
            if det.target_id not in self._dwell_tracker:
                self._dwell_tracker[det.target_id] = now_ts
            dwell_sec = now_ts - self._dwell_tracker[det.target_id]
            det.loiter_seconds = dwell_sec

            fence_targets.append({
                "id": det.target_id,
                "cx": det.bbox.cx,
                "cy": det.bbox.cy,
                "dwell_seconds": dwell_sec,
            })

        # Check fence breaches if configured
        breach_by_id = {}
        if fence_checker and fence_targets:
            fence_res = fence_checker.check_targets(fence_targets)
            breach_by_id = {r.target_id: r for r in fence_res}

        # 3. Analyze each detected target
        for det in detections:
            br = breach_by_id.get(det.target_id)
            is_in_fence = (br is not None and getattr(br, "is_breaching", False)) or (
                fence_checker is not None and fence_checker._zone_state.is_inside(det.target_id)
            )
            det.is_in_fence = is_in_fence

            # Fence breach alert
            if is_in_fence:
                alert = self._make_alert(
                    camera_id=camera_id,
                    category="VIRTUAL_FENCE_INTRUSION",
                    severity="CRITICAL",
                    title=f"Perimeter Intrusion [{camera_code}]",
                    description=f"Target {det.target_id} ({det.class_name}) entered restricted virtual perimeter zone.",
                    target_id=det.target_id,
                )
                if alert:
                    alerts.append(alert)

            # Loitering alert (> 10s)
            if det.loiter_seconds > 10.0:
                alert = self._make_alert(
                    camera_id=camera_id,
                    category="LOITERING",
                    severity="HIGH",
                    title=f"Loitering Alert [{camera_code}]",
                    description=f"Target {det.target_id} stationary in surveillance field for {det.loiter_seconds:.0f}s.",
                    target_id=det.target_id,
                )
                if alert:
                    alerts.append(alert)

            # Unusual Item / Contraband alert (bottle, knife, pen, phone, bag, scissors)
            # ── Weapon & Hand-Held Threat Alerts ──────────────────────────────
            if getattr(det, "is_holding", False):
                if getattr(det, "held_item_type", "") == "WEAPON":
                    alert = self._make_alert(
                        camera_id=camera_id,
                        category="ARMED_PERSON",
                        severity="CRITICAL",
                        title=f"CRITICAL: Armed Subject Holding {det.held_item} [{camera_code}]",
                        description=f"Subject {det.target_id} confirmed wielding {det.held_item} in {det.held_by_hand or 'hand'}. Immediate DEFCON 1 response required.",
                        target_id=det.target_id,
                    )
                    if alert:
                        alerts.append(alert)
                elif getattr(det, "held_item_type", "") == "CASUAL_OBJECT":
                    is_prio = det.is_in_fence or det.loiter_seconds > 6 or "PHONE" in (det.held_item or "")
                    alert = self._make_alert(
                        camera_id=camera_id,
                        category="MONITORED_OBJECT" if "PHONE" in (det.held_item or "") else "SUSPICIOUS_CARRIER",
                        severity="HIGH" if is_prio else "MEDIUM",
                        title=f"Subject Holding {det.held_item} [{camera_code}]",
                        description=f"Subject {det.target_id} carrying {det.held_item} ({det.held_by_hand or 'in hand'}).",
                        target_id=det.target_id,
                    )
                    if alert:
                        alerts.append(alert)

            # Unattended weapon alert
            if getattr(det, "is_weapon", False) and not getattr(det, "is_held", False):
                w_name = (det.unusual_item or det.class_name).upper()
                alert = self._make_alert(
                    camera_id=camera_id,
                    category="UNATTENDED_WEAPON",
                    severity="HIGH",
                    title=f"Unattended Weapon: {w_name} [{camera_code}]",
                    description=f"Unattended weapon '{w_name}' detected without handler in live field (Confidence: {det.bbox.confidence:.1%}).",
                    target_id=det.target_id,
                )
                if alert:
                    alerts.append(alert)

            # Unattended baggage alert (backpack, suitcase, handbag)
            if det.class_name in ("backpack", "suitcase", "handbag") and not getattr(det, "is_held", False):
                b_name = det.class_name.upper()
                alert = self._make_alert(
                    camera_id=camera_id,
                    category="UNATTENDED_BAGGAGE",
                    severity="HIGH",
                    title=f"Unattended Baggage: {b_name} [{camera_code}]",
                    description=f"Unattended luggage/baggage '{b_name}' left stationary in perimeter sector.",
                    target_id=det.target_id,
                )
                if alert:
                    alerts.append(alert)

            # General unusual / monitored item alert (phone, bottle, laptop, contraband)
            if (det.is_unusual or det.unusual_item) and not getattr(det, "is_weapon", False) and not getattr(det, "is_held", False):
                item_name = (det.unusual_item or det.class_name).upper()
                is_phone_item = "PHONE" in item_name or "CELL" in item_name
                alert = self._make_alert(
                    camera_id=camera_id,
                    category="MONITORED_OBJECT" if is_phone_item else "UNUSUAL_ITEM",
                    severity="CRITICAL" if item_name in ("KNIFE", "SCISSORS", "WEAPON") else "HIGH" if is_phone_item else "MEDIUM",
                    title=f"Detected: {item_name} [{camera_code}]",
                    description=f"Monitored object '{item_name}' detected in live camera field (Confidence: {det.bbox.confidence:.1%}).",
                    target_id=det.target_id,
                )
                if alert:
                    alerts.append(alert)

            # Suspicious Posture / Hand Raised Alert (Crouching / Hands Raised / Hand Raised / Prone)
            if det.pose_label in ("CROUCHING", "HANDS_RAISED", "HAND_RAISED", "PRONE"):
                alert = self._make_alert(
                    camera_id=camera_id,
                    category="SUSPICIOUS_POSTURE",
                    severity="HIGH",
                    title=f"Gesture / Posture: {det.pose_label.replace('_', ' ')} [{camera_code}]",
                    description=f"Subject {det.target_id} exhibiting raised hand / posture '{det.pose_label}'.",
                    target_id=det.target_id,
                )
                if alert:
                    alerts.append(alert)

            # Human Face & Activity Analysis
            if det.class_id in HUMAN_CLASSES:
                x1, y1, x2, y2 = det.bbox.to_pixel(w, h)
                crop = frame_bgr[y1:y2, x1:x2]
                if crop.size > 0 and "FRS" in analytics_modes:
                    faces = self.face_det.detect_in_crop(frame_bgr, (x1, y1, x2, y2))
                    for face in faces:
                        if face.face_crop is not None:
                            emb = self.face_rec.embed(face.face_crop)
                            if emb is not None:
                                match = self.face_rec.match_against_watchlist(emb)
                                if match:
                                    det.frs_match_name = match.name
                                    det.frs_match_score = match.score
                                    det.frs_watchlist_id = match.subject_id
                                    alert = self._make_alert(
                                        camera_id=camera_id,
                                        category="FRS_MATCH",
                                        severity=("CRITICAL" if match.threat_level == "CRITICAL" else "HIGH"),
                                        title=f"FRS Match: {match.name} [{camera_code}]",
                                        description=f"Subject '{match.name}' identified ({match.score:.1%} match).",
                                        target_id=det.target_id,
                                        frs_match_name=match.name,
                                        frs_match_score=match.score,
                                    )
                                    if alert:
                                        alerts.append(alert)

                # Activity & Pose classification
                prev_pos = self._prev_positions.get(det.target_id)
                activity = self.activity.classify(det, prev_bbox_center=prev_pos)
                if not det.pose_label or det.pose_label == "STANDING":
                    det.pose_label = activity.label.value
                self._prev_positions[det.target_id] = (det.bbox.cx, det.bbox.cy)

        # 4. Annotate frame with HUD, Skeletons, and Bounding Boxes (if requested)
        annotated_jpg = (
            self._annotate_frame(frame_bgr.copy(), detections, alerts, camera_code, fence_points)
            if annotate
            else None
        )

        return FrameResult(
            camera_id=camera_id,
            frame_number=int(now_ts * 1000) % 1000000,
            timestamp=now,
            detections=detections,
            fence_breaches=[],
            alerts=alerts,
            annotated_frame_jpg=annotated_jpg,
        )

    def _make_alert(
        self,
        camera_id: str,
        category: str,
        severity: str,
        title: str,
        description: str,
        target_id: Optional[str] = None,
        frs_match_name: Optional[str] = None,
        frs_match_score: Optional[float] = None,
    ) -> Optional[AlertRecord]:
        key = f"{camera_id}:{category}:{target_id or 'all'}"
        now_ts = time.time()
        if now_ts - self._last_alert_ts.get(key, 0) < 4.0:  # 4s throttle
            return None
        self._last_alert_ts[key] = now_ts

        return AlertRecord(
            id=f"ALT-{uuid.uuid4().hex[:10].upper()}",
            camera_id=camera_id,
            timestamp=datetime.datetime.utcnow(),
            category=category,
            severity=severity,
            title=title,
            description=description,
            target_id=target_id,
            status="NEW",
            frs_match_name=frs_match_name,
            frs_match_score=frs_match_score,
        )

    def _annotate_frame(
        self,
        frame: np.ndarray,
        detections: List[Detection],
        alerts: List[AlertRecord],
        camera_code: str,
        fence_points: Optional[List[dict]],
    ) -> bytes:
        h, w = frame.shape[:2]

        # Draw Virtual Fence
        if fence_points and len(fence_points) >= 3:
            pts = np.array([[int(p["x"] * w), int(p["y"] * h)] for p in fence_points], dtype=np.int32)
            cv2.polylines(frame, [pts], isClosed=True, color=(0, 0, 255), thickness=2)
            cv2.putText(frame, "RESTRICTED FENCE ZONE", (pts[0][0], max(pts[0][1] - 8, 15)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1, cv2.LINE_AA)

        # COCO 17-Keypoint skeleton limbs
        skeleton_limbs = [
            (0, 1), (0, 2), (1, 3), (2, 4),           # Head
            (5, 6), (5, 7), (7, 9), (6, 8), (8, 10),  # Upper body / Arms
            (5, 11), (6, 12), (11, 12),               # Torso
            (11, 13), (13, 15), (12, 14), (14, 16),   # Lower body / Legs
        ]

        # Draw Detections
        # 1. Draw Tether Lines between persons and held items
        for det in detections:
            if getattr(det, "is_holding", False) and getattr(det, "held_item", None):
                # Locate the corresponding held item
                for obj in detections:
                    if getattr(obj, "held_by_target_id", None) == det.target_id and obj.bbox:
                        px1, py1, px2, py2 = det.bbox.to_pixel(w, h)
                        ox1, oy1, ox2, oy2 = obj.bbox.to_pixel(w, h)
                        obj_center = ((ox1 + ox2) // 2, (oy1 + oy2) // 2)

                        # Find wrist if available
                        wrist_pt = None
                        if det.keypoints and det.keypoints.points:
                            pts = det.keypoints.points
                            l_wrist = pts[9] if len(pts) > 9 else (0, 0, 0)
                            r_wrist = pts[10] if len(pts) > 10 else (0, 0, 0)
                            if det.held_by_hand == "LEFT_HAND" and l_wrist[2] > 0.2:
                                wrist_pt = (int(l_wrist[0] * w), int(l_wrist[1] * h))
                            elif det.held_by_hand == "RIGHT_HAND" and r_wrist[2] > 0.2:
                                wrist_pt = (int(r_wrist[0] * w), int(r_wrist[1] * h))
                            elif l_wrist[2] > 0.2 or r_wrist[2] > 0.2:
                                chosen = l_wrist if l_wrist[2] > r_wrist[2] else r_wrist
                                wrist_pt = (int(chosen[0] * w), int(chosen[1] * h))

                        start_pt = wrist_pt if wrist_pt else ((px1 + px2) // 2, (py1 + py2) // 2)
                        tether_color = (0, 0, 255) if det.held_item_type == "WEAPON" else (0, 242, 254)
                        cv2.line(frame, start_pt, obj_center, tether_color, 2, cv2.LINE_AA)
                        cv2.circle(frame, obj_center, 4, tether_color, -1, cv2.LINE_AA)

        # 2. Draw Detections & Skeletons
        for det in detections:
            x1, y1, x2, y2 = det.bbox.to_pixel(w, h)
            is_armed = getattr(det, "is_holding", False) and getattr(det, "held_item_type", "") == "WEAPON"
            is_weapon = getattr(det, "is_weapon", False)
            is_holding_casual = getattr(det, "is_holding", False) and getattr(det, "held_item_type", "") == "CASUAL_OBJECT"
            is_unattended_bag = det.class_name in ("backpack", "suitcase", "handbag") and not getattr(det, "is_held", False)
            is_unusual = det.is_unusual or det.is_in_fence or is_weapon or is_armed
            is_hand_raised = det.pose_label in ("HANDS_RAISED", "HAND_RAISED")
            is_critical = is_armed or is_weapon or det.pose_label in ("CROUCHING", "PRONE")

            # Color scheme
            if is_armed or is_weapon:
                colour = (0, 0, 255)        # Tactical Red
            elif is_unattended_bag:
                colour = (0, 140, 255)      # Warning Amber / Orange
            elif is_holding_casual:
                colour = (11, 158, 245)     # Cyan-Gold
            elif is_hand_raised:
                colour = (11, 158, 245)     # Amber
            elif det.class_id == 0:
                colour = (0, 242, 254)      # Cyber Blue / Cyan
            else:
                colour = (0, 215, 255)      # Yellow

            # Draw Main Box
            thickness = 3 if is_critical else 2
            cv2.rectangle(frame, (x1, y1), (x2, y2), colour, thickness)

            # Corner Reticle Accents
            corner_len = min(20, max(6, (x2 - x1) // 4))
            cv2.line(frame, (x1, y1), (x1 + corner_len, y1), colour, thickness + 1)
            cv2.line(frame, (x1, y1), (x1, y1 + corner_len), colour, thickness + 1)
            cv2.line(frame, (x2, y1), (x2 - corner_len, y1), colour, thickness + 1)
            cv2.line(frame, (x2, y1), (x2, y1 + corner_len), colour, thickness + 1)
            cv2.line(frame, (x1, y2), (x1 + corner_len, y2), colour, thickness + 1)
            cv2.line(frame, (x1, y2), (x1, y2 - corner_len), colour, thickness + 1)
            cv2.line(frame, (x2, y2), (x2 - corner_len, y2), colour, thickness + 1)
            cv2.line(frame, (x2, y2), (x2, y2 - corner_len), colour, thickness + 1)

            # Skeleton for Persons
            if det.keypoints and det.keypoints.points:
                kps = det.keypoints.points
                for p1_idx, p2_idx in skeleton_limbs:
                    if p1_idx < len(kps) and p2_idx < len(kps):
                        kx1, ky1, c1 = kps[p1_idx]
                        kx2, ky2, c2 = kps[p2_idx]
                        if c1 > 0.35 and c2 > 0.35:
                            pt1 = (int(kx1 * w), int(ky1 * h))
                            pt2 = (int(kx2 * w), int(ky2 * h))
                            bone_colour = (0, 0, 255) if is_critical else (0, 255, 128)
                            cv2.line(frame, pt1, pt2, bone_colour, 2, cv2.LINE_AA)

                for kx, ky, kc in kps:
                    if kc > 0.35:
                        joint_colour = (0, 0, 255) if is_critical else (0, 255, 255)
                        cv2.circle(frame, (int(kx * w), int(ky * h)), 4, joint_colour, -1, cv2.LINE_AA)

            # Label Construction
            label_parts = []
            if is_armed:
                label_parts.append(f"🚨 ARMED: HOLDING {det.held_item} ({det.held_by_hand or 'HAND'})")
            elif is_holding_casual:
                label_parts.append(f"📦 HOLDING: {det.held_item} ({det.held_by_hand or 'HAND'})")
            elif is_weapon:
                label_parts.append(f"🚨 WEAPON: {det.class_name.upper()}")
            elif is_unattended_bag:
                label_parts.append(f"⚠️ UNATTENDED BAGGAGE: {det.class_name.upper()}")
            elif det.is_unusual:
                label_parts.append(f"⚠️ UNUSUAL: {(det.unusual_item or det.class_name).upper()}")
            else:
                label_parts.append(f"{det.target_id} {det.class_name.upper()}")

            if det.pose_label and det.class_id == 0 and not is_armed and not is_holding_casual:
                label_parts.append(f"[{det.pose_label}]")
            if det.frs_match_name:
                label_parts.append(f"FRS:{det.frs_match_name} ({det.frs_match_score:.0%})")
            if det.loiter_seconds > 3:
                label_parts.append(f"DWELL:{det.loiter_seconds:.0f}s")

            label = " | ".join(label_parts)
            (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            tag_y = max(y1 - lh - 8, 0)
            cv2.rectangle(frame, (x1, tag_y), (x1 + lw + 8, tag_y + lh + 8), (15, 20, 30), -1)
            cv2.rectangle(frame, (x1, tag_y), (x1 + lw + 8, tag_y + lh + 8), colour, 1)
            cv2.putText(frame, label, (x1 + 4, tag_y + lh + 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.42, colour, 1, cv2.LINE_AA)

        # Tactical HUD
        alert_cnt = len(alerts)
        people_cnt = sum(1 for d in detections if d.class_id == 0)
        armed_cnt = sum(1 for d in detections if getattr(d, "is_holding", False) and getattr(d, "held_item_type", "") == "WEAPON")
        weapons_cnt = sum(1 for d in detections if getattr(d, "is_weapon", False))
        casual_cnt = sum(1 for d in detections if getattr(d, "is_casual_object", False))

        hud = f"{camera_code} AI | PPL:{people_cnt} | ARMED:{armed_cnt} | WEAPONS:{weapons_cnt} | ITEMS:{casual_cnt} | ALERTS:{alert_cnt}"
        hud_color = (0, 0, 255) if (armed_cnt > 0 or weapons_cnt > 0 or alert_cnt > 0) else (0, 242, 254)
        cv2.putText(frame, hud, (20, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.52, hud_color, 2 if (armed_cnt > 0 or weapons_cnt > 0) else 1, cv2.LINE_AA)

        encode_params = [cv2.IMWRITE_JPEG_QUALITY, 85]
        _, buf = cv2.imencode(".jpg", frame, encode_params)
        return buf.tobytes()
