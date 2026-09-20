"""
IBVAP — YuNet Face Detector (OpenCV ONNX)
Detects faces in BGR frames, returns crop regions + 5-point landmarks.
Falls back to Haar-cascade when ONNX model is absent, or pure simulation.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

from ..config import settings

log = logging.getLogger("ibvap.ai.face_detector")


@dataclass
class FaceDetection:
    bbox: Tuple[int, int, int, int]          # (x, y, w, h) in PIXELS
    landmarks: List[Tuple[int, int]]         # 5 keypoints: (x, y) pixel coords
    confidence: float
    face_crop: Optional[np.ndarray] = None   # BGR crop, aligned, ready for SFace


class FaceDetector:
    """
    YuNet-based face detector.
    Automatically falls back to Haar-cascade → simulation if ONNX not available.
    """

    _YUNET_INPUT_SIZE = (320, 320)

    def __init__(self) -> None:
        self._detector = None
        self._haar     = None
        self._mode     = "simulation"
        self._load()


    def _load(self) -> None:
        onnx_path: Path = settings.YUNET_FACE_MODEL
        if onnx_path.exists():
            try:
                import cv2                                   # type: ignore
                self._detector = cv2.FaceDetectorYN.create(
                    str(onnx_path),
                    "",
                    self._YUNET_INPUT_SIZE,
                    score_threshold=0.45,
                    nms_threshold=0.3,
                    top_k=5000,
                )
                self._mode = "yunet"
                log.info("YuNet face detector loaded from %s", onnx_path)
                return
            except Exception as exc:
                log.warning("YuNet load failed: %s", exc)

        # Fallback: OpenCV Haar cascade
        try:
            import cv2                                       # type: ignore
            if hasattr(cv2, "data") and hasattr(cv2, "CascadeClassifier"):
                haar_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
                self._haar = cv2.CascadeClassifier(haar_path)
                self._mode = "haar"
                log.info("YuNet unavailable — using Haar-cascade fallback.")
            else:
                self._mode = "simulation"
        except Exception as exc:
            log.warning("Haar cascade init failed: %s — face detector in SIMULATION mode.", exc)
            self._mode = "simulation"


    def detect(self, frame: np.ndarray) -> List[FaceDetection]:
        """Detect all faces in a BGR frame. Returns list of FaceDetection."""
        if self._mode == "yunet":
            return self._detect_yunet(frame)
        if self._mode == "haar":
            return self._detect_haar(frame)
        return self._simulate(frame)

    def detect_in_crop(
        self,
        full_frame: np.ndarray,
        bbox_pixel: Tuple[int, int, int, int],
    ) -> List[FaceDetection]:
        """
        Detect faces only within a bounding-box region of the full frame.
        Reduces computation vs. running on full high-res frame.
        """
        x1, y1, x2, y2 = bbox_pixel
        h, w = full_frame.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        if x2 <= x1 or y2 <= y1:
            return []
        crop = full_frame[y1:y2, x1:x2]
        faces = self.detect(crop)
        # Offset bbox back to full-frame coordinates
        for f in faces:
            bx, by, bw, bh = f.bbox
            f.bbox = (bx + x1, by + y1, bw, bh)
            f.landmarks = [(lx + x1, ly + y1) for lx, ly in f.landmarks]
        return faces


    def _detect_yunet(self, frame: np.ndarray) -> List[FaceDetection]:
        import cv2                                           # type: ignore
        h, w = frame.shape[:2]
        self._detector.setInputSize((w, h))
        _, faces = self._detector.detect(frame)
        if faces is None:
            return []

        results = []
        for face in faces:
            x, y, fw, fh = (int(v) for v in face[:4])
            conf = float(face[-1])
            lms  = [(int(face[4 + i * 2]), int(face[5 + i * 2])) for i in range(5)]
            crop = self._align_crop(frame, face, target_size=(112, 112))
            results.append(FaceDetection(bbox=(x, y, fw, fh), landmarks=lms,
                                          confidence=conf, face_crop=crop))
        return results

    def _detect_haar(self, frame: np.ndarray) -> List[FaceDetection]:
        import cv2                                           # type: ignore
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        raw = self._haar.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(30, 30))
        results = []
        if len(raw) == 0:
            return results
        for (x, y, fw, fh) in raw:
            crop = frame[y:y + fh, x:x + fw]
            import cv2 as _cv2
            crop_resized = _cv2.resize(crop, (112, 112)) if crop.size > 0 else None
            cx, cy = x + fw // 2, y + fh // 2
            results.append(FaceDetection(
                bbox=(x, y, fw, fh),
                landmarks=[(cx, cy)] * 5,
                confidence=0.75,
                face_crop=crop_resized,
            ))
        return results

    @staticmethod
    def _align_crop(
        frame: np.ndarray,
        face_row: np.ndarray,
        target_size: Tuple[int, int] = (112, 112),
    ) -> Optional[np.ndarray]:
        """
        Align face crop using the 5-landmark similarity transform (as required by SFace).
        Returns a (112, 112) BGR image.
        """
        try:
            import cv2                                       # type: ignore
            # SFace reference landmarks (112×112)
            ref_pts = np.float32([
                [38.29459953, 51.69630051],
                [73.53179932, 51.50139999],
                [56.02519989, 71.73660278],
                [41.54930115, 92.36550140],
                [70.72990036, 92.20410156],
            ])
            src_pts = np.float32([
                [face_row[4], face_row[5]],
                [face_row[6], face_row[7]],
                [face_row[8], face_row[9]],
                [face_row[10], face_row[11]],
                [face_row[12], face_row[13]],
            ])
            M = cv2.estimateAffinePartial2D(src_pts, ref_pts, method=cv2.LMEDS)[0]
            if M is None:
                x, y, fw, fh = (int(v) for v in face_row[:4])
                crop = frame[y:y + fh, x:x + fw]
                return cv2.resize(crop, target_size) if crop.size > 0 else None
            aligned = cv2.warpAffine(frame, M, target_size)
            return aligned
        except Exception:
            return None

    @staticmethod
    def _simulate(frame: np.ndarray) -> List[FaceDetection]:
        import random
        if random.random() < 0.4:
            return []
        h, w = frame.shape[:2] if frame is not None else (720, 1280)
        x = random.randint(w // 4, 3 * w // 4)
        y = random.randint(h // 4, h // 2)
        s = random.randint(40, 80)
        return [FaceDetection(
            bbox=(x, y, s, s),
            landmarks=[(x + s // 4, y + s // 3)] * 5,
            confidence=random.uniform(0.70, 0.95),
        )]
