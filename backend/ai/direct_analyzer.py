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
        self._anpr_watchlist: List[str] = [
            "JK-02-AX-8912", "PB-10-CZ-4401", "HR-26-BQ-7719",
            "DL-01-ET-3022", "MH-12-AB-1234", "UP-32-CD-5678",
        ]
        self._vehicle_plate_cache: Dict[str, str] = {}
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
        gps_info: Optional[str] = None,
    ) -> FrameResult:
        """
        Process a single BGR frame with the full IBVAP AI pipeline.
        """
        h, w = frame_bgr.shape[:2]
        now = datetime.datetime.utcnow()
        now_ts = time.time()
        analytics_modes = analytics_modes or ["INTRUSION", "LOITERING", "FRS", "ANPR", "ACTIVITY"]

        # 0. Preprocessing Pipeline (CLAHE / Fast Dehaze for night & fog feeds)
        from .image_preprocessor import preprocessor
        frame_enhanced = preprocessor.process(frame_bgr, mode="AUTO")

        # 1. YOLOv8 Pose & Human/Vehicle Detection
        detections: List[Detection] = self.yolo.detect(frame_enhanced)

        # 1b. Close-up Face Detection Fallback (e.g. webcam selfie / operator desk)
        # When YOLOv8 pose doesn't find a full-body person, detect faces with YuNet
        has_human = any(d.class_id in HUMAN_CLASSES for d in detections)
        if not has_human and hasattr(self, "face_det") and self.face_det:
            try:
                faces = self.face_det.detect(frame_bgr)
                for f_idx, face in enumerate(faces):
                    fx, fy, fw, fh = face.bbox
                    pad_x = int(fw * 0.35)
                    pad_y_top = int(fh * 0.25)
                    pad_y_bot = int(fh * 1.2)
                    bx = max(0, fx - pad_x)
                    by = max(0, fy - pad_y_top)
                    bw = min(w - bx, fw + 2 * pad_x)
                    bh = min(h - by, fh + pad_y_top + pad_y_bot)

                    norm_bbox = BoundingBox(
                        x=float(bx / w),
                        y=float(by / h),
                        w=float(bw / w),
                        h=float(bh / h),
                        confidence=float(face.confidence),
                    )

                    frs_name = None
                    frs_score = None
                    if face.face_crop is not None and hasattr(self, "face_rec") and self.face_rec:
                        emb = self.face_rec.embed(face.face_crop)
                        if emb is not None:
                            match = self.face_rec.match_against_watchlist(emb)
                            if match:
                                frs_name = match.name
                                frs_score = match.score

                    face_det = Detection(
                        target_id=f"OPERATOR-{f_idx + 1:02d}",
                        class_id=0,
                        class_name="person",
                        bbox=norm_bbox,
                        pose_label="ACTIVE",
                        frs_match_name=frs_name,
                        frs_match_score=frs_score,
                        threat_level="CLEAR",
                    )
                    detections.append(face_det)
            except Exception as f_err:
                log.debug("Face detection fallback skipped: %s", f_err)

        alerts: List[AlertRecord] = []

        # 1c. Cyber Anti-Tamper & Stream Integrity Check (Spray, Blinding, Blur, Replay)
        try:
            from ..core.tamper_detector import tamper_manager
            tamper_detector = tamper_manager.get_detector(camera_id)
            telemetry = tamper_detector.analyze_frame(frame_bgr)
            tamper_manager.record_telemetry(telemetry)

            if telemetry.is_tampered:
                last_tamper_alert = self._last_alert_ts.get(f"{camera_id}_tamper", 0)
                if now_ts - last_tamper_alert > 15.0:
                    self._last_alert_ts[f"{camera_id}_tamper"] = now_ts
                    alerts.append(
                        AlertRecord(
                            id=f"CYBER-{uuid.uuid4().hex[:8].upper()}",
                            camera_id=camera_id,
                            timestamp=now,
                            category="CYBER_TAMPER",
                            severity=telemetry.severity,
                            title=f"CYBER DEFENSE: {telemetry.tamper_type} [{camera_code}]",
                            description=telemetry.details,
                            target_id="CYBER_TAMPER",
                            status="NEW",
                        )
                    )
        except Exception as t_err:
            log.debug("Tamper detector check skipped: %s", t_err)

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

            # Weapon & Hand-Held Threat Alerts
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
                if crop.size > 0 and "FRS" in analytics_modes and len(self.face_rec._watchlist) > 0 and (x2 - x1) > 50 and (y2 - y1) > 70:
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

            # Vehicle & ANPR License Plate Recognition
            if det.class_id in VEHICLE_CLASSES:
                x1, y1, x2, y2 = det.bbox.to_pixel(w, h)
                crop = frame_bgr[y1:y2, x1:x2]
                if crop.size > 0 and hasattr(self, "anpr") and self.anpr:
                    try:
                        plates = self.anpr.detect_in_vehicle_crop(frame_bgr, (x1, y1, x2, y2))
                        for plate in plates:
                            det.plate_text = plate.plate_text
                            det.plate_confidence = plate.confidence
                            matched_plate, dist = self.anpr.fuzzy_check_watchlist(
                                plate.plate_text, self._anpr_watchlist
                            )
                            if matched_plate:
                                det.is_blacklisted = True
                                alert = self._make_alert(
                                    camera_id=camera_id,
                                    category="ANPR_MATCH",
                                    severity="CRITICAL",
                                    title=f"Blacklisted Vehicle [{camera_code}]: {plate.plate_text}",
                                    description=f"Plate '{plate.plate_text}' matched watchlist entry '{matched_plate}' (OCR conf: {plate.confidence:.1%}, dist: {dist}).",
                                    target_id=det.target_id,
                                    plate_text=plate.plate_text,
                                )
                                if alert:
                                    alerts.append(alert)
                            elif det.is_in_fence:
                                alert = self._make_alert(
                                    camera_id=camera_id,
                                    category="VEHICLE_INTRUSION",
                                    severity="CRITICAL",
                                    title=f"Vehicle Perimeter Breach [{camera_code}]: {plate.plate_text}",
                                    description=f"Vehicle {det.target_id} with plate '{plate.plate_text}' entered restricted perimeter boundary.",
                                    target_id=det.target_id,
                                    plate_text=plate.plate_text,
                                )
                                if alert:
                                    alerts.append(alert)
                    except Exception as anpr_err:
                        log.debug("ANPR detection failed: %s", anpr_err)

        # 4. Annotate frame with HUD, Skeletons, and Bounding Boxes (if requested)
        annotated_jpg = (
            self._annotate_frame(frame_bgr.copy(), detections, alerts, camera_code, fence_points, gps_info)
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
        plate_text: Optional[str] = None,
    ) -> Optional[AlertRecord]:
        key = f"{camera_id}:{category}:{target_id or plate_text or 'all'}"
        now_ts = time.time()
        throttle_secs = 15.0 if category in ("LOITERING", "SUSPICIOUS_POSTURE", "MONITORED_OBJECT", "UNUSUAL_ITEM") else 6.0
        if now_ts - self._last_alert_ts.get(key, 0) < throttle_secs:
            return None
        self._last_alert_ts[key] = now_ts

        alert_id = f"ALT-{uuid.uuid4().hex[:10].upper()}"
        return AlertRecord(
            id=alert_id,
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
            plate_text=plate_text,
            snapshot_url=f"/api/v1/snapshots/{alert_id}",
        )

    def _annotate_frame(
        self,
        frame: np.ndarray,
        detections: List[Detection],
        alerts: List[AlertRecord],
        camera_code: str,
        fence_points: Optional[List[dict]],
        gps_info: Optional[str] = None,
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

            # Label Construction matching Screenshot 2
            label_parts = []
            if is_armed:
                label_parts.append(f"🚨 ARMED: {det.held_item}")
            elif is_holding_casual:
                if "WATCH" in (det.held_item or "").upper():
                    label_parts.append(f"⌚ HOLDING: {det.held_item}")
                elif "PHONE" in (det.held_item or "").upper():
                    label_parts.append(f"📱 HOLDING: {det.held_item}")
                elif "UNKNOWN" in (det.held_item or "").upper():
                    label_parts.append(f"🔍 HOLDING: {det.held_item}")
                else:
                    label_parts.append(f"📦 HOLDING: {det.held_item}")
            elif is_weapon:
                conf_val = det.bbox.confidence if det.bbox else 0.0
                label_parts.append(f"🚨 WEAPON: {det.class_name.upper()} [{conf_val:.0%}]")
            elif is_unattended_bag:
                label_parts.append(f"⚠️ UNATTENDED: {det.class_name.upper()}")
            elif "WATCH" in (det.unusual_item or det.class_name).upper():
                conf_val = det.bbox.confidence if det.bbox else 0.0
                label_parts.append(f"⌚ WRISTWATCH [{conf_val:.0%}]")
            elif "UNKNOWN" in (det.unusual_item or det.class_name).upper():
                conf_val = det.bbox.confidence if det.bbox else 0.0
                label_parts.append(f"🔍 UNKNOWN OBJECT [{conf_val:.0%}]")
            elif det.is_unusual:
                label_parts.append(f"⚠️ UNUSUAL: {(det.unusual_item or det.class_name).upper()}")
            else:
                label_parts.append(f"{det.target_id} {det.class_name.upper()}")

            if det.pose_label and det.class_id == 0:
                label_parts.append(f"[{det.pose_label}]")
            if det.frs_match_name:
                label_parts.append(f"FRS:{det.frs_match_name}")
            if getattr(det, "plate_text", None):
                label_parts.append(f"PLATE:{det.plate_text}")
            if det.loiter_seconds > 3:
                label_parts.append(f"DWELL:{det.loiter_seconds:.0f}s")

            label = " | ".join(label_parts)
            (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            tag_y = max(y1 - lh - 8, 0)
            # Black filled background tag box with red/yellow outline
            cv2.rectangle(frame, (x1, tag_y), (x1 + lw + 10, tag_y + lh + 8), (0, 0, 0), -1)
            cv2.rectangle(frame, (x1, tag_y), (x1 + lw + 10, tag_y + lh + 8), colour, 1)
            cv2.putText(frame, label, (x1 + 5, tag_y + lh + 3),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.42, colour, 1, cv2.LINE_AA)

        # Tactical HUD matching Screenshot 2
        people_cnt = sum(1 for d in detections if d.class_id == 0)
        vehicle_cnt = sum(1 for d in detections if d.class_id in VEHICLE_CLASSES)
        unusual_cnt = sum(1 for d in detections if d.is_unusual or getattr(d, "is_weapon", False) or getattr(d, "is_holding", False))
        alert_cnt = len(alerts)

        vehicle_part = f" | VEHICLES: {vehicle_cnt}" if vehicle_cnt > 0 else ""
        hud = f"{camera_code} AI | PEOPLE: {people_cnt}{vehicle_part} | UNUSUAL ITEMS: {unusual_cnt} | ALERTS: {alert_cnt}"
        cv2.putText(frame, hud, (20, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.60, (0, 0, 240), 2, cv2.LINE_AA)

        # Bottom Geo-Location & GPS Telemetry HUD on Captured Image
        if gps_info:
            parts = [p.strip() for p in gps_info.split("|") if p.strip()]
            loc_part = parts[0] if parts else gps_info
            gps_part = parts[1] if len(parts) > 1 else ""

            # Ensure clean "LOC: " prefix
            if not loc_part.upper().startswith("LOC:"):
                loc_line = f"LOC: {loc_part.upper()}"
            else:
                loc_line = loc_part.upper()

            time_str = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
            sub_line = f"{gps_part} | {time_str} | IBVAP AI" if gps_part else f"{time_str} | IBVAP AI"

            banner_w = min(w - 24, max(420, int(w * 0.65)))
            banner_h = 42
            banner_y = h - banner_h - 10

            # Solid tactical black background with cyan border
            cv2.rectangle(frame, (12, banner_y), (12 + banner_w, banner_y + banner_h), (8, 14, 24), -1)
            cv2.rectangle(frame, (12, banner_y), (12 + banner_w, banner_y + banner_h), (255, 240, 0), 1)

            # Location Line (in cyan/yellow)
            cv2.putText(frame, loc_line, (20, banner_y + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.44, (255, 240, 0), 1, cv2.LINE_AA)
            # GPS + Timestamp Line (in emerald green)
            cv2.putText(frame, sub_line, (20, banner_y + 35), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 230, 0), 1, cv2.LINE_AA)

        encode_params = [cv2.IMWRITE_JPEG_QUALITY, 85]
        _, buf = cv2.imencode(".jpg", frame, encode_params)
        return buf.tobytes()
