from __future__ import annotations

import datetime
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any


@dataclass
class BoundingBox:
    x: float
    y: float
    w: float
    h: float
    confidence: float

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2

    def to_pixel(self, frame_w: int, frame_h: int) -> tuple[int, int, int, int]:
        x1 = int(self.x * frame_w)
        y1 = int(self.y * frame_h)
        x2 = int((self.x + self.w) * frame_w)
        y2 = int((self.y + self.h) * frame_h)
        return x1, y1, x2, y2


@dataclass
class KeypointSet:
    points: List[tuple[float, float, float]]

    KEYPOINT_NAMES = [
        "nose", "left_eye", "right_eye", "left_ear", "right_ear",
        "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
        "left_wrist", "right_wrist", "left_hip", "right_hip",
        "left_knee", "right_knee", "left_ankle", "right_ankle"
    ]


@dataclass
class Detection:
    target_id: str
    class_id: int
    class_name: str
    bbox: BoundingBox
    keypoints: Optional[KeypointSet] = None
    face_embedding: Optional[List[float]] = None
    plate_text: Optional[str] = None
    plate_confidence: Optional[float] = None
    frs_match_name: Optional[str] = None
    frs_match_score: Optional[float] = None
    frs_watchlist_id: Optional[str] = None
    pose_label: Optional[str] = None
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
    held_item_type: Optional[str] = None
    held_by_hand: Optional[str] = None
    is_held: bool = False
    held_by_target_id: Optional[str] = None
    is_authorized: bool = False
    authorization_role: Optional[str] = None


@dataclass
class FenceBreachEvent:
    camera_id: str
    target_id: str
    detection: Detection
    breach_direction: str
    fence_zone_id: str
    timestamp: datetime.datetime = field(default_factory=datetime.datetime.utcnow)


@dataclass
class FrameResult:
    camera_id: str
    frame_number: int
    timestamp: datetime.datetime
    detections: List[Detection] = field(default_factory=list)
    fence_breaches: List[FenceBreachEvent] = field(default_factory=list)
    alerts: List[AlertRecord] = field(default_factory=list)
    annotated_frame_jpg: Optional[bytes] = None
    processing_ms: float = 0.0


@dataclass
class CameraConfig:
    id: str
    code: str
    name: str
    location: str
    rtsp_url: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude: Optional[float] = None
    gps_coords: Optional[str] = None
    status: str = "ONLINE"
    fps: int = 30
    resolution: str = "1080p FHD"
    mode: str = "STANDARD"
    analytics_modes: List[str] = field(default_factory=lambda: ["HUMAN", "VEHICLE", "FRS", "ANPR"])
    fence_points: List[Dict[str, float]] = field(default_factory=list)
    rtsp_reconnect_attempts: int = 5
    last_frame_at: Optional[datetime.datetime] = None


@dataclass
class AlertRecord:
    id: str
    camera_id: str
    timestamp: datetime.datetime
    category: str
    severity: str
    title: str
    description: str
    target_id: Optional[str] = None
    status: str = "NEW"
    snapshot_path: Optional[str] = None
    snapshot_base64: Optional[str] = None
    snapshot_url: Optional[str] = None
    frs_match_name: Optional[str] = None
    frs_match_score: Optional[float] = None
    plate_text: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    gps_coords: Optional[str] = None
    is_authorized: bool = False

    def to_dict(self) -> Dict[str, Any]:
        url = self.snapshot_url or (f"/api/v1/snapshots/{self.id}" if self.id else None)
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
            "is_authorized": self.is_authorized,
            "snapshot_path": self.snapshot_path,
            "snapshotPath": self.snapshot_path,
            "snapshot_url": url,
            "snapshotUrl": url,
            "snapshot_base64": self.snapshot_base64,
            "snapshotBase64": self.snapshot_base64,
            "frs_match_name": self.frs_match_name,
            "frsMatchName": self.frs_match_name,
            "frs_match_score": self.frs_match_score,
            "frsMatchScore": self.frs_match_score,
            "plate_text": self.plate_text,
            "plateText": self.plate_text,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "gps_coords": self.gps_coords,
            "gpsCoords": self.gps_coords,
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
    face_embedding: Optional[List[float]] = None
    last_seen: Optional[str] = None
    last_seen_at: Optional[datetime.datetime] = None
    enrolled_at: datetime.datetime = field(default_factory=datetime.datetime.utcnow)
    is_weapon_authorized: bool = False
    is_authorized: bool = False


@dataclass
class WatchlistVehicle:
    plate: str
    owner: str
    status: str
    vehicle_type: str
    threat_level: str
    notes: str
    flagged_date: Optional[str] = None
    is_weapon_authorized: bool = False
    is_authorized: bool = False


@dataclass
class TrackRecord:
    target_id: str
    camera_id: str
    positions: List[tuple[float, float]] = field(default_factory=list)
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
    captured_at: datetime.datetime = field(default_factory=lambda: datetime.datetime.now(datetime.timezone.utc))
    file_size_bytes: int = 0


@dataclass
class UserRecord:
    id: str
    username: str
    email: str
    password_hash: str
    full_name: str = "Surveillance Officer"
    role: str = "OPERATOR"
    clearance_level: str = "SECRET"
    badge_number: str = "SEC-8821"
    department: str = "Sector-4 Border Defense"
    created_at: datetime.datetime = field(default_factory=datetime.datetime.utcnow)
    last_login_at: Optional[datetime.datetime] = None


@dataclass
class AuditBlockRecord:
    index: int
    timestamp: str
    event_type: str
    camera_id: str
    alert_id: Optional[str]
    payload_json: str
    data_hash: str
    previous_hash: str
    merkle_root: str
    block_hash: str
    validator_node: str = "NODE-BSF-SECTOR4-ALPHA"
    signature: str = ""
    nonce: int = 0
