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
    76: "scissors",
    34: "baseball bat",
    42: "fork",
}
WEAPON_NAMES: Set[str] = {
    "pistol", "gun", "firearm", "rifle", "shotgun", "handgun",
    "knife", "blade", "dagger", "sword", "machete", "scissors",
    "baseball bat", "weapon",
}

# Casual & everyday objects
CASUAL_OBJECT_CLASSES: Dict[int, str] = {
    24: "backpack",
    25: "umbrella",
    26: "handbag",
    28: "suitcase",
    32: "sports ball",
    36: "skateboard",
    38: "tennis racket",
    39: "bottle",
    40: "wine glass",
    41: "cup",
    44: "spoon",
    45: "bowl",
    63: "laptop",
    64: "mouse",
    65: "remote",
    66: "keyboard",
    67: "cell phone",
    73: "book",
    77: "teddy bear",
}

BAGGAGE_NAMES: Set[str] = {"backpack", "handbag", "suitcase"}

ALL_OBJECT_CLASSES = {**WEAPON_CLASSES, **CASUAL_OBJECT_CLASSES}


class YOLODetector:
    """
    High-performance multi-network vision detector with hardware acceleration.
    Integrates Pose, Weapon, and Casual Object models with hand-held threat escalation.
    """

    def __init__(self) -> None:
        self._pose_model = None
        self._obj_model = None
        self._weapon_model = None
        self._simulation = False
        self._device = OPTIMAL_DEVICE
        self._load_models()

    def _load_models(self) -> None:
        pose_path: Path = settings.YOLO_POSE_MODEL
        obj_path: Path = settings.YOLO_OBJECT_MODEL
        weapon_path: Path = getattr(settings, "YOLO_WEAPON_MODEL", MODELS_DIR / "weapon_yolov8n.pt")

        try:
            from ultralytics import YOLO  # type: ignore

            # 1. Pose Model
            if pose_path.exists():
                log.info("Loading YOLOv8-pose model from %s on %s...", pose_path, self._device)
                self._pose_model = YOLO(str(pose_path))
                self._pose_model.to(self._device)

            # 2. General Object Model (80 COCO classes)
            if obj_path.exists():
                log.info("Loading YOLOv8 object model from %s on %s...", obj_path, self._device)
                self._obj_model = YOLO(str(obj_path))
                self._obj_model.to(self._device)

            # 3. Dedicated Weapon Model (Pistol, Knife)
            if weapon_path.exists():
                log.info("Loading YOLOv8 dedicated weapon model from %s on %s...", weapon_path, self._device)
                self._weapon_model = YOLO(str(weapon_path))
                self._weapon_model.to(self._device)

            if self._pose_model is None and self._obj_model is None and self._weapon_model is None:
                log.warning("No YOLO models found on disk — running in SIMULATION mode.")
                self._simulation = True
            else:
                self._simulation = False
                log.info(
                    "IBVAP Vision Neural Engines online: Pose=%s, Object=%s, Weapon=%s [%s]",
                    self._pose_model is not None,
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

        # ── 1. YOLOv8 Pose Inference (Human Skeletons) ────────────────────────
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

        # ── 2. Dedicated Weapon Detection (Pistols, Knives) ───────────────────
        detected_weapon_boxes: List[Tuple[float, float, float, float]] = []
        if self._weapon_model is not None:
            try:
                # Sensitive threshold for high-recall weapon detection
                results_w = self._weapon_model(
                    frame,
                    verbose=False,
                    conf=0.22,
                    imgsz=640,
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
                        detected_weapon_boxes.append((float(x1), float(y1), float(x2), float(y2)))

                        weapon_count += 1
                        det = Detection(
                            target_id=f"WEAPON-{weapon_count:02d}",
                            class_id=100 + cls_id,
                            class_name=name,
                            bbox=BoundingBox(
                                x=float(x1),
                                y=float(y1),
                                w=float(x2 - x1),
                                h=float(y2 - y1),
                                confidence=float(conf),
                            ),
                            is_weapon=True,
                            is_unusual=True,
                            unusual_item=name.upper(),
                            threat_level="HIGH",  # Will escalate to CRITICAL if held by a person
                        )
                        objects.append(det)
            except Exception as exc:
                log.error("Weapon model inference error: %s", exc)

        # ── 3. General Object Detection (Casual items, Phones, Baggage, Tools, Vehicles)
        if self._obj_model is not None:
            try:
                # Highly sensitive threshold (0.18) for rapid recall of cell phones, bottles, electronics
                results_obj = self._obj_model(
                    frame,
                    verbose=False,
                    conf=0.18,
                    imgsz=640,
                    device=self._device,
                )
                if results_obj and results_obj[0].boxes is not None:
                    res_obj = results_obj[0]
                    boxes = res_obj.boxes.xyxyn.cpu().numpy()
                    confs = res_obj.boxes.conf.cpu().numpy()
                    classes = res_obj.boxes.cls.cpu().numpy().astype(int)

                    for box, conf, cls_id in zip(boxes, confs, classes):
                        # Skip person if pose model already captured them
                        if cls_id == _PERSON and self._pose_model is not None:
                            continue

                        x1, y1, x2, y2 = box

                        # Check if duplicate of weapon already detected
                        if cls_id in WEAPON_CLASSES:
                            is_dup = False
                            for wx1, wy1, wx2, wy2 in detected_weapon_boxes:
                                iou = self._compute_iou((x1, y1, x2, y2), (wx1, wy1, wx2, wy2))
                                if iou > 0.4:
                                    is_dup = True
                                    break
                            if is_dup:
                                continue

                        # Vehicle detection
                        if cls_id in VEHICLE_CLASSES:
                            vehicle_count += 1
                            v_name = res_obj.names.get(cls_id, "vehicle")
                            det = Detection(
                                target_id=f"VEH-{vehicle_count:02d}",
                                class_id=cls_id,
                                class_name=v_name,
                                bbox=BoundingBox(
                                    x=float(x1),
                                    y=float(y1),
                                    w=float(x2 - x1),
                                    h=float(y2 - y1),
                                    confidence=float(conf),
                                ),
                                threat_level="NORMAL",
                            )
                            vehicles.append(det)
                            continue

                        # Determine if weapon or casual object (cell phone, bottle, book, etc.)
                        item_name = res_obj.names.get(cls_id, "object").lower()
                        is_weapon_item = (
                            cls_id in WEAPON_CLASSES
                            or item_name in WEAPON_NAMES
                            or any(w in item_name for w in ("knife", "gun", "pistol", "rifle", "dagger", "sword", "weapon", "firearm"))
                        )
                        # All other COCO objects (cell phone, laptop, bottle, cup, etc.) are valid casual objects
                        is_casual_item = not is_weapon_item and cls_id != _PERSON and cls_id not in VEHICLE_CLASSES

                        if is_weapon_item or is_casual_item:
                            object_count += 1

                            if is_weapon_item:
                                weapon_count += 1
                                det = Detection(
                                    target_id=f"WEAPON-{weapon_count:02d}",
                                    class_id=cls_id,
                                    class_name=item_name,
                                    bbox=BoundingBox(
                                        x=float(x1),
                                        y=float(y1),
                                        w=float(x2 - x1),
                                        h=float(y2 - y1),
                                        confidence=float(conf),
                                    ),
                                    is_weapon=True,
                                    is_unusual=True,
                                    unusual_item=item_name.upper(),
                                    threat_level="HIGH",
                                )
                            else:
                                is_baggage = item_name in BAGGAGE_NAMES
                                is_phone = "phone" in item_name or "cell" in item_name
                                is_monitored = is_baggage or is_phone or item_name in ("bottle", "laptop", "scissors", "remote")
                                det = Detection(
                                    target_id=f"ITEM-{object_count:02d}",
                                    class_id=cls_id,
                                    class_name=item_name,
                                    bbox=BoundingBox(
                                        x=float(x1),
                                        y=float(y1),
                                        w=float(x2 - x1),
                                        h=float(y2 - y1),
                                        confidence=float(conf),
                                    ),
                                    is_casual_object=True,
                                    is_unusual=is_monitored,
                                    unusual_item=item_name.upper(),
                                    threat_level="HIGH" if is_baggage else "NORMAL",
                                )
                            objects.append(det)
            except Exception as exc:
                log.error("Object model inference error: %s", exc)

        # ── 4. Hand-Held Object Spatial Association & Threat Escalation ───────
        self._associate_hands_and_objects(persons, objects)

        return persons + objects + vehicles

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

            ox1, oy1 = obj.bbox.x, obj.bbox.y
            ow, oh = obj.bbox.w, obj.bbox.h
            ocx, ocy = obj.bbox.cx, obj.bbox.cy
            is_phone = "phone" in obj.class_name.lower() or "cell" in obj.class_name.lower()

            best_person: Optional[Detection] = None
            best_dist = 999.0
            held_hand_label = "IN_HAND"

            for person in persons:
                if not person.bbox:
                    continue

                px, py, pw, ph = person.bbox.x, person.bbox.y, person.bbox.w, person.bbox.h

                # Spatial reject if person is far away from object
                if (
                    ocx < px - 0.25
                    or ocx > px + pw + 0.25
                    or ocy < py - 0.15
                    or ocy > py + ph + 0.25
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

                    # Dynamic grasp radius based on person scale
                    grasp_radius = max(0.14, min(0.30, ph * 0.45))

                    l_dist = math.hypot(ocx - l_wrist[0], ocy - l_wrist[1]) if l_wrist[2] > 0.20 else 999.0
                    r_dist = math.hypot(ocx - r_wrist[0], ocy - r_wrist[1]) if r_wrist[2] > 0.20 else 999.0

                    # Check ear proximity for phone usage
                    l_ear_dist = math.hypot(ocx - l_ear[0], ocy - l_ear[1]) if (is_phone and l_ear[2] > 0.20) else 999.0
                    r_ear_dist = math.hypot(ocx - r_ear[0], ocy - r_ear[1]) if (is_phone and r_ear[2] > 0.20) else 999.0

                    if min(l_ear_dist, r_ear_dist) < 0.18:
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

                # Fallback: Check if object is inside person torso / carrying envelope
                if not hand_found:
                    is_in_envelope = (
                        (px - 0.15 <= ocx <= px + pw + 0.15)
                        and (py - 0.05 <= ocy <= py + ph + 0.10)
                        and (ow * oh < pw * ph * 0.75)
                    )
                    if is_in_envelope:
                        hand_found = True
                        dist_to_hand = math.hypot(ocx - (px + pw / 2), ocy - (py + ph / 2))
                        detected_hand = "AT_EAR" if (is_phone and ocy < py + 0.30 * ph) else "IN_HAND"

                if hand_found and dist_to_hand < best_dist:
                    best_dist = dist_to_hand
                    best_person = person
                    held_hand_label = detected_hand

            # Apply threat escalation and associations
            if best_person is not None:
                obj.is_held = True
                obj.held_by_target_id = best_person.target_id

                best_person.is_holding = True
                best_person.held_item = obj.class_name.upper()
                best_person.held_by_hand = held_hand_label

                if obj.is_weapon:
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
                    # Casual object in hand (phone, baggage, bottle, etc.)
                    best_person.held_item_type = "CASUAL_OBJECT"
                    obj.threat_level = "NORMAL"  # Attended item
                    if best_person.threat_level != "CRITICAL":
                        best_person.threat_level = "HIGH" if best_person.is_in_fence else "NORMAL"
                    best_person.pose_label = f"HOLDING {obj.class_name.upper()}"
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

        if l_wrist[2] > 0.25:
            if l_shoulder[2] > 0.25 and l_wrist[1] < l_shoulder[1] - 0.02:
                l_raised = True
            elif nose[2] > 0.25 and l_wrist[1] < nose[1] + 0.06:
                l_raised = True

        if r_wrist[2] > 0.25:
            if r_shoulder[2] > 0.25 and r_wrist[1] < r_shoulder[1] - 0.02:
                r_raised = True
            elif nose[2] > 0.25 and r_wrist[1] < nose[1] + 0.06:
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
          - Target 1: Armed subject holding a PISTOL (CRITICAL threat)
          - Target 2: Subject holding a CASUAL BACKPACK / DEVICE (NORMAL/HIGH threat)
          - Target 3: Unattended baggage (HIGH threat)
        """
        t = time.time()
        sin_t = math.sin(t * 0.8)
        p1_x = 0.25 + 0.05 * sin_t
        p2_x = 0.65 - 0.05 * sin_t

        # Person 1: Armed with Pistol
        p1 = Detection(
            target_id="PERSON-01",
            class_id=_PERSON,
            class_name="person",
            bbox=BoundingBox(x=p1_x, y=0.25, w=0.18, h=0.55, confidence=0.96),
            pose_label="ARMED (HOLDING PISTOL)",
            threat_level="CRITICAL",
            is_holding=True,
            held_item="PISTOL",
            held_item_type="WEAPON",
            held_by_hand="RIGHT_HAND",
            keypoints=KeypointSet(
                points=[
                    (p1_x + 0.09, 0.27, 0.95),  # nose
                    (p1_x + 0.08, 0.26, 0.90), (p1_x + 0.10, 0.26, 0.90),
                    (p1_x + 0.06, 0.28, 0.85), (p1_x + 0.12, 0.28, 0.85),
                    (p1_x + 0.05, 0.35, 0.92), (p1_x + 0.13, 0.35, 0.92), # shoulders
                    (p1_x + 0.04, 0.44, 0.88), (p1_x + 0.15, 0.43, 0.88), # elbows
                    (p1_x + 0.03, 0.52, 0.85), (p1_x + 0.18, 0.47, 0.92), # wrists (right hand holding)
                    (p1_x + 0.06, 0.55, 0.92), (p1_x + 0.12, 0.55, 0.92), # hips
                    (p1_x + 0.06, 0.68, 0.90), (p1_x + 0.12, 0.68, 0.90), # knees
                    (p1_x + 0.06, 0.80, 0.88), (p1_x + 0.12, 0.80, 0.88), # ankles
                ]
            ),
        )

        # Weapon held by Person 1
        w1 = Detection(
            target_id="WEAPON-01",
            class_id=100,
            class_name="pistol",
            bbox=BoundingBox(x=p1_x + 0.17, y=0.45, w=0.06, h=0.07, confidence=0.94),
            is_weapon=True,
            is_unusual=True,
            unusual_item="PISTOL",
            threat_level="CRITICAL",
            is_held=True,
            held_by_target_id="PERSON-01",
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

        return [p1, w1, p2, i2, i3]
