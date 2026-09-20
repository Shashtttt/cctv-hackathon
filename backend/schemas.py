from __future__ import annotations

import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class FencePointSchema(BaseModel):
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)


class CameraCreateRequest(BaseModel):
    id: str
    code: str
    name: str
    location: str = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude: Optional[float] = None
    gps_coords: Optional[str] = None
    rtsp_url: str
    fps: int = 30
    resolution: str = "1080p FHD"
    mode: str = "STANDARD"
    analytics_modes: List[str] = ["HUMAN", "VEHICLE", "FRS", "ANPR"]
    fence_points: List[FencePointSchema] = []
    rtsp_reconnect_attempts: int = 5


class CameraUpdateRequest(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    status: Optional[str] = None
    mode: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude: Optional[float] = None
    gps_coords: Optional[str] = None
    analytics_modes: Optional[List[str]] = None
    fence_points: Optional[List[FencePointSchema]] = None


class CameraSyncGeoRequest(BaseModel):
    latitude: float
    longitude: float
    location_name: Optional[str] = "Live Device Location"
    delta: Optional[float] = 0.0008


class CameraResponse(BaseModel):
    id: str
    code: str
    name: str
    location: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude: Optional[float] = None
    gps_coords: Optional[str] = None
    rtsp_url: str
    status: str
    fps: int
    resolution: str
    mode: str
    analytics_modes: List[str]
    fence_points: List[FencePointSchema]
    last_frame_at: Optional[datetime.datetime]
    is_running: bool = False
    is_active: bool = False
    stream_url: Optional[str] = None
    frame_url: Optional[str] = None


class AlertResponse(BaseModel):
    id: str
    camera_id: str
    timestamp: datetime.datetime
    category: str
    severity: str
    title: str
    description: str
    target_id: Optional[str] = None
    status: str
    snapshot_path: Optional[str] = None
    snapshot_url: Optional[str] = None
    frs_match_name: Optional[str] = None
    frs_match_score: Optional[float] = None
    plate_text: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    gps_coords: Optional[str] = None


class AlertListResponse(BaseModel):
    items: List[AlertResponse]
    total: int
    limit: int
    offset: int


class AlertStatusUpdate(BaseModel):
    status: str


class FRSSubjectCreate(BaseModel):
    id: Optional[str] = None
    name: str
    alias: str = ""
    category: str = "Persons of Interest"
    threat_level: str = "MEDIUM"
    avatar_url: str = ""
    notes: str = ""


class FRSSubjectResponse(BaseModel):
    id: str
    name: str
    alias: str
    category: str
    threat_level: str
    avatar_url: str
    notes: str
    has_embedding: bool
    last_seen: Optional[str]
    last_seen_at: Optional[datetime.datetime]
    enrolled_at: datetime.datetime


class EmbeddingEnrollRequest(BaseModel):
    subject_id: str
    embedding: List[float] = Field(min_length=128, max_length=512)


class ANPRVehicleCreate(BaseModel):
    plate: str
    owner: str = "Unknown"
    status: str = "SUSPICIOUS"
    vehicle_type: str = ""
    threat_level: str = "HIGH"
    notes: str = ""
    flagged_date: Optional[str] = None


class ANPRVehicleResponse(BaseModel):
    plate: str
    owner: str
    status: str
    vehicle_type: str
    threat_level: str
    notes: str
    flagged_date: Optional[str]


class AlertSummaryResponse(BaseModel):
    total: int
    hours: int
    by_severity: Dict[str, int]
    by_category: Dict[str, int]
    hourly_trend: Optional[List[Dict[str, Any]]] = None
    peak_hour: Optional[str] = "12:00"
    peak_count: Optional[int] = 0
    person_count: Optional[int] = 0
    intrusion_count: Optional[int] = 0
    loitering_count: Optional[int] = 0
    weapon_count: Optional[int] = 0
    anpr_count: Optional[int] = 0
    frs_count: Optional[int] = 0
    top_cameras: Optional[List[Dict[str, Any]]] = None
    top_targets: Optional[List[Dict[str, Any]]] = None


class WorkerStatusResponse(BaseModel):
    camera_id: str
    pid: Optional[int]
    alive: bool
    exit_code: Optional[int]
    result_queue_depth: int


class SuccessResponse(BaseModel):
    success: bool = True
    message: str = "OK"


class HealthResponse(BaseModel):
    status: str
    platform: str
    version: str
    ai_engine: str
    active_cameras: int
    queue_depth: int


class UserRegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    full_name: str = "Surveillance Officer"
    role: str = "OPERATOR"
    clearance_level: str = "SECRET"
    badge_number: Optional[str] = "SEC-8821"
    department: Optional[str] = "Sector-4 Border Defense"


class UserLoginRequest(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    full_name: str
    role: str
    clearance_level: str
    badge_number: str
    department: str
    created_at: str
    last_login_at: Optional[str] = None


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
