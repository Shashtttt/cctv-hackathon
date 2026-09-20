"""
IBVAP — ANPR Engine (Automatic Number Plate Recognition)
Pipeline: YOLOv8 plate detect → perspective warp → EasyOCR text extraction
          → regex normalise → fuzzy Levenshtein watchlist check.
Falls back to simulation when weights/models are unavailable.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

from ..config import settings

log = logging.getLogger("ibvap.ai.anpr")


# Indian plate format patterns (extend as needed for other regions)
_PLATE_PATTERNS = [
    re.compile(r"[A-Z]{2}[-\s]?\d{1,2}[-\s]?[A-Z]{1,2}[-\s]?\d{4}"),   # e.g. JK-02-AX-8912
    re.compile(r"[A-Z]{2}\d{2}[A-Z]{1,3}\d{4}"),                          # compact form
]

_OCR_NOISE_MAP = str.maketrans({
    "0": "O", "1": "I", "8": "B",
    "5": "S", "6": "G", "2": "Z",
})


@dataclass
class PlateResult:
    plate_text: str               # normalised plate string
    raw_text: str                 # raw OCR output
    confidence: float             # OCR confidence 0..1
    bbox_pixel: Tuple[int, int, int, int]   # (x,y,w,h) in original frame
    plate_crop: Optional[np.ndarray] = None


_shared_ocr = None
_ocr_lock = threading.Lock()


class ANPREngine:
    """
    Full ANPR pipeline.
    Automatically degrades gracefully if EasyOCR or YOLO LP model are missing.
    """

    def __init__(self) -> None:
        self._ocr = None
        self._lp_detector = None
        self._simulation = False
        self._load()


    def _load(self) -> None:
        # Load EasyOCR (shared singleton across workers to conserve RAM and avoid duplicate loading)
        global _shared_ocr
        if _shared_ocr is not None:
            self._ocr = _shared_ocr
        else:
            with _ocr_lock:
                if _shared_ocr is not None:
                    self._ocr = _shared_ocr
                else:
                    try:
                        import easyocr                                   # type: ignore
                        log.info("Loading EasyOCR (first run may download models) …")
                        t0 = time.monotonic()
                        _shared_ocr = easyocr.Reader(["en"], gpu=settings.USE_GPU, verbose=False)
                        self._ocr = _shared_ocr
                        log.info("EasyOCR loaded in %.2f s", time.monotonic() - t0)
                    except ImportError:
                        log.warning("easyocr not installed — ANPR in SIMULATION mode.")
                        self._simulation = True
                    except Exception as exc:
                        log.error("EasyOCR load error: %s — SIMULATION mode.", exc)
                        self._simulation = True

        # Load licence-plate specific YOLO (optional; falls back to contour detection)
        lp_path: Path = settings.YOLO_LP_MODEL
        if lp_path.exists():
            try:
                from ultralytics import YOLO               # type: ignore
                self._lp_detector = YOLO(str(lp_path))
                log.info("LP YOLO model loaded from %s", lp_path)
            except Exception as exc:
                log.warning("LP YOLO load failed: %s — using contour fallback.", exc)


    def detect_plates(self, frame: np.ndarray) -> List[PlateResult]:
        """
        Detect and read all licence plates in a BGR frame.
        Returns list of PlateResult objects sorted by confidence desc.
        """
        if self._simulation:
            return self._simulate()

        plate_regions = (
            self._detect_plates_yolo(frame)
            if self._lp_detector
            else self._detect_plates_contour(frame)
        )

        results = []
        for (x, y, w, h) in plate_regions:
            crop = self._safe_crop(frame, x, y, w, h)
            if crop is None:
                continue
            plate = self._read_plate(crop)
            if plate:
                results.append(PlateResult(
                    plate_text=plate["normalised"],
                    raw_text=plate["raw"],
                    confidence=plate["confidence"],
                    bbox_pixel=(x, y, w, h),
                    plate_crop=crop,
                ))

        results.sort(key=lambda r: r.confidence, reverse=True)
        return results

    def detect_in_vehicle_crop(
        self,
        frame: np.ndarray,
        vehicle_bbox_pixel: Tuple[int, int, int, int],
    ) -> List[PlateResult]:
        """
        Run ANPR only inside a vehicle's bounding box.
        ~3× faster than full-frame scan.
        """
        x1, y1, x2, y2 = vehicle_bbox_pixel
        h, w = frame.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        if x2 <= x1 or y2 <= y1:
            return []
        crop = frame[y1:y2, x1:x2]
        plates = self.detect_plates(crop)
        # Offset coords back to full-frame
        for p in plates:
            bx, by, bw, bh = p.bbox_pixel
            p.bbox_pixel = (bx + x1, by + y1, bw, bh)
        return plates

    def fuzzy_check_watchlist(
        self,
        plate_text: str,
        watchlist_plates: List[str],
    ) -> Tuple[Optional[str], int]:
        """
        Return (matched_plate, levenshtein_distance) or (None, -1).
        Handles common OCR digit/letter substitutions (0/O, 1/I, 8/B).
        """
        plate_norm = self._normalise(plate_text)
        best_match = None
        best_dist  = settings.ANPR_FUZZY_DISTANCE + 1

        for wl_plate in watchlist_plates:
            wl_norm = self._normalise(wl_plate)
            dist = self._levenshtein(plate_norm, wl_norm)
            if dist < best_dist:
                best_dist  = dist
                best_match = wl_plate

        if best_dist <= settings.ANPR_FUZZY_DISTANCE:
            return best_match, best_dist
        return None, -1


    def _detect_plates_yolo(
        self, frame: np.ndarray
    ) -> List[Tuple[int, int, int, int]]:
        """Use LP-specific YOLO model to find plate regions."""
        results = self._lp_detector(frame, verbose=False, imgsz=640)
        regions = []
        if not results or results[0].boxes is None:
            return regions
        h, w = frame.shape[:2]
        for box in results[0].boxes.xyxy.cpu().numpy():
            x1, y1, x2, y2 = (int(v) for v in box)
            regions.append((x1, y1, x2 - x1, y2 - y1))
        return regions

    def _detect_plates_contour(
        self, frame: np.ndarray
    ) -> List[Tuple[int, int, int, int]]:
        """
        Classical contour-based plate localisation.
        Works on most rectangular white/yellow plates.
        """
        try:
            import cv2                                       # type: ignore
            gray   = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            blur   = cv2.bilateralFilter(gray, 9, 75, 75)
            edges  = cv2.Canny(blur, 100, 200)
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 1))
            dilated = cv2.dilate(edges, kernel, iterations=2)
            contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            regions = []
            h, w = frame.shape[:2]
            for cnt in sorted(contours, key=cv2.contourArea, reverse=True)[:15]:
                x, y, cw, ch = cv2.boundingRect(cnt)
                aspect = cw / (ch + 1e-5)
                area_ratio = (cw * ch) / (w * h)
                # Plate aspect ratio typically 2:1 to 6:1
                if 1.5 < aspect < 7.0 and 0.002 < area_ratio < 0.15:
                    regions.append((x, y, cw, ch))
                if len(regions) >= 5:
                    break
            return regions
        except Exception as exc:
            log.debug("Contour detection error: %s", exc)
            return []


    def _read_plate(self, crop: np.ndarray) -> Optional[dict]:
        """Run EasyOCR on a plate crop and return normalised text + confidence."""
        if self._ocr is None:
            return None
        try:
            import cv2                                       # type: ignore
            # Pre-process: sharpen + upscale
            scale = max(1, 150 // min(crop.shape[:2]))
            resized = cv2.resize(crop, None, fx=scale, fy=scale,
                                 interpolation=cv2.INTER_CUBIC)
            gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
            _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

            raw_results = self._ocr.readtext(thresh, detail=1, paragraph=False)
            if not raw_results:
                return None

            # Aggregate all text boxes into one plate string
            combined = " ".join(r[1] for r in raw_results)
            conf = float(sum(r[2] for r in raw_results) / len(raw_results))

            normalised = self._normalise(combined)
            if not normalised or len(normalised) < 6:
                return None

            return {"raw": combined, "normalised": normalised, "confidence": conf}

        except Exception as exc:
            log.debug("OCR error: %s", exc)
            return None


    @staticmethod
    def _normalise(text: str) -> str:
        """Strip noise and standardise plate text."""
        # Uppercase, remove non-alphanumeric except hyphens
        text = re.sub(r"[^A-Z0-9\-]", "", text.upper().replace(" ", ""))
        # Insert hyphens at standard Indian plate positions if missing
        # e.g. "JK02AX8912" → "JK-02-AX-8912"
        m = re.match(r"^([A-Z]{2})(\d{1,2})([A-Z]{1,3})(\d{4})$", text)
        if m:
            return f"{m.group(1)}-{m.group(2)}-{m.group(3)}-{m.group(4)}"
        return text

    @staticmethod
    def _levenshtein(s1: str, s2: str) -> int:
        """Standard dynamic-programming Levenshtein distance."""
        if s1 == s2:
            return 0
        if len(s1) < len(s2):
            s1, s2 = s2, s1
        prev = list(range(len(s2) + 1))
        for i, c1 in enumerate(s1):
            curr = [i + 1]
            for j, c2 in enumerate(s2):
                curr.append(min(prev[j + 1] + 1, curr[j] + 1,
                                prev[j] + (0 if c1 == c2 else 1)))
            prev = curr
        return prev[-1]

    @staticmethod
    def _safe_crop(
        frame: np.ndarray, x: int, y: int, w: int, h: int
    ) -> Optional[np.ndarray]:
        fh, fw = frame.shape[:2]
        x, y = max(0, x), max(0, y)
        x2, y2 = min(fw, x + w), min(fh, y + h)
        if x2 <= x or y2 <= y:
            return None
        return frame[y:y2, x:x2]


    @staticmethod
    def _simulate() -> List[PlateResult]:
        import random
        plates = [
            "JK-02-AX-8912", "PB-10-CZ-4401", "HR-26-BQ-7719",
            "DL-01-ET-3022", "MH-12-AB-1234",
        ]
        if random.random() < 0.5:
            return []
        plate = random.choice(plates)
        return [PlateResult(
            plate_text=plate,
            raw_text=plate,
            confidence=random.uniform(0.88, 0.99),
            bbox_pixel=(300, 350, 200, 60),
        )]
