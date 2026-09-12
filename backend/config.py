"""
IBVAP — Intelligent Border Video Analytics Platform
Application Settings (Pydantic v2 SettingsConfigDict)
"""

from __future__ import annotations
import sys
from pathlib import Path
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Project root is two levels above this file: backend/ -> project/
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
MODELS_DIR = PROJECT_ROOT / "models"
SNAPSHOTS_DIR = PROJECT_ROOT / "snapshots"
DB_PATH = PROJECT_ROOT / "ibvap_surveillance.db"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Platform ─────────────────────────────────────────────────────────────
    PROJECT_NAME: str = "IBVAP - Intelligent Border Video Analytics Platform"
    API_V1_STR: str = "/api/v1"
    ENV: str = "development"                     # development | production
    ENABLE_CAMERA_WORKERS: bool = False          # False = Lightweight local mode (frees CPU & SQLite for instant AI inference)
    REQUIRE_API_KEY: bool = False

    # ── Security ─────────────────────────────────────────────────────────────
    API_SECRET_KEY: str = "CHANGE_ME_IN_PRODUCTION_USE_STRONG_RANDOM_KEY"
    ALLOWED_ORIGINS: list[str] | str = ["*"]

    # ── Database ──────────────────────────────────────────────────────────────
    DATABASE_URL: str = f"sqlite+aiosqlite:///{DB_PATH}"

    # ── AI Model Paths ────────────────────────────────────────────────────────
    YOLO_POSE_MODEL: Path = MODELS_DIR / "yolov8n-pose.pt"
    YOLO_OBJECT_MODEL: Path = MODELS_DIR / "yolov8n.pt"
    YOLO_WEAPON_MODEL: Path = MODELS_DIR / "weapon_yolov8n.pt"
    YOLO_LP_MODEL: Path = MODELS_DIR / "yolov8n-lp.pt"         # License plate detector
    YUNET_FACE_MODEL: Path = MODELS_DIR / "face_detection_yunet_2023mar.onnx"
    SFACE_FACE_MODEL: Path = MODELS_DIR / "face_recognition_sface_2021dec.onnx"

    # ── AI Thresholds ─────────────────────────────────────────────────────────
    YOLO_CONFIDENCE_THRESHOLD: float = 0.25
    FRS_SIMILARITY_THRESHOLD: float = 0.40        # SFace cosine similarity
    ANPR_OCR_CONFIDENCE: float = 0.60
    ANPR_FUZZY_DISTANCE: int = 2                  # Levenshtein edit distance tolerance

    # ── Surveillance Behaviour ────────────────────────────────────────────────
    LOITERING_TIMEOUT_SECONDS: float = 10.0
    ALERT_THROTTLE_SECONDS: float = 3.0           # Minimum gap between same-type alerts per camera
    MAX_CAMERAS: int = 64
    FRAME_QUEUE_MAX_SIZE: int = 4                 # Ring-buffer depth per camera worker
    RESULT_QUEUE_MAX_SIZE: int = 200

    # ── Storage ───────────────────────────────────────────────────────────────
    SNAPSHOT_DIR: Path = SNAPSHOTS_DIR
    SNAPSHOT_JPEG_QUALITY: int = 75
    MAX_SNAPSHOT_RETENTION_DAYS: int = 30

    # ── Pipeline ─────────────────────────────────────────────────────────────
    USE_GPU: bool = True                           # Set True for hardware acceleration (MPS/CUDA)
    GPU_DEVICE: str = "mps"                        # 'mps' (Apple Silicon) | 'cuda' (Nvidia) | 'cpu'
    FRAME_SKIP_RATIO: int = 1                      # Process every N-th frame (1 = all)

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_allowed_origins(cls, v: object) -> list[str]:
        if isinstance(v, str):
            if v.startswith("[") and v.endswith("]"):
                import json
                try:
                    return json.loads(v)
                except Exception:
                    pass
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @field_validator("SNAPSHOT_DIR", "YOLO_POSE_MODEL", "YOLO_OBJECT_MODEL",
                     "YOLO_WEAPON_MODEL", "YUNET_FACE_MODEL", "SFACE_FACE_MODEL", mode="before")
    @classmethod
    def coerce_path(cls, v: object) -> Path:
        return Path(v)

    def ensure_dirs(self) -> None:
        """Create required directories if they do not exist."""
        self.SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
        (self.SNAPSHOT_DIR / "vehicle_captured").mkdir(parents=True, exist_ok=True)
        (self.SNAPSHOT_DIR / "weapon_captured").mkdir(parents=True, exist_ok=True)
        (self.SNAPSHOT_DIR / "person_captured").mkdir(parents=True, exist_ok=True)
        MODELS_DIR.mkdir(parents=True, exist_ok=True)

    def warn_missing_models(self) -> None:
        """Print warnings for missing model files (non-fatal; falls back to simulation mode)."""
        for attr, path in [
            ("YOLO_POSE_MODEL", self.YOLO_POSE_MODEL),
            ("YOLO_OBJECT_MODEL", self.YOLO_OBJECT_MODEL),
            ("YOLO_WEAPON_MODEL", self.YOLO_WEAPON_MODEL),
            ("YUNET_FACE_MODEL", self.YUNET_FACE_MODEL),
            ("SFACE_FACE_MODEL", self.SFACE_FACE_MODEL),
        ]:
            if not path.exists():
                print(
                    f"[IBVAP][WARN] Model file not found: {path}  "
                    f"({attr}). AI module will run in SIMULATION mode.",
                    file=sys.stderr,
                )


settings = Settings()
