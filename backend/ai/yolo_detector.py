"""
IBVAP — Advanced YOLOv8 Multi-Person Pose & Unusual Item Detector
Detects:
  1. Multiple humans with 17-keypoint COCO pose skeletons & posture behavior.
  2. Unusual / Contraband objects: bottles, knives, scissors, cell phones, backpacks, bags, laptops, cups, pens/tools.
  3. Real-time behavior flags: crouching, loitering, hands raised, intrusion.
"""

from __future__ import annotations

import logging
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import cv2
import numpy as np

from ..config import settings
from ..database.models import BoundingBox, Detection, KeypointSet

from concurrent.futures import ThreadPoolExecutor
import torch

log = logging.getLogger("ibvap.ai.yolo")

# Determine optimal acceleration device (MPS for Apple Silicon, CUDA for NVIDIA, fallback CPU)
def get_optimal_device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"

OPTIMAL_DEVICE = get_optimal_device()
log.info("IBVAP AI Engine active compute device: %s", OPTIMAL_DEVICE)

# COCO Classes
_PERSON = 0

HUMAN_CLASSES = {_PERSON}
VEHICLE_CLASSES = {1, 2, 3, 5, 7}  # bicycle, car, motorcycle, bus, truck

# Unusual / contraband / prohibited objects to detect and mark RED with alerts
UNUSUAL_CLASSES: Dict[int, str] = {
    24: "backpack",
    25: "umbrella",
    26: "handbag",
    28: "suitcase",
    39: "bottle",
    40: "wine glass",
    41: "cup",
    42: "fork",
    43: "knife",
    44: "spoon",
    45: "bowl",
    63: "laptop",
    64: "mouse",
    65: "remote",
    66: "keyboard",
    67: "cell phone",
    73: "book",
    76: "scissors",
    77: "teddy bear",
    79: "toothbrush",
}

ALL_INTERESTING_CLASSES = HUMAN_CLASSES | VEHICLE_CLASSES | set(UNUSUAL_CLASSES.keys())

CLASS_NAMES = {
    0: "person",
    1: "bicycle",
    2: "car",
    3: "motorbike",
    5: "bus",
    7: "truck",
    **UNUSUAL_CLASSES,
}


