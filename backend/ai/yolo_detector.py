"""
IBVAP — Advanced YOLOv8 Multi-Person Pose, Dedicated Weapon & Casual Object Detector
Combines:
  1. YOLOv8-pose (17-keypoint COCO skeleton tracking, posture classification, wrist localization)
  2. Dedicated YOLOv8 Weapon Neural Engine (firearms, pistols, knives)
  3. YOLOv8 Multi-class Object Engine (80 COCO classes: casual bags, bottles, phones, tools, laptops)
  4. Real-time Hand-Held & Threat Escalation Engine:
     - Detects when a person is holding a weapon (CRITICAL / DEFCON 1 armed subject alert)
     - Detects when a person is carrying casual objects (backpacks, phones, bottles, luggage)
     - Detects unattended baggage / unattended weapons
"""

from __future__ import annotations

import logging
import math
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import cv2
import numpy as np
import torch

from ..config import MODELS_DIR, settings
from ..database.models import BoundingBox, Detection, KeypointSet

log = logging.getLogger("ibvap.ai.yolo")


def get_optimal_device() -> str:
    """Determine optimal compute hardware: Apple Silicon MPS, Nvidia CUDA, or CPU."""
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


OPTIMAL_DEVICE = get_optimal_device()
log.info("IBVAP AI Engine active compute device: %s", OPTIMAL_DEVICE)

# COCO Class constants
_PERSON = 0
HUMAN_CLASSES = {_PERSON}
VEHICLE_CLASSES = {1, 2, 3, 5, 7}  # bicycle, car, motorcycle, bus, truck

# Weapon classifications (dedicated model + COCO weapons)
WEAPON_CLASSES: Dict[int, str] = {
    43: "knife",
}
WEAPON_NAMES: Set[str] = {
    "pistol", "gun", "firearm", "rifle", "shotgun", "handgun",
    "knife", "blade", "dagger", "sword", "machete", "weapon",
}

# Casual & everyday objects relevant to security surveillance
CASUAL_OBJECT_CLASSES: Dict[int, str] = {
    24: "backpack",
    25: "umbrella",
    26: "handbag",
    28: "suitcase",
    34: "baseball bat",
    39: "bottle",
    41: "cup",
    43: "knife",
    63: "laptop",
    64: "mouse",
    66: "keyboard",
    67: "cell phone",
    73: "book",
    74: "clock",
    76: "scissors",
}

BAGGAGE_NAMES: Set[str] = {"backpack", "handbag", "suitcase"}

# Only these classes can physically be handheld by a person
HOLDABLE_CLASSES: Set[str] = {
    "pistol", "gun", "firearm", "rifle", "shotgun", "handgun",
    "knife", "blade", "dagger", "sword", "machete", "weapon",
    "cell phone", "phone", "smartphone", "bottle", "water bottle", "cup", "mug",
    "pen", "pencil", "book", "notebook", "scissors", "backpack",
    "bag", "handbag", "suitcase", "wallet", "baseball bat", "umbrella", "wristwatch", "watch", "smartwatch",
    "glasses", "spectacles", "sunglasses", "headphones", "earphones", "neckband",
    "laptop", "tablet",
}

ALL_OBJECT_CLASSES = {**WEAPON_CLASSES, **CASUAL_OBJECT_CLASSES}


