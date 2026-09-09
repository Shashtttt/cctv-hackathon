"""
IBVAP — Night Frame Enhancement Engine
CLAHE, Gamma correction, Bilateral denoising, Thermal pseudo-color,
and Green Phosphor Night-Vision effects using pure OpenCV.
"""

from __future__ import annotations

import logging
from enum import Enum
from typing import Optional

import numpy as np

log = logging.getLogger("ibvap.ai.night_enhancer")


class NightMode(str, Enum):
    STANDARD       = "STANDARD"        # No enhancement
    CLAHE          = "CLAHE"           # Contrast-limited adaptive histogram equalisation
    GAMMA          = "GAMMA"           # Gamma correction (brighten dark scenes)
    BILATERAL      = "BILATERAL"       # Bilateral denoising (smooth + edge-preserve)
    THERMAL        = "THERMAL"         # Pseudo-thermal IR (JET colormap)
    NIGHT_GREEN    = "NIGHT_GREEN"     # Green phosphor night-vision
    LOW_LIGHT      = "LOW_LIGHT"       # Combined pipeline for very dark scenes


class NightEnhancer:
    """
    Stateless image enhancement filter bank.
    All methods accept and return BGR numpy arrays.
    Thread-safe (no mutable state).
    """

    def __init__(self) -> None:
        self._clahe = None
        self._cv2_available = False
        self._init_cv2()

    def _init_cv2(self) -> None:
        try:
            import cv2                                       # type: ignore
            self._clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
            self._cv2_available = True
        except ImportError:
            log.warning("OpenCV not available — NightEnhancer will pass frames through unchanged.")

    # ── Public entry point ────────────────────────────────────────────────────

    def enhance(self, frame: np.ndarray, mode: str) -> np.ndarray:
        """
        Apply the requested enhancement mode.
        Returns the enhanced frame (may be the same array for STANDARD).
        """
        if not self._cv2_available or frame is None or frame.size == 0:
            return frame

        m = NightMode(mode) if mode in NightMode._value2member_map_ else NightMode.STANDARD

        if m == NightMode.STANDARD:
            return frame
        elif m == NightMode.CLAHE:
            return self._apply_clahe(frame)
        elif m == NightMode.GAMMA:
            return self._apply_gamma(frame, gamma=0.45)
        elif m == NightMode.BILATERAL:
            return self._apply_bilateral(frame)
        elif m == NightMode.THERMAL:
            return self._apply_thermal(frame)
        elif m == NightMode.NIGHT_GREEN:
            return self._apply_night_green(frame)
        elif m == NightMode.LOW_LIGHT:
            return self._apply_low_light(frame)
        return frame

    # ── Enhancement implementations ───────────────────────────────────────────

    def _apply_clahe(self, frame: np.ndarray) -> np.ndarray:
        """
        Contrast-Limited Adaptive Histogram Equalisation on the L channel of LAB.
        Best for improving visibility in uniformly dark scenes.
        """
        import cv2
        lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        l_eq = self._clahe.apply(l)
        merged = cv2.merge([l_eq, a, b])
        return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)

    @staticmethod
    def _apply_gamma(frame: np.ndarray, gamma: float = 0.45) -> np.ndarray:
        """
        Power-law gamma correction. gamma < 1 brightens; gamma > 1 darkens.
        Uses LUT for O(1) per-pixel application.
        """
        inv_gamma = 1.0 / gamma
        table = np.array(
            [(i / 255.0) ** inv_gamma * 255 for i in range(256)],
            dtype=np.uint8,
        )
        import cv2
        return cv2.LUT(frame, table)

    @staticmethod
    def _apply_bilateral(frame: np.ndarray) -> np.ndarray:
        """
        Bilateral filter: smooths noise while preserving edges.
        Good for reducing sensor noise in low-light CCTV streams.
        """
        import cv2
        return cv2.bilateralFilter(frame, d=9, sigmaColor=75, sigmaSpace=75)

    @staticmethod
    def _apply_thermal(frame: np.ndarray) -> np.ndarray:
        """
        Convert to grayscale then apply JET colormap to simulate thermal IR camera output.
        """
        import cv2
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        equalized = cv2.equalizeHist(gray)
        return cv2.applyColorMap(equalized, cv2.COLORMAP_JET)

    @staticmethod
    def _apply_night_green(frame: np.ndarray) -> np.ndarray:
        """
        Green phosphor night-vision effect:
        Convert to grayscale, amplify, tint green.
        """
        import cv2
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        # Boost brightness
        amplified = cv2.convertScaleAbs(gray, alpha=1.8, beta=30)
        # Apply CLAHE for local contrast
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(amplified)
        # Stack as green channel only
        zeros = np.zeros_like(enhanced)
        night_green = cv2.merge([zeros, enhanced, zeros])   # BGR: B=0, G=enhanced, R=0
        return night_green

    def _apply_low_light(self, frame: np.ndarray) -> np.ndarray:
        """
        Multi-stage pipeline for very dark scenes:
        1. Bilateral denoise
        2. CLAHE
        3. Gamma 0.5
        """
        denoised = self._apply_bilateral(frame)
        clahe    = self._apply_clahe(denoised)
        return self._apply_gamma(clahe, gamma=0.5)

    # ── Frame quality assessor ────────────────────────────────────────────────

    @staticmethod
    def mean_brightness(frame: np.ndarray) -> float:
        """Return mean brightness (0–255) as proxy for lighting conditions."""
        import cv2
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        return float(gray.mean())

    def auto_select_mode(self, frame: np.ndarray) -> NightMode:
        """
        Automatically choose an enhancement mode based on scene brightness.
        Suitable for cameras without explicit mode settings.
        """
        brightness = self.mean_brightness(frame)
        if brightness < 30:
            return NightMode.LOW_LIGHT
        if brightness < 80:
            return NightMode.CLAHE
        return NightMode.STANDARD