class YOLODetector:
    """
    High-performance detector combining YOLOv8-pose (person keypoints)
    and YOLOv8 standard model (80 object classes including bottles, knives, phones, etc.)
    with Apple Silicon MPS GPU / CUDA hardware acceleration and multi-threaded parallel execution.
    """

    def __init__(self) -> None:
        self._pose_model = None
        self._obj_model = None
        self._simulation = False
        self._device = OPTIMAL_DEVICE
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="yolo_worker")
        self._load_models()

    def _load_models(self) -> None:
        pose_path: Path = settings.YOLO_POSE_MODEL
        obj_path: Path = settings.YOLO_OBJECT_MODEL

        try:
            from ultralytics import YOLO  # type: ignore

            if pose_path.exists():
                log.info("Loading YOLOv8-pose model onto %s from %s …", self._device, pose_path)
                self._pose_model = YOLO(str(pose_path))
                # Warm up model on device
                self._pose_model.to(self._device)

            if obj_path.exists():
                log.info("Loading YOLOv8 object model onto %s from %s …", self._device, obj_path)
                self._obj_model = YOLO(str(obj_path))
                self._obj_model.to(self._device)

            if self._pose_model is None and self._obj_model is None:
                log.warning("No YOLO models found on disk — running in SIMULATION mode.")
                self._simulation = True
            else:
                self._simulation = False
                log.info("YOLOv8 Dual Engine active with hardware acceleration [%s]", self._device)

        except ImportError:
            log.warning("ultralytics package not installed — running in SIMULATION mode.")
            self._simulation = True
        except Exception as exc:
            log.error("Failed to load YOLOv8 models: %s — SIMULATION mode.", exc)
            self._simulation = True

    def detect(self, frame: np.ndarray) -> List[Detection]:
        """
        Run multi-person pose estimation and unusual item detection with Apple Silicon GPU acceleration.
        """
        if self._simulation:
            return self._simulate(frame)

        h, w = frame.shape[:2]
        detections: List[Detection] = []
        person_count = 0

        # 1. Run YOLOv8-Pose (detects multiple persons with 17 keypoints) on GPU/MPS
        raised_hand_coords: List[Tuple[float, float]] = []
        if self._pose_model is not None:
            try:
                results_pose = self._pose_model(
                    frame,
                    verbose=False,
                    conf=settings.YOLO_CONFIDENCE_THRESHOLD,
                    imgsz=384,
                    device=self._device,
                )
                if results_pose and results_pose[0].boxes is not None:
                    res = results_pose[0]
                    boxes = res.boxes.xyxyn.cpu().numpy()
                    confs = res.boxes.conf.cpu().numpy()
                    classes = res.boxes.cls.cpu().numpy().astype(int)
                    keypoints_data = res.keypoints

                    for idx, (box, conf, cls_id) in enumerate(zip(boxes, confs, classes)):
                        if cls_id != _PERSON:
                            continue

                        person_count += 1
                        x1, y1, x2, y2 = box
                        bbox = BoundingBox(
                            x=float(x1),
                            y=float(y1),
                            w=float(x2 - x1),
                            h=float(y2 - y1),
                            confidence=float(conf),
                        )

                        kps: Optional[KeypointSet] = None
                        if keypoints_data is not None and keypoints_data.xyn is not None:
                            kp_raw = keypoints_data.xyn[idx].cpu().numpy()  # (17, 2)
                            kp_conf = (
                                keypoints_data.conf[idx].cpu().numpy()
                                if keypoints_data.conf is not None
                                else np.ones(17)
                            )
                            kps = KeypointSet(
                                points=[
                                    (float(kp_raw[k, 0]), float(kp_raw[k, 1]), float(kp_conf[k]))
                                    for k in range(17)
                                ]
                            )

                        pose_label = self._classify_pose(kps) if kps else "STANDING"
                        is_hands_raised, hand_pose_str, hand_pts = self._check_hands_raised(kps) if kps else (False, "STANDING", [])
                        if is_hands_raised:
                            pose_label = hand_pose_str
                            raised_hand_coords.extend(hand_pts)

                        det = Detection(
                            target_id=f"PERSON-{person_count:02d}",
                            class_id=_PERSON,
                            class_name="person",
                            bbox=bbox,
                            keypoints=kps,
                            pose_label=pose_label,
                            threat_level="CRITICAL" if pose_label in ("CROUCHING", "PRONE", "HANDS_RAISED", "HAND_RAISED") else "NORMAL",
                        )
                        detections.append(det)

            except Exception as exc:
                log.error("YOLO pose parsing error: %s", exc)

        # 2. Run YOLOv8 Object Model (detects unusual items: bottle, phone, knife, backpack, etc.) on GPU/MPS
        if self._obj_model is not None:
            try:
                # Require higher confidence (>= 0.45) for object detection to avoid false positives on hand/body parts
                obj_conf_thresh = max(0.45, settings.YOLO_CONFIDENCE_THRESHOLD)
                results_obj = self._obj_model(
                    frame,
                    verbose=False,
                    conf=obj_conf_thresh,
                    imgsz=384,
                    device=self._device,
                )
                if results_obj and results_obj[0].boxes is not None:
                    res_obj = results_obj[0]
                    boxes = res_obj.boxes.xyxyn.cpu().numpy()
                    confs = res_obj.boxes.conf.cpu().numpy()
                    classes = res_obj.boxes.cls.cpu().numpy().astype(int)

                    item_count = 0
                    for box, conf, cls_id in zip(boxes, confs, classes):
                        # Skip person from object model if pose model already captured them
                        if cls_id == _PERSON and self._pose_model is not None:
                            continue

                        # Check if vehicle or unusual item
                        if cls_id in UNUSUAL_CLASSES or cls_id in VEHICLE_CLASSES:
                            x1, y1, x2, y2 = box
                            class_name = CLASS_NAMES.get(cls_id, "object")
                            is_unusual_item = cls_id in UNUSUAL_CLASSES

                            # Suppress false-positive object detections caused by raised hands
                            if is_unusual_item and raised_hand_coords:
                                obj_cx = float(x1 + x2) / 2.0
                                obj_cy = float(y1 + y2) / 2.0
                                is_hand_false_positive = False
                                for hx, hy in raised_hand_coords:
                                    dist = np.hypot(obj_cx - hx, obj_cy - hy)
                                    # Common ambiguous hand-part COCO items: phone, mouse, toothbrush, scissors, cup, etc.
                                    if dist < 0.14 and conf < 0.72 and cls_id in (41, 42, 43, 44, 45, 64, 65, 66, 67, 73, 76, 79):
                                        is_hand_false_positive = True
                                        break
                                if is_hand_false_positive:
                                    log.info("Suppressed hand false-positive object detection: %s (conf=%.2f)", class_name, conf)
                                    continue

                            item_count += 1
                            det = Detection(
                                target_id=f"ITEM-{item_count:02d}" if is_unusual_item else f"VEH-{item_count:02d}",
                                class_id=cls_id,
                                class_name=class_name,
                                bbox=BoundingBox(
                                    x=float(x1),
                                    y=float(y1),
                                    w=float(x2 - x1),
                                    h=float(y2 - y1),
                                    confidence=float(conf),
                                ),
                                is_unusual=is_unusual_item,
                                unusual_item=class_name.upper() if is_unusual_item else None,
                                threat_level="CRITICAL" if is_unusual_item else "NORMAL",
                            )
                            detections.append(det)

            except Exception as exc:
                log.error("YOLO object parsing error: %s", exc)

        return detections

    def _detect_pen_like_items(self, frame: np.ndarray, current_detections: List[Detection]) -> List[Detection]:
        """
        Legacy heuristic disabled to prevent false positives on human hands/wrists.
        """
        return []
        h, w = frame.shape[:2]
        extra_dets = []
        gray = None

        for det in current_detections:
            if det.class_id != _PERSON or not det.keypoints:
                continue

            pts = det.keypoints.points
            # Left wrist (9) and Right wrist (10)
            for w_idx in (9, 10):
                if w_idx < len(pts):
                    wx, wy, wc = pts[w_idx]
                    if wc > 0.4:
                        # Extract 100x100 region around wrist
                        cx, cy = int(wx * w), int(wy * h)
                        r = 45
                        x1 = max(0, cx - r)
                        y1 = max(0, cy - r)
                        x2 = min(w, cx + r)
                        y2 = min(h, cy + r)

                        if x2 - x1 < 20 or y2 - y1 < 20:
                            continue

                        if gray is None:
                            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

                        wrist_crop = gray[y1:y2, x1:x2]
                        # Edge detection
                        edges = cv2.Canny(wrist_crop, 50, 150)
                        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=25, minLineLength=20, maxLineGap=5)

                        if lines is not None and len(lines) >= 2:
                            # Detected elongated pen/tool in hand!
                            nx1 = x1 / w
                            ny1 = y1 / h
                            nw = (x2 - x1) / w
                            nh = (y2 - y1) / h
                            extra_dets.append(
                                Detection(
                                    target_id=f"ITEM-PEN-{uuid.uuid4().hex[:4].upper()}",
                                    class_id=99,
                                    class_name="pen / tool",
                                    bbox=BoundingBox(x=nx1, y=ny1, w=nw, h=nh, confidence=0.88),
                                    is_unusual=True,
                                    unusual_item="PEN / TOOL",
                                    threat_level="CRITICAL",
                                )
                            )
                            break
        return extra_dets

    @staticmethod
    def _classify_pose(kps: KeypointSet) -> str:
        pts = kps.points
        nose = pts[0]
        l_hip = pts[11]
        r_hip = pts[12]
        l_ank = pts[15]
        r_ank = pts[16]
        l_knee = pts[13]
        r_knee = pts[14]

        if nose[2] < 0.25:
            return "STANDING"

        body_height = abs(nose[1] - max(l_ank[1], r_ank[1])) if (l_ank[2] > 0.2 or r_ank[2] > 0.2) else 0.4
        body_width = abs(l_hip[0] - r_hip[0])

        if body_height < 0.15:
            return "PRONE"
        if body_height < 0.28 or (l_knee[1] < l_hip[1] + 0.05 and r_knee[1] < r_hip[1] + 0.05):
            return "CROUCHING"
        if body_width > body_height * 0.75:
            return "SITTING"
        return "STANDING"

    @staticmethod
    def _check_hands_raised(kps: KeypointSet) -> Tuple[bool, str, List[Tuple[float, float]]]:
        """
        Detect whether left, right, or both hands are raised above shoulders/chest/head.
        Returns: (is_raised, pose_label, list_of_raised_hand_coordinates)
        """
        pts = kps.points
        if len(pts) < 17:
            return False, "STANDING", []

        l_wrist = pts[9]
        r_wrist = pts[10]
        l_shoulder = pts[5]
        r_shoulder = pts[6]
        nose = pts[0]

        hand_pts: List[Tuple[float, float]] = []
        l_raised = False
        r_raised = False

        # Left hand elevation check
        if l_wrist[2] > 0.25:
            if l_shoulder[2] > 0.25 and l_wrist[1] < l_shoulder[1] - 0.02:
                l_raised = True
                hand_pts.append((l_wrist[0], l_wrist[1]))
            elif nose[2] > 0.25 and l_wrist[1] < nose[1] + 0.06:
                l_raised = True
                hand_pts.append((l_wrist[0], l_wrist[1]))

        # Right hand elevation check
        if r_wrist[2] > 0.25:
            if r_shoulder[2] > 0.25 and r_wrist[1] < r_shoulder[1] - 0.02:
                r_raised = True
                hand_pts.append((r_wrist[0], r_wrist[1]))
            elif nose[2] > 0.25 and r_wrist[1] < nose[1] + 0.06:
                r_raised = True
                hand_pts.append((r_wrist[0], r_wrist[1]))

        if l_raised and r_raised:
            return True, "HANDS_RAISED", hand_pts
        elif l_raised or r_raised:
            return True, "HAND_RAISED", hand_pts

        return False, "STANDING", []

    @staticmethod
    def _simulate(frame: np.ndarray) -> List[Detection]:
        import random
        detections = []
        n = random.randint(1, 3)
        for i in range(n):
            detections.append(
                Detection(
                    target_id=f"SIM-P{i+1}",
                    class_id=_PERSON,
                    class_name="person",
                    bbox=BoundingBox(
                        x=0.2 + i * 0.25,
                        y=0.25,
                        w=0.18,
                        h=0.45,
                        confidence=0.95,
                    ),
                    pose_label=random.choice(["STANDING", "CROUCHING", "SITTING"]),
                )
            )
        return detections
