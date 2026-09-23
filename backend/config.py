from __future__ import annotations

import sys
from pathlib import Path
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

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

    PROJECT_NAME: str = "IBVAP - Intelligent Border Video Analytics Platform"
    API_V1_STR: str = "/api/v1"
    ENV: str = "development"
    ENABLE_CAMERA_WORKERS: bool = False
    REQUIRE_API_KEY: bool = False

    API_SECRET_KEY: str = "CHANGE_ME_IN_PRODUCTION_USE_STRONG_RANDOM_KEY"
    ALLOWED_ORIGINS: list[str] | str = ["*"]

    DATABASE_URL: str = f"sqlite+aiosqlite:///{DB_PATH}"
    DATABASE_PATH: Path = DB_PATH

    YOLO_POSE_MODEL: Path = MODELS_DIR / "yolov8n-pose.pt"
    YOLO_OBJECT_MODEL: Path = MODELS_DIR / "yolov8n.pt"
    YOLO_WEAPON_MODEL: Path = MODELS_DIR / "weapon_yolov8n.pt"
    YOLO_WORLD_MODEL: Path = (MODELS_DIR / "yolov8s-worldv2-configured.pt") if (MODELS_DIR / "yolov8s-worldv2-configured.pt").exists() else (MODELS_DIR / "yolov8s-worldv2.pt")
    YOLO_LP_MODEL: Path = MODELS_DIR / "yolov8n-lp.pt"
    YUNET_FACE_MODEL: Path = MODELS_DIR / "face_detection_yunet_2023mar.onnx"
    SFACE_FACE_MODEL: Path = MODELS_DIR / "face_recognition_sface_2021dec.onnx"

    USE_YOLO_WORLD: bool = True
    YOLO_CONFIDENCE_THRESHOLD: float = 0.40
    YOLO_WORLD_CONFIDENCE_THRESHOLD: float = 0.20
    YOLO_WEAPON_CONFIDENCE_THRESHOLD: float = 0.75
    YOLO_WEAPON_UNCERTAIN_FLOOR: float = 0.55
    YOLO_OBJECT_CONFIDENCE_THRESHOLD: float = 0.25
    MIN_WEAPON_AREA_RATIO: float = 0.010
    FRS_SIMILARITY_THRESHOLD: float = 0.42
    ANPR_OCR_CONFIDENCE: float = 0.60
    ANPR_FUZZY_DISTANCE: int = 2

    LOITERING_TIMEOUT_SECONDS: float = 10.0
    ALERT_THROTTLE_SECONDS: float = 3.0
    MAX_CAMERAS: int = 64
    FRAME_QUEUE_MAX_SIZE: int = 4
    RESULT_QUEUE_MAX_SIZE: int = 200

    SNAPSHOT_DIR: Path = SNAPSHOTS_DIR
    SNAPSHOT_JPEG_QUALITY: int = 75
    MAX_SNAPSHOT_RETENTION_DAYS: int = 30

    USE_GPU: bool = True
    GPU_DEVICE: str = "mps"
    FRAME_SKIP_RATIO: int = 1

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
        self.SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
        (self.SNAPSHOT_DIR / "vehicle_captured").mkdir(parents=True, exist_ok=True)
        (self.SNAPSHOT_DIR / "weapon_captured").mkdir(parents=True, exist_ok=True)
        (self.SNAPSHOT_DIR / "person_captured").mkdir(parents=True, exist_ok=True)
        MODELS_DIR.mkdir(parents=True, exist_ok=True)

    def warn_missing_models(self) -> None:
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
