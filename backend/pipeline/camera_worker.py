"""
IBVAP — CameraWorker: Per-Camera RTSP Ingestion + Full AI Analysis Pipeline
Runs as an isolated process (via multiprocessing) to bypass Python GIL.

Architecture per worker:
  Thread-1 (Reader):    OpenCV → RTSP → frame_queue (ring buffer, maxsize=4)
  Thread-2 (Inference): frame_queue → YOLO → FRS → ANPR → Fence → result_queue
"""

from __future__ import annotations

import datetime
import io
import logging
import multiprocessing as mp
import queue
import threading
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

from ..ai.activity_classifier import ActivityClassifier, SUSPICIOUS_ACTIVITIES
from ..ai.anpr_engine import ANPREngine
from ..ai.face_detector import FaceDetector
from ..ai.face_recognizer import FaceRecognizer
from ..ai.loitering_tracker import LoiteringTracker
from ..ai.night_enhancer import NightEnhancer
from ..ai.yolo_detector import YOLODetector, HUMAN_CLASSES, VEHICLE_CLASSES
from ..config import settings
from ..core.virtual_fence import VirtualFenceEngine
from ..database.models import (
    AlertRecord, CameraConfig, Detection, FrameResult, SnapshotRecord,
)

log = logging.getLogger("ibvap.pipeline.camera_worker")


# ── Frame-level result container ──────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.datetime.utcnow().isoformat()


