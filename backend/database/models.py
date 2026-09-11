"""
IBVAP — ORM-level data models (dataclasses) and SQLAlchemy table definitions.
Separate from Pydantic schemas which live in backend/schemas.py.
"""

from __future__ import annotations
import datetime
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any


# ── Domain models (used internally by the pipeline) ──────────────────────────

@dataclass
class BoundingBox:
    x: float          # normalised 0..1 (left edge)
    y: float          # normalised 0..1 (top edge)
    w: float          # normalised width
    h: float          # normalised height
    confidence: float

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2

    def to_pixel(self, frame_w: int, frame_h: int) -> tuple[int, int, int, int]:
        """Convert normalised coords to absolute pixel coords (x1,y1,x2,y2)."""
        x1 = int(self.x * frame_w)
        y1 = int(self.y * frame_h)
        x2 = int((self.x + self.w) * frame_w)
        y2 = int((self.y + self.h) * frame_h)
        return x1, y1, x2, y2


@dataclass
class KeypointSet:
    """17 COCO body keypoints from YOLOv8-pose."""
    points: List[tuple[float, float, float]]  # (x_norm, y_norm, confidence)

    KEYPOINT_NAMES = [
        "nose", "left_eye", "right_eye", "left_ear", "right_ear",
        "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
        "left_wrist", "right_wrist", "left_hip", "right_hip",
        "left_knee", "right_knee", "left_ankle", "right_ankle"
    ]


@dataclass
class Detection:
    """Output of YOLOv8 for a single object."""
    target_id: str
    class_id: int
    class_name: str       # 'person', 'car', 'truck', 'motorbike', 'bus'
    bbox: BoundingBox
    keypoints: Optional[KeypointSet] = None
    face_embedding: Optional[List[float]] = None
    plate_text: Optional[str] = None
    plate_confidence: Optional[float] = None
    frs_match_name: Optional[str] = None
    frs_match_score: Optional[float] = None
    frs_watchlist_id: Optional[str] = None
    pose_label: Optional[str] = None            # STANDING | CRAWLING | RUNNING | PRONE
    is_blacklisted: bool = False
    is_in_fence: bool = False
    loiter_seconds: float = 0.0
    is_unusual: bool = False
    unusual_item: Optional[str] = None
    threat_level: str = "NORMAL"
    is_weapon: bool = False
    is_casual_object: bool = False
    is_holding: bool = False
    held_item: Optional[str] = None
    held_item_type: Optional[str] = None        # "WEAPON" | "CASUAL_OBJECT"
    held_by_hand: Optional[str] = None          # "LEFT_HAND" | "RIGHT_HAND" | "BOTH_HANDS" | "IN_HAND"
    is_held: bool = False
    held_by_target_id: Optional[str] = None


@dataclass
class FenceBreachEvent:
    """Emitted when a target crosses a virtual perimeter."""
    camera_id: str
    target_id: str
    detection: Detection
    breach_direction: str    # 'ENTRY' | 'EXIT' | 'UNKNOWN'
    fence_zone_id: str
    timestamp: datetime.datetime = field(default_factory=datetime.datetime.utcnow)


@dataclass
class FrameResult:
    """Complete result of processing one frame from one camera."""
    camera_id: str
    frame_number: int
    timestamp: datetime.datetime
    detections: List[Detection] = field(default_factory=list)
    fence_breaches: List[FenceBreachEvent] = field(default_factory=list)
    alerts: List[AlertRecord] = field(default_factory=list)
    annotated_frame_jpg: Optional[bytes] = None   # JPEG encoded bytes
    processing_ms: float = 0.0


@dataclass
class CameraConfig:
    id: str
    code: str
    name: str
    location: str
    rtsp_url: str
    status: str = "ONLINE"
    fps: int = 30
    resolution: str = "1080p FHD"
    mode: str = "STANDARD"          # STANDARD | THERMAL | NIGHT_GREEN | ANPR_FOCUS | FRS_FOCUS
    analytics_modes: List[str] = field(default_factory=lambda: ["HUMAN", "VEHICLE", "FRS", "ANPR"])
    fence_points: List[Dict[str, float]] = field(default_factory=list)
    rtsp_reconnect_attempts: int = 5
    last_frame_at: Optional[datetime.datetime] = None


@dataclass
class AlertRecord:
    id: str
    camera_id: str
    timestamp: datetime.datetime
    category: str       # VIRTUAL_FENCE_INTRUSION | ANPR_MATCH | FRS_MATCH | LOITERING | NIGHT_MOTION
    severity: str       # CRITICAL | HIGH | MEDIUM | LOW
    title: str
    description: str
    target_id: Optional[str] = None
    status: str = "NEW"             # NEW | ACKNOWLEDGED | DISPATCHED | RESOLVED
    snapshot_path: Optional[str] = None
    frs_match_name: Optional[str] = None
    frs_match_score: Optional[float] = None
    plate_text: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "camera_id": self.camera_id,
            "cameraId": self.camera_id,
            "timestamp": self.timestamp.isoformat(),
            "category": self.category,
            "severity": self.severity,
            "title": self.title,
            "description": self.description,
            "target_id": self.target_id,
            "targetId": self.target_id,
            "status": self.status,
            "snapshot_path": self.snapshot_path,
            "snapshotPath": self.snapshot_path,
            "frs_match_name": self.frs_match_name,
            "frsMatchName": self.frs_match_name,
            "frs_match_score": self.frs_match_score,
            "frsMatchScore": self.frs_match_score,
            "plate_text": self.plate_text,
            "plateText": self.plate_text,
        }


@dataclass
class WatchlistSubject:
    id: str
    name: str
    alias: str
    category: str
    threat_level: str
    avatar_url: str
    notes: str
    # SFace 128-dim embedding stored as flat list; None until enrolled with photo
    face_embedding: Optional[List[float]] = None
    last_seen: Optional[str] = None
    last_seen_at: Optional[datetime.datetime] = None
    enrolled_at: datetime.datetime = field(default_factory=datetime.datetime.utcnow)


@dataclass
class WatchlistVehicle:
    plate: str
    owner: str
    status: str          # WANTED | SUSPICIOUS | PERMITTED
    vehicle_type: str
    threat_level: str
    notes: str
    flagged_date: Optional[str] = None


@dataclass
class TrackRecord:
    """Multi-frame trajectory history for loitering and path analysis."""
    target_id: str
    camera_id: str
    positions: List[tuple[float, float]] = field(default_factory=list)  # (cx_norm, cy_norm)
    timestamps: List[datetime.datetime] = field(default_factory=list)
    zone_entry_at: Optional[datetime.datetime] = None
    is_in_zone: bool = False
    loiter_alerted: bool = False


@dataclass
class SnapshotRecord:
    alert_id: str
    camera_id: str
    frame_number: int
    file_path: str
    captured_at: datetime.datetime = field(default_factory=datetime.datetime.utcnow)
    file_size_bytes: int = 0


@dataclass
class UserRecord:
    id: str
    username: str
    email: str
    password_hash: str
    full_name: str = "Surveillance Officer"
    role: str = "OPERATOR"              # COMMANDER | OPERATOR | ANALYST | ADMIN
    clearance_level: str = "SECRET"     # CONFIDENTIAL | SECRET | TOP_SECRET
    badge_number: str = "SEC-8821"
    department: str = "Sector-4 Border Defense"
    created_at: datetime.datetime = field(default_factory=datetime.datetime.utcnow)
    last_login_at: Optional[datetime.datetime] = None