class YOLODetector:
    """
    High-performance multi-network vision detector with hardware acceleration.
    Integrates Pose, Weapon, YOLO-World Open-Vocabulary, and Casual Object models with hand-held threat escalation.
    """

    def __init__(self) -> None:
        self._pose_model = None
        self._obj_model = None
        self._weapon_model = None
        self._world_model = None
        self._simulation = False
        self._device = OPTIMAL_DEVICE
        self._load_models()

    def _load_models(self) -> None:
        pose_path: Path = settings.YOLO_POSE_MODEL
        obj_path: Path = settings.YOLO_OBJECT_MODEL
        weapon_path: Path = getattr(settings, "YOLO_WEAPON_MODEL", MODELS_DIR / "weapon_yolov8n.pt")

        def _resolve_model(base_path: Path) -> Path:
            stem = base_path.stem
            folder = base_path.parent
            for cand in [
                folder / f"{stem}_int8.onnx",
                folder / f"{stem}_fp16.onnx",
                folder / f"{stem}.onnx",
                base_path,
            ]:
                if cand.exists():
                    return cand
            return base_path

        try:
            from ultralytics import YOLO  # type: ignore

            def _safe_load(path: Path, task: Optional[str] = None):
                target = _resolve_model(path)
                if not target.exists():
                    return None
                log.info("Loading YOLO neural engine: %s (accelerator: %s)", target.name, self._device)
                try:
                    m = YOLO(str(target), task=task)
                    if not str(target).endswith(".onnx"):
                        m.to(self._device)
                    return m
                except Exception as exc:
                    log.warning("Could not load %s: %s — falling back to base %s", target.name, exc, path.name)
                    if path.exists():
                        m = YOLO(str(path), task=task)
                        m.to(self._device)
                        return m
                    return None

            # 1. Pose Model
            self._pose_model = _safe_load(pose_path, task="pose")

            # 2. YOLO-World Open-Vocabulary Model (Detects all custom/open-vocabulary classes)
            if getattr(settings, "USE_YOLO_WORLD", False):
                try:
                    from ultralytics import YOLOWorld
                    configured_path = MODELS_DIR / "yolov8s-worldv2-configured.pt"
                    base_path = getattr(settings, "YOLO_WORLD_MODEL", MODELS_DIR / "yolov8s-worldv2.pt")
                    chosen_path = configured_path if configured_path.exists() else base_path
                    if chosen_path.exists():
                        log.info("Loading YOLO-World neural engine: %s (accelerator: %s)", chosen_path.name, self._device)
                        self._world_model = YOLOWorld(str(chosen_path))
                        self._world_model.to(self._device)
                        # If base model without preconfigured classes, set open-vocabulary classes
                        if len(self._world_model.names) <= 80 and "glasses" not in self._world_model.names.values():
                            open_vocab = [
                                'person', 'glasses', 'spectacles', 'sunglasses', 'watch', 'wristwatch', 'smartwatch',
                                'headphones', 'earphones', 'neckband', 'hat', 'cap', 'helmet', 'shoes',
                                'cell phone', 'laptop', 'tablet', 'keyboard', 'mouse', 'pen', 'pencil',
                                'book', 'notebook', 'bottle', 'cup', 'mug', 'scissors',
                                'backpack', 'bag', 'handbag', 'suitcase', 'wallet', 'umbrella',
                                'chair', 'table', 'desk', 'sofa', 'bed', 'wardrobe', 'shelf', 'door', 'window',
                                'television', 'monitor', 'fan', 'clock',
                                'knife', 'pistol', 'gun', 'rifle', 'weapon',
                                'bicycle', 'motorcycle', 'car', 'truck', 'bus',
                                'dog', 'cat'
                            ]
                            try:
                                self._world_model.set_classes(open_vocab)
                            except Exception as c_err:
                                log.warning("Could not set classes on YOLO-World: %s", c_err)
                        log.info("YOLO-World ready with %d detection classes.", len(self._world_model.names))
                except Exception as w_exc:
                    log.warning("Could not initialize YOLO-World: %s — falling back to standard YOLOv8", w_exc)
                    self._world_model = None

            # 3. General Object Model (80 COCO classes)
            self._obj_model = _safe_load(obj_path, task="detect")

            # 4. Dedicated Weapon Model (Pistol, Knife)
            self._weapon_model = _safe_load(weapon_path, task="detect")

            if self._pose_model is None and self._obj_model is None and self._weapon_model is None and self._world_model is None:
                log.warning("No YOLO models found on disk — running in SIMULATION mode.")
                self._simulation = True
            else:
                self._simulation = False
                log.info(
                    "IBVAP Vision Neural Engines online: Pose=%s, YOLO-World=%s, Object=%s, Weapon=%s [%s]",
                    self._pose_model is not None,
                    self._world_model is not None,
                    self._obj_model is not None,
                    self._weapon_model is not None,
                    self._device,
                )

        except ImportError:
            log.warning("ultralytics package not installed — running in SIMULATION mode.")
            self._simulation = True
        except Exception as exc:
            log.error("Failed to load YOLO models: %s — SIMULATION mode.", exc)
            self._simulation = True

    @staticmethod
    def _check_watch_or_circular_geometry(crop_bgr: Optional[np.ndarray]) -> Tuple[bool, str]:
        """
        Evaluates geometric and morphological characteristics to distinguish
        wristwatches, dials, and circular accessories from firearms/pistols.
        Firearms exhibit asymmetric L-shape contours (barrel + handle), whereas
        watches and circular accessories exhibit high circularity or concentric dial edges.
        """
        if crop_bgr is None or crop_bgr.size == 0:
            return False, "empty"
        ch, cw = crop_bgr.shape[:2]
        if ch < 10 or cw < 10:
            return False, "too_small"
        if ch > 90 or cw > 90:
            return False, "too_large"

        try:
            gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
            blurred = cv2.GaussianBlur(gray, (5, 5), 1.5)

            # 1. Hough Circles (detects circular watch dial / smartwatch face)
            min_dim = min(ch, cw)
            max_dim = max(ch, cw)
            min_r = max(4, int(min_dim * 0.15))
            max_r = max(min_r + 2, int(max_dim * 0.55))
            if max_r > min_r:
                circles = cv2.HoughCircles(
                    blurred,
                    cv2.HOUGH_GRADIENT,
                    dp=1.2,
                    minDist=max(5.0, min_dim * 0.30),
                    param1=50,
                    param2=24,
                    minRadius=min_r,
                    maxRadius=max_r,
                )
                if circles is not None and len(circles[0]) > 0:
                    return True, "hough_circle_dial"

            # 2. Contour circularity & circle solidity
            edges = cv2.Canny(blurred, 30, 100)
            contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for cnt in contours:
                area = cv2.contourArea(cnt)
                if area > (cw * ch * 0.12):
                    (ccx, ccy), radius = cv2.minEnclosingCircle(cnt)
                    circle_area = math.pi * (radius ** 2)
                    if circle_area > 0:
                        solidity = area / circle_area
                        if solidity > 0.72:
                            return True, f"circle_solidity_{solidity:.2f}"
                    perim = cv2.arcLength(cnt, True)
                    if perim > 0:
                        circ = 4.0 * math.pi * (area / (perim * perim))
                        if circ > 0.75:
                            return True, f"circular_contour_{circ:.2f}"

            # 3. Watch dial aspect ratio with metal strap
            aspect = cw / float(ch)
            if 0.65 <= aspect <= 1.35 and (cw * ch) < (80 * 80):
                center_crop = edges[int(ch * 0.25):int(ch * 0.75), int(cw * 0.25):int(cw * 0.75)]
                if center_crop.size > 0 and np.mean(center_crop) > 15:
                    return True, "watch_aspect_dial"
        except Exception as e:
            log.debug("Watch geometry evaluation exception: %s", e)

        return False, "none"

    def detect(self, frame: np.ndarray) -> List[Detection]:
        """
        Runs multi-pass neural vision pipeline:
          1. Pose & Human skeleton inference
          2. Dedicated weapon inference (Pistol, Knife)
          3. General casual object & vehicle inference (Backpacks, Phones, Luggage, Bottles, etc.)
          4. Hand-Held Object Spatial Association & Threat Escalation
        """
        if self._simulation:
            return self._simulate(frame)

        h, w = frame.shape[:2]
        persons: List[Detection] = []
        objects: List[Detection] = []
        vehicles: List[Detection] = []

        person_count = 0
        weapon_count = 0
        object_count = 0
        vehicle_count = 0

        # Adaptive inference resolution: 320 on CPU for fast real-time inference, 640 on GPU/MPS
        infer_imgsz = 320 if self._device == "cpu" else 640

        # Pose inference (human skeletons)
        if self._pose_model is not None:
            try:
                results_pose = self._pose_model(
                    frame,
                    verbose=False,
                    conf=settings.YOLO_CONFIDENCE_THRESHOLD,
                    imgsz=infer_imgsz,
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
                        is_hands_raised, hand_pose_str = self._check_hands_raised(kps) if kps else (False, "STANDING")
                        if is_hands_raised:
                            pose_label = hand_pose_str

                        det = Detection(
                            target_id=f"PERSON-{person_count:02d}",
                            class_id=_PERSON,
                            class_name="person",
                            bbox=bbox,
                            keypoints=kps,
                            pose_label=pose_label,
                            threat_level="CRITICAL" if pose_label in ("CROUCHING", "PRONE", "HANDS_RAISED", "HAND_RAISED") else "NORMAL",
                        )
                        persons.append(det)
            except Exception as exc:
                log.error("YOLO pose parsing error: %s", exc)

        # Dedicated weapon detection (pistols, knives)
        detected_weapon_boxes: List[Tuple[float, float, float, float]] = []
        if self._weapon_model is not None:
            try:
                # Calibrated confirmed weapon alert threshold (default 0.80) & uncertain floor (0.35)
                weapon_confirmed_threshold = getattr(settings, "YOLO_WEAPON_CONFIDENCE_THRESHOLD", 0.80)
                weapon_candidate_floor = getattr(settings, "YOLO_WEAPON_UNCERTAIN_FLOOR", 0.35)

                results_w = self._weapon_model(
                    frame,
                    verbose=False,
                    conf=weapon_candidate_floor,
                    imgsz=infer_imgsz,
                    device=self._device,
                )
                if results_w and results_w[0].boxes is not None:
                    res_w = results_w[0]
                    boxes = res_w.boxes.xyxyn.cpu().numpy()
                    confs = res_w.boxes.conf.cpu().numpy()
                    classes = res_w.boxes.cls.cpu().numpy().astype(int)

                    for box, conf, cls_id in zip(boxes, confs, classes):
                        name = res_w.names.get(cls_id, "weapon").lower()
                        x1, y1, x2, y2 = box
                        bw = float(x2 - x1)
                        bh = float(y2 - y1)
                        actual_conf = float(conf)
                        cx = (x1 + x2) / 2.0
                        cy = (y1 + y2) / 2.0

                        # Crop object for fine-grained geometric and morphological analysis
                        crop_x1 = max(0, int(x1 * w))
                        crop_y1 = max(0, int(y1 * h))
                        crop_x2 = min(w, int(x2 * w))
                        crop_y2 = min(h, int(y2 * h))
                        crop = frame[crop_y1:crop_y2, crop_x1:crop_x2] if (crop_x2 > crop_x1 and crop_y2 > crop_y1) else None

                        # Check proximity to any person's detected wrists
                        is_near_wrist = False
                        is_wrist_scale = (bw <= 0.08 and bh <= 0.08)
                        for p in persons:
                            if p.keypoints and p.keypoints.points:
                                pts = p.keypoints.points
                                l_wrist = pts[9] if len(pts) > 9 else (0, 0, 0)
                                r_wrist = pts[10] if len(pts) > 10 else (0, 0, 0)
                                if l_wrist[2] > 0.45 and math.hypot(cx - l_wrist[0], cy - l_wrist[1]) < 0.08:
                                    is_near_wrist = True
                                    break
                                if r_wrist[2] > 0.45 and math.hypot(cx - r_wrist[0], cy - r_wrist[1]) < 0.08:
                                    is_near_wrist = True
                                    break

                        # Check circular dial / watch geometry
                        is_watch_geom, geom_reason = self._check_watch_or_circular_geometry(crop)

                        # RULE 1: Do not classify a small wristwatch accessory as a firearm.
                        # Strict: only re-label if actually small and physically on a wrist.
                        if is_wrist_scale and is_near_wrist and is_watch_geom:
                            object_count += 1
                            det = Detection(
                                target_id=f"ITEM-{object_count:02d}",
                                class_id=74,  # Clock / Watch class
                                class_name="wristwatch",
                                bbox=BoundingBox(
                                    x=float(x1),
                                    y=float(y1),
                                    w=bw,
                                    h=bh,
                                    confidence=actual_conf,
                                ),
                                is_casual_object=True,
                                is_weapon=False,
                                is_unusual=True,
                                unusual_item="WRISTWATCH",
                                threat_level="NORMAL",
                            )
                            objects.append(det)
                            log.info(
                                "[FILTER] Protected wristwatch from false weapon detection (conf=%.2f, reason=%s, near_wrist=%s)",
                                actual_conf, geom_reason, is_near_wrist,
                            )
                            continue

                        # RULE 2: Use actual confidence and apply appropriate threshold for weapon alerts.
                        # Weapons must satisfy physical size bounds (cannot be giant background fixtures).
                        if actual_conf >= weapon_confirmed_threshold and bw <= 0.35 and bh <= 0.45:
                            detected_weapon_boxes.append((float(x1), float(y1), float(x2), float(y2)))
                            weapon_count += 1
                            det = Detection(
                                target_id=f"WEAPON-{weapon_count:02d}",
                                class_id=100 + cls_id,
                                class_name=name,
                                bbox=BoundingBox(
                                    x=float(x1),
                                    y=float(y1),
                                    w=bw,
                                    h=bh,
                                    confidence=actual_conf,
                                ),
                                is_weapon=True,
                                is_unusual=True,
                                unusual_item=name.upper(),
                                threat_level="HIGH",  # Will escalate to CRITICAL if held by a person
                            )
                            objects.append(det)
                        elif actual_conf >= weapon_candidate_floor and bw <= 0.20 and bh <= 0.25:
                            # Model candidate in moderate-high confidence range: show UNKNOWN OBJECT without alert
                            object_count += 1
                            det = Detection(
                                target_id=f"ITEM-{object_count:02d}",
                                class_id=999,
                                class_name="unknown object",
                                bbox=BoundingBox(
                                    x=float(x1),
                                    y=float(y1),
                                    w=bw,
                                    h=bh,
                                    confidence=actual_conf,
                                ),
                                is_casual_object=True,
                                is_weapon=False,
                                is_unusual=True,
                                unusual_item="UNKNOWN OBJECT",
                                threat_level="NORMAL",
                            )
                            objects.append(det)
                            log.info(
                                "[UNCERTAIN] Model uncertain about '%s' (conf=%.2f < %.2f) — displaying UNKNOWN OBJECT with no weapon alert",
                                name, actual_conf, weapon_confirmed_threshold,
                            )
            except Exception as exc:
                log.error("Weapon model inference error: %s", exc)

        # General & open-vocabulary object detection (YOLO-World / YOLOv8)
        active_detector = self._world_model if self._world_model is not None else self._obj_model
        if active_detector is not None:
            try:
                # Use open-vocabulary threshold (0.20) for YOLO-World or casual threshold (0.25) for COCO
                detector_conf = (
                    getattr(settings, "YOLO_WORLD_CONFIDENCE_THRESHOLD", 0.20)
                    if self._world_model is not None
                    else getattr(settings, "YOLO_OBJECT_CONFIDENCE_THRESHOLD", 0.25)
                )
                results_obj = active_detector(
                    frame,
                    verbose=False,
                    conf=detector_conf,
                    imgsz=infer_imgsz,
                    device=self._device,
                )
                if results_obj and results_obj[0].boxes is not None:
                    res_obj = results_obj[0]
                    boxes = res_obj.boxes.xyxyn.cpu().numpy()
                    confs = res_obj.boxes.conf.cpu().numpy()
                    classes = res_obj.boxes.cls.cpu().numpy().astype(int)

                    for box, conf, cls_id in zip(boxes, confs, classes):
                        x1, y1, x2, y2 = box
                        bw = float(x2 - x1)
                        bh = float(y2 - y1)
                        item_name = res_obj.names.get(cls_id, "object").lower().strip()

                        # 3a. Person detected by object model: deduplicate with pose model
                        if cls_id == _PERSON or item_name == "person":
                            is_dup = False
                            for p in persons:
                                if p.bbox and self._compute_iou((x1, y1, x2, y2), (p.bbox.x, p.bbox.y, p.bbox.x + p.bbox.w, p.bbox.y + p.bbox.h)) > 0.4:
                                    is_dup = True
                                    break
                            if is_dup:
                                continue
                            person_count += 1
                            det = Detection(
                                target_id=f"PERSON-{person_count:02d}",
                                class_id=_PERSON,
                                class_name="person",
                                bbox=BoundingBox(
                                    x=float(x1),
                                    y=float(y1),
                                    w=bw,
                                    h=bh,
                                    confidence=float(conf),
                                ),
                                pose_label="ACTIVE",
                                threat_level="NORMAL",
                            )
                            persons.append(det)
                            continue

                        # 3b. Weapon detected by object model: check if duplicate or valid
                        is_weapon_item = (
                            cls_id in WEAPON_CLASSES
                            or item_name in WEAPON_NAMES
                            or any(w in item_name for w in ("knife", "gun", "pistol", "rifle", "dagger", "sword", "weapon", "firearm", "blade"))
                        )
                        if is_weapon_item:
                            is_dup = False
                            for wx1, wy1, wx2, wy2 in detected_weapon_boxes:
                                if self._compute_iou((x1, y1, x2, y2), (wx1, wy1, wx2, wy2)) > 0.35:
                                    is_dup = True
                                    break
                            if is_dup:
                                continue

                            weapon_count += 1
                            det = Detection(
                                target_id=f"WEAPON-{weapon_count:02d}",
                                class_id=cls_id,
                                class_name=item_name,
                                bbox=BoundingBox(
                                    x=float(x1),
                                    y=float(y1),
                                    w=bw,
                                    h=bh,
                                    confidence=float(conf),
                                ),
                                is_weapon=True,
                                is_unusual=True,
                                unusual_item=item_name.upper(),
                                threat_level="HIGH",
                            )
                            objects.append(det)
                            continue

                        # 3c. Vehicle detection (car, bus, truck, motorcycle, bicycle)
                        is_vehicle = (
                            cls_id in VEHICLE_CLASSES
                            or item_name in ("car", "truck", "bus", "motorcycle", "bicycle", "airplane", "boat", "train")
                            or any(v in item_name for v in ("vehicle", "auto", "bike", "scooter"))
                        )
                        if is_vehicle:
                            vehicle_count += 1
                            det = Detection(
                                target_id=f"VEH-{vehicle_count:02d}",
                                class_id=cls_id if cls_id in VEHICLE_CLASSES else 2,
                                class_name=item_name,
                                bbox=BoundingBox(
                                    x=float(x1),
                                    y=float(y1),
                                    w=bw,
                                    h=bh,
                                    confidence=float(conf),
                                ),
                                threat_level="NORMAL",
                            )
                            vehicles.append(det)
                            continue

                        # 3d. All other objects: accessories, electronics, furniture, containers, stationery, etc.
                        is_baggage = item_name in BAGGAGE_NAMES or "bag" in item_name or "suitcase" in item_name or "backpack" in item_name
                        is_phone = "phone" in item_name or "cell" in item_name
                        is_watch = "watch" in item_name
                        is_clock = "clock" in item_name and not is_watch

                        # If a generic 'unknown object' from weapon model overlaps with this known detection, replace it
                        objects = [
                            o for o in objects
                            if not (
                                o.class_name == "unknown object"
                                and o.bbox
                                and self._compute_iou((x1, y1, x2, y2), (o.bbox.x, o.bbox.y, o.bbox.x + o.bbox.w, o.bbox.y + o.bbox.h)) > 0.25
                            )
                        ]

                        object_count += 1
                        clean_name = "clock" if is_clock else ("wristwatch" if is_watch else item_name)
                        display_label = "CLOCK" if is_clock else ("WRISTWATCH" if is_watch else ("CELL PHONE" if is_phone else item_name.upper()))

                        det = Detection(
                            target_id=f"ITEM-{object_count:02d}",
                            class_id=cls_id,
                            class_name=clean_name,
                            bbox=BoundingBox(
                                x=float(x1),
                                y=float(y1),
                                w=bw,
                                h=bh,
                                confidence=float(conf),
                            ),
                            is_casual_object=True,
                            is_unusual=is_baggage or is_phone or is_watch,
                            unusual_item=display_label,
                            threat_level="HIGH" if is_baggage else "NORMAL",
                        )
                        objects.append(det)
            except Exception as exc:
                log.error("Object model inference error: %s", exc)

        # Note: Do not run color-contour vehicle detection on real camera frames
        # as blue/orange furniture (coolers, cabinets) gets falsely classified as cars/buses.

        # Hand-held object spatial association
        self._associate_hands_and_objects(persons, objects)

        return persons + objects + vehicles

    def _detect_synthetic_vehicles(self, frame: np.ndarray) -> List[Detection]:
        """
        Instant OpenCV contour detector for synthetic CCTV & highway traffic simulation feeds.
        Detects blue/orange vehicle bodies moving across highway lanes.
        """
        try:
            h, w = frame.shape[:2]
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
            mask_blue = cv2.inRange(hsv, np.array([90, 70, 70]), np.array([130, 255, 255]))
            mask_orange = cv2.inRange(hsv, np.array([10, 90, 90]), np.array([35, 255, 255]))
            mask = cv2.bitwise_or(mask_blue, mask_orange)

            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            synthetic_vehicles = []
            veh_count = 0
            for cnt in contours:
                x, y, bw, bh = cv2.boundingRect(cnt)
                area = bw * bh
                if bw > 28 and bh > 16 and area > 700:
                    veh_count += 1
                    is_bus = bw > 110
                    v_class = "bus" if is_bus else "car"
                    cls_id = 5 if is_bus else 2
                    conf = 0.94 if is_bus else 0.91
                    det = Detection(
                        target_id=f"VEH-{veh_count:02d}",
                        class_id=cls_id,
                        class_name=v_class,
                        bbox=BoundingBox(
                            x=float(x / w),
                            y=float(y / h),
                            w=float(bw / w),
                            h=float(bh / h),
                            confidence=conf,
                        ),
                        threat_level="NORMAL",
                    )
                    synthetic_vehicles.append(det)
            return synthetic_vehicles
        except Exception as exc:
            log.debug("Synthetic vehicle detection error: %s", exc)
            return []

    def _associate_hands_and_objects(
        self,
        persons: List[Detection],
        objects: List[Detection],
    ) -> None:
        """
        Correlates detected persons with nearby objects (weapons, cell phones, casual items).
        If an object is held in hand, near ear/head, or in front of upper body:
          - Marks object as held (`is_held = True`, `held_by_target_id = person.id`)
          - Marks person as holding (`is_holding = True`, `held_item = item_name`, `held_by_hand = hand`)
          - ESCALATES THREAT:
            * Weapon in hand -> Person threat = CRITICAL (DEFCON 1), Object threat = CRITICAL
            * Casual item in hand -> Person threat updated with held info, Object threat = NORMAL (attended)
            * Unattended baggage -> Threat = HIGH
        """
        for obj in objects:
            if not obj.bbox:
                continue

            cname = obj.class_name.lower()
            # Only holdable object categories can ever be associated with a person's hands
            if cname not in HOLDABLE_CLASSES and not any(w in cname for w in ("weapon", "gun", "knife", "pistol", "phone")):
                continue

            ox1, oy1 = obj.bbox.x, obj.bbox.y
            ow, oh = obj.bbox.w, obj.bbox.h
            ocx, ocy = obj.bbox.cx, obj.bbox.cy
            is_phone = "phone" in cname or "cell" in cname
            is_baggage = cname in BAGGAGE_NAMES

            best_person: Optional[Detection] = None
            best_dist = 999.0
            held_hand_label = "IN_HAND"

            for person in persons:
                if not person.bbox:
                    continue

                px, py, pw, ph = person.bbox.x, person.bbox.y, person.bbox.w, person.bbox.h
                person_area = max(1e-5, pw * ph)
                obj_area = ow * oh

                # Scale check: Handheld objects cannot exceed 18% of person bbox area
                # (except baggage/luggage which can be carried or worn)
                if not is_baggage:
                    if obj_area > person_area * 0.18 or ow > 0.22 or oh > 0.28:
                        continue

                # Spatial reject if object center is far outside person envelope
                if (
                    ocx < px - 0.08
                    or ocx > px + pw + 0.08
                    or ocy < py - 0.06
                    or ocy > py + ph + 0.10
                ):
                    continue

                hand_found = False
                dist_to_hand = 999.0
                detected_hand = "IN_HAND"

                # Check 17 COCO keypoints: wrists (9, 10), elbows (7, 8), ears (3, 4)
                if person.keypoints and person.keypoints.points:
                    pts = person.keypoints.points
                    l_wrist = pts[9] if len(pts) > 9 else (0, 0, 0)
                    r_wrist = pts[10] if len(pts) > 10 else (0, 0, 0)
                    l_ear = pts[3] if len(pts) > 3 else (0, 0, 0)
                    r_ear = pts[4] if len(pts) > 4 else (0, 0, 0)

                    # Realistic grasp radius: must be tightly near wrist/hand
                    grasp_radius = min(0.12, max(0.06, ph * 0.22))

                    l_dist = math.hypot(ocx - l_wrist[0], ocy - l_wrist[1]) if l_wrist[2] > 0.45 else 999.0
                    r_dist = math.hypot(ocx - r_wrist[0], ocy - r_wrist[1]) if r_wrist[2] > 0.45 else 999.0

                    # Check ear proximity for phone usage
                    l_ear_dist = math.hypot(ocx - l_ear[0], ocy - l_ear[1]) if (is_phone and l_ear[2] > 0.45) else 999.0
                    r_ear_dist = math.hypot(ocx - r_ear[0], ocy - r_ear[1]) if (is_phone and r_ear[2] > 0.45) else 999.0

                    if min(l_ear_dist, r_ear_dist) < 0.14:
                        hand_found = True
                        dist_to_hand = min(l_ear_dist, r_ear_dist)
                        detected_hand = "AT_EAR"
                    elif l_dist < grasp_radius and r_dist < grasp_radius:
                        hand_found = True
                        dist_to_hand = min(l_dist, r_dist)
                        detected_hand = "BOTH_HANDS"
                    elif l_dist < grasp_radius:
                        hand_found = True
                        dist_to_hand = l_dist
                        detected_hand = "LEFT_HAND"
                    elif r_dist < grasp_radius:
                        hand_found = True
                        dist_to_hand = r_dist
                        detected_hand = "RIGHT_HAND"

                # Fallback: Check strictly inside person upper torso (NEVER outside the person's bounding box)
                if not hand_found:
                    is_in_torso = (
                        (px + 0.05 * pw <= ocx <= px + 0.95 * pw)
                        and (py + 0.15 * ph <= ocy <= py + 0.85 * ph)
                        and (obj_area <= person_area * 0.12)
                    )
                    if is_in_torso:
                        hand_found = True
                        dist_to_hand = math.hypot(ocx - (px + pw / 2), ocy - (py + ph / 2))
                        detected_hand = "AT_EAR" if (is_phone and ocy < py + 0.35 * ph) else "IN_HAND"
                    elif is_baggage:
                        if (px - 0.05 * pw <= ocx <= px + 1.05 * pw) and (py <= ocy <= py + ph * 0.85):
                            hand_found = True
                            dist_to_hand = 0.06
                            detected_hand = "CARRIED"

                if hand_found and dist_to_hand < best_dist:
                    best_dist = dist_to_hand
                    best_person = person
                    held_hand_label = detected_hand

            # Apply threat escalation and associations
            if best_person is not None:
                obj.is_held = True
                obj.held_by_target_id = best_person.target_id

                item_label = (obj.unusual_item or obj.class_name).upper()
                best_person.is_holding = True
                best_person.held_item = item_label
                best_person.held_by_hand = held_hand_label

                # Scale validation: Reject pens, clips, and small handheld stationery falsely detected as weapons
                is_valid_weapon_scale = True
                if obj.is_weapon and best_person.bbox and obj.bbox:
                    person_area = max(1e-5, best_person.bbox.w * best_person.bbox.h)
                    weapon_area = obj.bbox.w * obj.bbox.h
                    area_ratio = weapon_area / person_area
                    min_ratio = getattr(settings, "MIN_WEAPON_AREA_RATIO", 0.005)
                    if area_ratio < min_ratio:
                        is_valid_weapon_scale = False
                        obj.is_weapon = False
                        obj.is_casual_object = True
                        obj.threat_level = "NORMAL"
                        log.info(
                            "[FILTER] Demoted small object '%s' held by %s (area_ratio=%.4f < %.4f min) to casual item (pen/accessory/watch)",
                            obj.class_name, best_person.target_id, area_ratio, min_ratio,
                        )

                if obj.is_weapon and is_valid_weapon_scale:
                    # If the holder is authorized, mark weapon as authorized too (no hostile alarm)
                    if getattr(best_person, "is_authorized", False) or best_person.threat_level == "AUTHORIZED":
                        best_person.held_item_type = "WEAPON"
                        obj.is_authorized = True
                        obj.threat_level = "AUTHORIZED"
                        log.info(
                            "[CLEARANCE] Authorized sentry %s holding %s — weapon clearance confirmed.",
                            best_person.target_id,
                            obj.class_name.upper(),
                        )
                    else:
                        # 🚨 ARMED HOSTILE THREAT ESCALATION
                        best_person.held_item_type = "WEAPON"
                        best_person.threat_level = "CRITICAL"
                        best_person.pose_label = f"ARMED (HOLDING {obj.class_name.upper()})"
                        obj.threat_level = "CRITICAL"
                        log.warning(
                            "[THREAT ESCALATION] Target %s is ARMED with %s in %s!",
                            best_person.target_id,
                            obj.class_name.upper(),
                            held_hand_label,
                        )
                else:
                    # Casual object in hand (phone, watch, baggage, bottle, pen, tool, etc.)
                    best_person.held_item_type = "CASUAL_OBJECT"
                    obj.threat_level = "NORMAL"  # Attended item
                    if best_person.threat_level != "CRITICAL":
                        best_person.threat_level = "HIGH" if best_person.is_in_fence else "NORMAL"
                    best_person.pose_label = f"HOLDING {item_label}"
            else:
                # Unattended object
                obj.is_held = False
                obj.held_by_target_id = None
                if obj.is_weapon:
                    obj.threat_level = "HIGH"  # Unattended weapon
                elif obj.class_name in BAGGAGE_NAMES:
                    obj.threat_level = "HIGH"  # Unattended baggage alert
                else:
                    obj.threat_level = "NORMAL"

    @staticmethod
    def _compute_iou(
        boxA: Tuple[float, float, float, float],
        boxB: Tuple[float, float, float, float],
    ) -> float:
        xA = max(boxA[0], boxB[0])
        yA = max(boxA[1], boxB[1])
        xB = min(boxA[2], boxB[2])
        yB = min(boxA[3], boxB[3])

        interArea = max(0.0, xB - xA) * max(0.0, yB - yA)
        boxAArea = max(0.0, boxA[2] - boxA[0]) * max(0.0, boxA[3] - boxA[1])
        boxBArea = max(0.0, boxB[2] - boxB[0]) * max(0.0, boxB[3] - boxB[1])

        iou = interArea / float(boxAArea + boxBArea - interArea + 1e-6)
        return iou

    @staticmethod
    def _classify_pose(kps: KeypointSet) -> str:
        pts = kps.points
        if len(pts) < 17:
            return "STANDING"

        nose = pts[0]
        l_hip = pts[11]
        r_hip = pts[12]
        l_knee = pts[13]
        r_knee = pts[14]
        l_ank = pts[15]
        r_ank = pts[16]

        if nose[2] < 0.25:
            return "STANDING"

        has_hips = l_hip[2] > 0.35 and r_hip[2] > 0.35
        has_knees = l_knee[2] > 0.35 and r_knee[2] > 0.35
        has_ankles = l_ank[2] > 0.35 or r_ank[2] > 0.35

        # If lower body (knees/ankles) is occluded (e.g. sitting at desk, webcam close-up)
        if not has_knees or not has_ankles:
            if has_hips:
                hip_width = abs(l_hip[0] - r_hip[0])
                torso_h = abs(nose[1] - ((l_hip[1] + r_hip[1]) / 2.0))
                if hip_width > torso_h * 0.7:
                    return "SITTING"
            return "STANDING"

        # Full body visible: calculate height from nose to ankles
        max_ank_y = max(l_ank[1], r_ank[1])
        body_height = abs(nose[1] - max_ank_y)
        body_width = abs(l_hip[0] - r_hip[0])

        # Prone: body is horizontal (height very small compared to width, full body visible)
        if body_height < 0.18 and body_width > body_height * 1.5:
            return "PRONE"

        # Crouching requires knees and hips to be close vertically, with knees bent significantly
        avg_knee_y = (l_knee[1] + r_knee[1]) / 2.0
        avg_hip_y = (l_hip[1] + r_hip[1]) / 2.0
        if has_knees and has_hips and abs(avg_knee_y - avg_hip_y) < 0.08:
            return "CROUCHING"

        if body_width > body_height * 0.65:
            return "SITTING"

        return "STANDING"

    @staticmethod
    def _check_hands_raised(kps: KeypointSet) -> Tuple[bool, str]:
        pts = kps.points
        if len(pts) < 17:
            return False, "STANDING"

        l_wrist = pts[9]
        r_wrist = pts[10]
        l_shoulder = pts[5]
        r_shoulder = pts[6]
        nose = pts[0]

        l_raised = False
        r_raised = False

        if l_wrist[2] > 0.45:
            if l_shoulder[2] > 0.40 and l_wrist[1] < l_shoulder[1] - 0.04:
                l_raised = True
            elif nose[2] > 0.40 and l_wrist[1] < nose[1] - 0.02:
                l_raised = True

        if r_wrist[2] > 0.45:
            if r_shoulder[2] > 0.40 and r_wrist[1] < r_shoulder[1] - 0.04:
                r_raised = True
            elif nose[2] > 0.40 and r_wrist[1] < nose[1] - 0.02:
                r_raised = True

        if l_raised and r_raised:
            return True, "HANDS_RAISED"
        elif l_raised or r_raised:
            return True, "HAND_RAISED"

        return False, "STANDING"

    @staticmethod
    def _simulate(frame: np.ndarray) -> List[Detection]:
        """
        High-fidelity realistic simulation demonstrating:
          - Target 1: Operator / Patrol personnel (NORMAL threat)
          - Target 2: Subject holding a CASUAL BACKPACK / DEVICE (NORMAL threat)
          - Target 3: Unattended baggage (HIGH threat)
        """
        t = time.time()
        sin_t = math.sin(t * 0.8)
        p1_x = 0.25 + 0.05 * sin_t
        p2_x = 0.65 - 0.05 * sin_t

        # Person 1: Patrol Personnel (Active / Standing)
        p1 = Detection(
            target_id="PERSON-01",
            class_id=_PERSON,
            class_name="person",
            bbox=BoundingBox(x=p1_x, y=0.25, w=0.18, h=0.55, confidence=0.95),
            pose_label="ACTIVE",
            threat_level="NORMAL",
            is_holding=False,
            held_item=None,
            held_item_type=None,
            held_by_hand=None,
            keypoints=KeypointSet(
                points=[
                    (p1_x + 0.09, 0.27, 0.95),  # nose
                    (p1_x + 0.08, 0.26, 0.90), (p1_x + 0.10, 0.26, 0.90),
                    (p1_x + 0.06, 0.28, 0.85), (p1_x + 0.12, 0.28, 0.85),
                    (p1_x + 0.05, 0.35, 0.92), (p1_x + 0.13, 0.35, 0.92), # shoulders
                    (p1_x + 0.04, 0.44, 0.88), (p1_x + 0.15, 0.43, 0.88), # elbows
                    (p1_x + 0.03, 0.52, 0.85), (p1_x + 0.16, 0.52, 0.85), # wrists
                    (p1_x + 0.06, 0.55, 0.92), (p1_x + 0.12, 0.55, 0.92), # hips
                    (p1_x + 0.06, 0.68, 0.90), (p1_x + 0.12, 0.68, 0.90), # knees
                    (p1_x + 0.06, 0.80, 0.88), (p1_x + 0.12, 0.80, 0.88), # ankles
                ]
            ),
        )

        # Person 2: Carrying casual backpack / phone
        p2 = Detection(
            target_id="PERSON-02",
            class_id=_PERSON,
            class_name="person",
            bbox=BoundingBox(x=p2_x, y=0.30, w=0.16, h=0.50, confidence=0.93),
            pose_label="HOLDING BACKPACK",
            threat_level="NORMAL",
            is_holding=True,
            held_item="BACKPACK",
            held_item_type="CASUAL_OBJECT",
            held_by_hand="LEFT_HAND",
            keypoints=KeypointSet(
                points=[
                    (p2_x + 0.08, 0.32, 0.95),
                    (p2_x + 0.07, 0.31, 0.90), (p2_x + 0.09, 0.31, 0.90),
                    (p2_x + 0.05, 0.33, 0.85), (p2_x + 0.11, 0.33, 0.85),
                    (p2_x + 0.04, 0.40, 0.90), (p2_x + 0.12, 0.40, 0.90),
                    (p2_x + 0.03, 0.48, 0.85), (p2_x + 0.13, 0.48, 0.85),
                    (p2_x + 0.02, 0.54, 0.90), (p2_x + 0.14, 0.54, 0.85),
                    (p2_x + 0.05, 0.58, 0.90), (p2_x + 0.11, 0.58, 0.90),
                    (p2_x + 0.05, 0.69, 0.88), (p2_x + 0.11, 0.69, 0.88),
                    (p2_x + 0.05, 0.80, 0.85), (p2_x + 0.11, 0.80, 0.85),
                ]
            ),
        )

        # Casual item held by Person 2
        i2 = Detection(
            target_id="ITEM-01",
            class_id=24,
            class_name="backpack",
            bbox=BoundingBox(x=p2_x - 0.02, y=0.48, w=0.08, h=0.12, confidence=0.89),
            is_casual_object=True,
            threat_level="NORMAL",
            is_held=True,
            held_by_target_id="PERSON-02",
        )

        # Unattended suitcase near perimeter
        i3 = Detection(
            target_id="ITEM-02",
            class_id=28,
            class_name="suitcase",
            bbox=BoundingBox(x=0.48, y=0.68, w=0.09, h=0.11, confidence=0.91),
            is_casual_object=True,
            is_unusual=True,
            unusual_item="SUITCASE",
            threat_level="HIGH",
            is_held=False,
            held_by_target_id=None,
        )

        return [p1, p2, i2, i3]