class CameraWorker:
    """
    Manages the full AI pipeline for one camera.
    Runs inside a dedicated process spawned by PipelineManager.
    """

    def __init__(
        self,
        camera: CameraConfig,
        result_queue: "mp.Queue[FrameResult]",
        stop_event: "mp.Event",
        watchlist_frs: List[Dict],
        watchlist_anpr: List[str],      # flat list of plate strings
        alert_throttle: float = settings.ALERT_THROTTLE_SECONDS,
    ) -> None:
        self.camera = camera
        self.result_queue: "mp.Queue[FrameResult]" = result_queue
        self.stop_event: "mp.Event" = stop_event
        self.alert_throttle = alert_throttle

        # Initialise AI modules (done INSIDE the worker process, not in main)
        self._yolo       = YOLODetector()
        self._face_det   = FaceDetector()
        self._face_rec   = FaceRecognizer()
        self._anpr       = ANPREngine()
        self._loitering  = LoiteringTracker(camera.id)
        self._enhancer   = NightEnhancer()
        self._activity   = ActivityClassifier()
        self._fence      = VirtualFenceEngine(camera.id, camera.fence_points)

        # Load watchlists
        self._face_rec.load_watchlist(watchlist_frs)
        self._anpr_watchlist: List[str] = watchlist_anpr

        # Internal queues
        self._frame_q: "queue.Queue[Optional[np.ndarray]]" = queue.Queue(
            maxsize=settings.FRAME_QUEUE_MAX_SIZE
        )

        # Alert throttle state: last fired time per category
        self._last_alert: Dict[str, float] = {}

        # Target position history for velocity calculation
        self._prev_positions: Dict[str, tuple] = {}

        self._frame_number = 0

    # ── Main run loop (entry point from multiprocessing) ──────────────────────

    def run(self) -> None:
        """
        Start reader thread and inference loop.
        Blocks until stop_event is set.
        """
        log.info("[%s] CameraWorker starting. RTSP: %s", self.camera.code, self.camera.rtsp_url)

        reader_thread = threading.Thread(
            target=self._reader_loop, name=f"reader-{self.camera.id}", daemon=True
        )
        reader_thread.start()

        self._inference_loop()

        reader_thread.join(timeout=5)
        log.info("[%s] CameraWorker stopped.", self.camera.code)

    # ── Thread-1: RTSP Frame Reader ───────────────────────────────────────────

    def _reader_loop(self) -> None:
        """
        Continuously read frames from RTSP, webcam (device 0 / webcam:0), or synthetic generator,
        and push to frame_queue.
        Drops the oldest frame if queue is full (ring-buffer behaviour).
        """
        import cv2   # type: ignore

        reconnect_attempts = 0
        cap = None
        url = str(self.camera.rtsp_url or "")
        is_webcam = url in ("0", "1", "2") or url.startswith("webcam") or url.startswith("camera:")
        is_synthetic = (not is_webcam) and (url.startswith("synthetic") or url in ("test", "demo", ""))

        synthetic_tick = 0
        target_fps = max(5, min(self.camera.fps or 25, 30))
        frame_interval = 1.0 / target_fps

        while not self.stop_event.is_set():
            t_start = time.monotonic()

            if is_synthetic:
                frame = self._generate_synthetic_frame(synthetic_tick)
                synthetic_tick += 1
            else:
                if cap is None or not cap.isOpened():
                    log.info("[%s] Connecting to stream: %s", self.camera.code, url)
                    if is_webcam:
                        dev_id = int(url.split(":")[-1]) if ":" in url else (int(url) if url.isdigit() else 0)
                        cap = cv2.VideoCapture(dev_id)
                        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
                        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
                    else:
                        dev_id = int(url) if url.isdigit() else url
                        cap = cv2.VideoCapture(dev_id, cv2.CAP_FFMPEG if isinstance(dev_id, str) else cv2.CAP_ANY)

                    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)    # prevent stale frame accumulation
                    cap.set(cv2.CAP_PROP_FPS, target_fps)

                    if not cap.isOpened():
                        reconnect_attempts += 1
                        if reconnect_attempts > self.camera.rtsp_reconnect_attempts:
                            log.warning("[%s] Max reconnect attempts reached — switching to synthetic demo stream.",
                                        self.camera.code)
                            is_synthetic = True
                            continue
                        log.warning("[%s] Stream open failed. Retry %d/%d in 3s …",
                                    self.camera.code, reconnect_attempts,
                                    self.camera.rtsp_reconnect_attempts)
                        time.sleep(3)
                        continue

                    reconnect_attempts = 0
                    log.info("[%s] Stream connected successfully.", self.camera.code)

                ret, frame = cap.read()
                if not ret or frame is None:
                    log.warning("[%s] Frame read failure — reconnecting …", self.camera.code)
                    cap.release()
                    cap = None
                    time.sleep(1)
                    continue

            # Frame drop: if queue is full, discard oldest to keep real-time
            if self._frame_q.full():
                try:
                    self._frame_q.get_nowait()
                except queue.Empty:
                    pass

            self._frame_q.put_nowait(frame)

            # Pace generator / stream reading to match camera FPS
            elapsed = time.monotonic() - t_start
            sleep_time = frame_interval - elapsed
            if sleep_time > 0:
                time.sleep(sleep_time)

        if cap and cap.isOpened():
            cap.release()

    def _generate_synthetic_frame(self, tick: int) -> np.ndarray:
        """
        Generates realistic 720p dark tactical border surveillance frames
        with dynamic moving subjects for testing all AI features (YOLO pose,
        virtual fence, and loitering) even without live video.
        """
        import cv2   # type: ignore

        w, h = 1280, 720
        frame = np.full((h, w, 3), (18, 22, 28), dtype=np.uint8)

        # Ground line / horizon & grid
        cv2.line(frame, (0, int(h * 0.70)), (w, int(h * 0.70)), (30, 42, 54), 1)
        for gx in range(0, w, 160):
            cv2.line(frame, (gx, int(h * 0.70)), (gx - 100, h), (24, 32, 40), 1)

        # Draw virtual fence boundary
        if self.camera.fence_points and len(self.camera.fence_points) >= 3:
            pts = np.array([
                [int(p["x"] * w), int(p["y"] * h)] for p in self.camera.fence_points
            ], dtype=np.int32)
            cv2.polylines(frame, [pts], isClosed=True, color=(0, 60, 220), thickness=2)

        # Add camera code and timestamp watermark
        ts_str = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-4] + " UTC"
        cv2.putText(frame, f"{self.camera.code} | {self.camera.location}", (20, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (120, 180, 140), 1, cv2.LINE_AA)
        cv2.putText(frame, ts_str, (20, 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (100, 140, 120), 1, cv2.LINE_AA)

        return frame

    # ── Thread-2: Inference Loop ──────────────────────────────────────────────

    def _inference_loop(self) -> None:
        """
        Consume frames from frame_queue, run full AI pipeline, push FrameResult.
        """
        frame_skip = settings.FRAME_SKIP_RATIO
        local_tick = 0

        while not self.stop_event.is_set():
            try:
                frame = self._frame_q.get(timeout=2.0)
            except queue.Empty:
                continue

            local_tick += 1
            if local_tick % frame_skip != 0:
                continue                    # skip frames to reduce compute load

            self._frame_number += 1
            t0 = time.monotonic()

            result = self._process_frame(frame)
            result.processing_ms = (time.monotonic() - t0) * 1000

            # Push to result queue (non-blocking drop if full)
            try:
                self.result_queue.put_nowait(result)
            except Exception:
                pass

            # Periodic loitering tracker cleanup (every 300 frames)
            if self._frame_number % 300 == 0:
                removed = self._loitering.cleanup_stale(stale_seconds=60)
                if removed:
                    log.debug("[%s] Cleaned up %d stale loitering records.", self.camera.code, removed)

    # ── AI pipeline ───────────────────────────────────────────────────────────

    def _process_frame(self, frame: np.ndarray) -> FrameResult:
        """
        Full per-frame AI pipeline:
        1. Night enhancement
        2. YOLOv8 detect all humans + vehicles
        3. For each person: face detect → FRS match, pose classify
        4. For each vehicle: ANPR plate extract → watchlist check
        5. Virtual fence check (vectorised batch)
        6. Loitering dwell timer update
        7. Group clustering check
        8. Build FrameResult with alerts + annotated JPEG
        """
        import cv2   # type: ignore

        h, w = frame.shape[:2]
        now = datetime.datetime.utcnow()

        # 1. Night enhancement
        if self.camera.mode != "STANDARD":
            frame = self._enhancer.enhance(frame, self.camera.mode)

        # 2. YOLOv8 detection
        detections: List[Detection] = self._yolo.detect(frame)

        alerts: List[AlertRecord] = []
        annotated = frame.copy()

        # Prepare targets for vectorised fence check
        fence_targets = []
        for det in detections:
            fence_targets.append({
                "id": det.target_id,
                "cx": det.bbox.cx,
                "cy": det.bbox.cy,
                "dwell_seconds": self._loitering.get_dwell_seconds(det.target_id),
            })

        # 3. Vectorised fence check (all targets at once)
        fence_results = self._fence.check_targets(fence_targets)
        breach_by_id = {r.target_id: r for r in fence_results}

        # Near-breach warnings
        near_breach = set(self._fence.near_breach_targets(fence_targets))

        for det in detections:
            br = breach_by_id.get(det.target_id)
            is_in_fence = br is not None and self._fence._zone_state.is_inside(det.target_id)

            # ── Loitering update ──────────────────────────────────────────────
            dwell_rec = self._loitering.update(
                det.target_id,
                is_in_zone=is_in_fence,
                position=(det.bbox.cx, det.bbox.cy),
                now=now,
            )
            det.loiter_seconds = dwell_rec.dwell_seconds
            det.is_in_fence = is_in_fence

            # ── Virtual fence breach alert ─────────────────────────────────────
            if br and br.is_breaching:
                alert = self._make_alert(
                    camera_id=self.camera.id,
                    category="VIRTUAL_FENCE_INTRUSION",
                    severity="CRITICAL",
                    title=f"Perimeter Breach [{self.camera.code}]",
                    description=f"Target {det.target_id} ({det.class_name}) crossed virtual fence "
                                f"({br.direction.value}). Dwell: {det.loiter_seconds:.0f}s.",
                    target_id=det.target_id,
                )
                if alert:
                    alerts.append(alert)

            # ── Loitering alert ────────────────────────────────────────────────
            if self._loitering.should_fire_loitering_alert(det.target_id):
                alert = self._make_alert(
                    camera_id=self.camera.id,
                    category="LOITERING",
                    severity="HIGH",
                    title=f"Loitering Detected [{self.camera.code}]",
                    description=f"Target {det.target_id} has been stationary in zone for "
                                f"{det.loiter_seconds:.0f}s.",
                    target_id=det.target_id,
                )
                if alert:
                    alerts.append(alert)

            # ── Armed Person & Hand-Held Object Alerts ────────────────────────
            if getattr(det, "is_holding", False):
                if getattr(det, "held_item_type", "") == "WEAPON":
                    alert = self._make_alert(
                        camera_id=self.camera.id,
                        category="ARMED_PERSON",
                        severity="CRITICAL",
                        title=f"CRITICAL: Armed Subject Holding {det.held_item} [{self.camera.code}]",
                        description=f"Subject {det.target_id} confirmed armed with {det.held_item} in {det.held_by_hand or 'hand'}. Immediate DEFCON 1 response required.",
                        target_id=det.target_id,
                    )
                    if alert:
                        alerts.append(alert)
                elif getattr(det, "held_item_type", "") == "CASUAL_OBJECT" and (det.is_in_fence or det.loiter_seconds > 8):
                    alert = self._make_alert(
                        camera_id=self.camera.id,
                        category="SUSPICIOUS_CARRIER",
                        severity="HIGH",
                        title=f"Suspicious Item Carrier: {det.held_item} [{self.camera.code}]",
                        description=f"Subject {det.target_id} carrying {det.held_item} ({det.held_by_hand or 'in hand'}) in restricted sector.",
                        target_id=det.target_id,
                    )
                    if alert:
                        alerts.append(alert)

            # ── Unattended Weapon Alert ───────────────────────────────────────
            if getattr(det, "is_weapon", False) and not getattr(det, "is_held", False):
                w_name = (det.unusual_item or det.class_name).upper()
                alert = self._make_alert(
                    camera_id=self.camera.id,
                    category="UNATTENDED_WEAPON",
                    severity="HIGH",
                    title=f"Unattended Weapon: {w_name} [{self.camera.code}]",
                    description=f"Unattended weapon '{w_name}' detected without operator/handler in surveillance sector.",
                    target_id=det.target_id,
                )
                if alert:
                    alerts.append(alert)

            # ── Unattended Baggage Alert (backpack, suitcase, handbag) ─────────
            if det.class_name in ("backpack", "suitcase", "handbag") and not getattr(det, "is_held", False):
                b_name = det.class_name.upper()
                alert = self._make_alert(
                    camera_id=self.camera.id,
                    category="UNATTENDED_BAGGAGE",
                    severity="HIGH",
                    title=f"Unattended Baggage: {b_name} [{self.camera.code}]",
                    description=f"Unattended baggage/luggage '{b_name}' left unattended in perimeter area.",
                    target_id=det.target_id,
                )
                if alert:
                    alerts.append(alert)

            # ── Person analysis: FRS + activity ───────────────────────────────
            if det.class_id in HUMAN_CLASSES and "FRS" in self.camera.analytics_modes:
                x1, y1, x2, y2 = det.bbox.to_pixel(w, h)
                faces = self._face_det.detect_in_crop(frame, (x1, y1, x2, y2))
                for face in faces:
                    if face.face_crop is not None:
                        emb = self._face_rec.embed(face.face_crop)
                        if emb is not None:
                            match = self._face_rec.match_against_watchlist(emb)
                            if match:
                                det.frs_match_name  = match.name
                                det.frs_match_score = match.score
                                det.frs_watchlist_id = match.subject_id
                                alert = self._make_alert(
                                    camera_id=self.camera.id,
                                    category="FRS_MATCH",
                                    severity=("CRITICAL" if match.threat_level == "CRITICAL" else "HIGH"),
                                    title=f"FRS Match: {match.name} [{self.camera.code}]",
                                    description=f"Subject '{match.name}' matched with {match.score:.1%} "
                                                f"cosine similarity (threat: {match.threat_level}).",
                                    target_id=det.target_id,
                                    frs_match_name=match.name,
                                    frs_match_score=match.score,
                                )
                                if alert:
                                    alerts.append(alert)

                # Activity classification
                prev_pos = self._prev_positions.get(det.target_id)
                activity = self._activity.classify(det, prev_bbox_center=prev_pos)
                det.pose_label = activity.label.value
                if activity.is_suspicious and activity.label.value not in ["RUNNING", "WALKING"]:
                    alert = self._make_alert(
                        camera_id=self.camera.id,
                        category="SUSPICIOUS_ACTIVITY",
                        severity="HIGH",
                        title=f"Suspicious Activity [{self.camera.code}]",
                        description=activity.description,
                        target_id=det.target_id,
                    )
                    if alert:
                        alerts.append(alert)

            # ── Vehicle analysis: ANPR ─────────────────────────────────────────
            if det.class_id in VEHICLE_CLASSES and "ANPR" in self.camera.analytics_modes:
                x1, y1, x2, y2 = det.bbox.to_pixel(w, h)
                plates = self._anpr.detect_in_vehicle_crop(frame, (x1, y1, x2, y2))
                for plate in plates:
                    det.plate_text = plate.plate_text
                    det.plate_confidence = plate.confidence
                    matched_plate, dist = self._anpr.fuzzy_check_watchlist(
                        plate.plate_text, self._anpr_watchlist
                    )
                    if matched_plate:
                        det.is_blacklisted = True
                        alert = self._make_alert(
                            camera_id=self.camera.id,
                            category="ANPR_MATCH",
                            severity="CRITICAL",
                            title=f"Blacklisted Vehicle [{self.camera.code}]: {plate.plate_text}",
                            description=f"Plate '{plate.plate_text}' matched watchlist entry "
                                        f"'{matched_plate}' (OCR conf: {plate.confidence:.1%}, "
                                        f"Levenshtein dist: {dist}).",
                            target_id=det.target_id,
                            plate_text=plate.plate_text,
                        )
                        if alert:
                            alerts.append(alert)

            # Update previous position for velocity in next frame
            self._prev_positions[det.target_id] = (det.bbox.cx, det.bbox.cy)

        # ── Group cluster check ────────────────────────────────────────────────
        cluster_warn = self._activity.classify_group(detections)
        if cluster_warn:
            alert = self._make_alert(
                camera_id=self.camera.id,
                category="GROUP_CLUSTER",
                severity="HIGH",
                title=f"Group Clustering [{self.camera.code}]",
                description=cluster_warn,
            )
            if alert:
                alerts.append(alert)

        # ── Annotate frame ────────────────────────────────────────────────────
        annotated_jpg = self._annotate_and_encode(annotated, detections, alerts)

        return FrameResult(
            camera_id=self.camera.id,
            frame_number=self._frame_number,
            timestamp=now,
            detections=detections,
            fence_breaches=[],        # already encoded in alerts
            alerts=alerts,
            annotated_frame_jpg=annotated_jpg,
        )

    # ── Alert throttling ──────────────────────────────────────────────────────

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
        """
        Create an AlertRecord only if throttle window has elapsed for this
        camera + category combination. Prevents alert flooding.
        """
        throttle_key = f"{camera_id}:{category}"
        now_ts = time.time()
        last = self._last_alert.get(throttle_key, 0)
        if now_ts - last < self.alert_throttle:
            return None
        self._last_alert[throttle_key] = now_ts

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
            plate_text=plate_text,
        )

    # ── Frame annotation ──────────────────────────────────────────────────────

    def _annotate_and_encode(
        self,
        frame: np.ndarray,
        detections: List[Detection],
        alerts: List[AlertRecord],
    ) -> Optional[bytes]:
        """Draw bounding boxes, pose skeletons, virtual fences and encode to JPEG bytes."""
        try:
            import cv2   # type: ignore
            h, w = frame.shape[:2]

            # 1. Draw Virtual Fence overlay if configured
            if self.camera.fence_points and len(self.camera.fence_points) >= 3:
                pts = np.array([
                    [int(p["x"] * w), int(p["y"] * h)] for p in self.camera.fence_points
                ], dtype=np.int32)
                cv2.polylines(frame, [pts], isClosed=True, color=(0, 0, 255), thickness=2)
                cv2.putText(frame, "VIRTUAL FENCE ZONE", (pts[0][0], max(pts[0][1] - 8, 15)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1, cv2.LINE_AA)

            # COCO 17-Keypoint skeleton limbs
            skeleton_limbs = [
                (0, 1), (0, 2), (1, 3), (2, 4),           # Head
                (5, 6), (5, 7), (7, 9), (6, 8), (8, 10),  # Upper body / Arms
                (5, 11), (6, 12), (11, 12),               # Torso
                (11, 13), (13, 15), (12, 14), (14, 16),   # Lower body / Legs
            ]

            # 1. Draw Tether Lines between persons and held items
            for det in detections:
                if getattr(det, "is_holding", False) and getattr(det, "held_item", None):
                    for obj in detections:
                        if getattr(obj, "held_by_target_id", None) == det.target_id and obj.bbox:
                            px1, py1, px2, py2 = det.bbox.to_pixel(w, h)
                            ox1, oy1, ox2, oy2 = obj.bbox.to_pixel(w, h)
                            obj_center = ((ox1 + ox2) // 2, (oy1 + oy2) // 2)

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
                is_unusual = (
                    det.is_unusual
                    or det.is_blacklisted
                    or det.is_in_fence
                    or is_armed
                    or is_weapon
                    or (det.frs_match_score and det.frs_match_score >= settings.FRS_SIMILARITY_THRESHOLD)
                )
                is_hand_raised = det.pose_label in ("HANDS_RAISED", "HAND_RAISED")
                is_critical = is_armed or is_weapon or det.pose_label in ("CROUCHING", "PRONE")

                if is_armed or is_weapon:
                    colour = (0, 0, 255)        # Tactical Red
                elif is_unattended_bag:
                    colour = (0, 140, 255)      # Amber / Orange
                elif is_holding_casual:
                    colour = (11, 158, 245)     # Cyan-Gold
                elif is_unusual:
                    colour = (0, 0, 255)
                elif is_hand_raised:
                    colour = (11, 158, 245)     # Amber Gold (BGR)
                elif det.class_id == 0:
                    colour = (0, 242, 254)      # Cyan
                else:
                    colour = (0, 215, 255)      # Yellow

                # Draw Bounding Box & Corner Reticle
                thickness = 3 if is_critical else 2
                cv2.rectangle(frame, (x1, y1), (x2, y2), colour, thickness)

                corner_len = min(20, max(6, (x2 - x1) // 4))
                cv2.line(frame, (x1, y1), (x1 + corner_len, y1), colour, thickness + 1)
                cv2.line(frame, (x1, y1), (x1, y1 + corner_len), colour, thickness + 1)
                cv2.line(frame, (x2, y1), (x2 - corner_len, y1), colour, thickness + 1)
                cv2.line(frame, (x2, y1), (x2, y1 + corner_len), colour, thickness + 1)
                cv2.line(frame, (x1, y2), (x1 + corner_len, y2), colour, thickness + 1)
                cv2.line(frame, (x1, y2), (x1, y2 - corner_len), colour, thickness + 1)
                cv2.line(frame, (x2, y2), (x2 - corner_len, y2), colour, thickness + 1)
                cv2.line(frame, (x2, y2), (x2, y2 - corner_len), colour, thickness + 1)

                # Draw Skeleton if available
                if det.keypoints and det.keypoints.points:
                    kps = det.keypoints.points
                    for p1_idx, p2_idx in skeleton_limbs:
                        if p1_idx < len(kps) and p2_idx < len(kps):
                            kx1, ky1, c1 = kps[p1_idx]
                            kx2, ky2, c2 = kps[p2_idx]
                            if c1 > 0.35 and c2 > 0.35:
                                pt1 = (int(kx1 * w), int(ky1 * h))
                                pt2 = (int(kx2 * w), int(ky2 * h))
                                cv2.line(frame, pt1, pt2, (0, 0, 255) if is_critical else (0, 255, 128), 2, cv2.LINE_AA)

                    for kx, ky, kc in kps:
                        if kc > 0.35:
                            cv2.circle(frame, (int(kx * w), int(ky * h)), 4, (0, 0, 255) if is_critical else (0, 255, 255), -1, cv2.LINE_AA)

                # Tag Label
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
                if det.plate_text:
                    label_parts.append(f"PLATE:{det.plate_text}")
                if det.loiter_seconds > 5:
                    label_parts.append(f"DWELL:{det.loiter_seconds:.0f}s")

                label = " | ".join(label_parts)
                (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
                tag_y = max(y1 - lh - 8, 0)
                cv2.rectangle(frame, (x1, tag_y), (x1 + lw + 8, tag_y + lh + 8), (15, 20, 30), -1)
                cv2.rectangle(frame, (x1, tag_y), (x1 + lw + 8, tag_y + lh + 8), colour, 1)
                cv2.putText(frame, label, (x1 + 4, tag_y + lh + 4),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.42, colour, 1, cv2.LINE_AA)

            # Top-left HUD info
            people_cnt = sum(1 for d in detections if d.class_id == 0)
            armed_cnt = sum(1 for d in detections if getattr(d, "is_holding", False) and getattr(d, "held_item_type", "") == "WEAPON")
            weapons_cnt = sum(1 for d in detections if getattr(d, "is_weapon", False))
            casual_cnt = sum(1 for d in detections if getattr(d, "is_casual_object", False))
            unusual_cnt = sum(1 for d in detections if d.is_unusual)

            hud = f"{self.camera.code} LIVE | PPL:{people_cnt} | ARMED:{armed_cnt} | WEAPONS:{weapons_cnt} | ITEMS:{casual_cnt} | ALERTS:{len(alerts)}"
            hud_color = (0, 0, 255) if armed_cnt > 0 or weapons_cnt > 0 or len(alerts) > 0 else (0, 242, 254)
            cv2.putText(frame, hud, (20, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.52, hud_color, 2 if (armed_cnt > 0 or weapons_cnt > 0) else 1, cv2.LINE_AA)

            encode_params = [cv2.IMWRITE_JPEG_QUALITY, settings.SNAPSHOT_JPEG_QUALITY]
            _, buf = cv2.imencode(".jpg", frame, encode_params)
            return buf.tobytes()
        except Exception as exc:
            log.debug("Frame annotation error: %s", exc)
            return None

    # ── Hot-update methods (called from PipelineManager) ─────────────────────

    def update_fence(self, new_fence_points: list) -> None:
        """Hot-update virtual fence geometry without restarting the worker."""
        self.camera.fence_points = new_fence_points
        self._fence.update_fence(new_fence_points)
        log.info("[%s] Virtual fence updated (%d points).", self.camera.code, len(new_fence_points))

    def reload_frs_watchlist(self, watchlist: List[Dict]) -> None:
        self._face_rec.load_watchlist(watchlist)

    def reload_anpr_watchlist(self, plates: List[str]) -> None:
        self._anpr_watchlist = plates
