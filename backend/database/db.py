"""
IBVAP — Async SQLite database layer using aiosqlite.
Provides init_db(), connection context manager, and all CRUD operations.
"""

from __future__ import annotations

import asyncio
import json
import datetime
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator, List, Optional

import aiosqlite

from ..config import DB_PATH
from .models import (
    AlertRecord, CameraConfig, WatchlistSubject, WatchlistVehicle,
    SnapshotRecord, TrackRecord,
)

log = logging.getLogger("ibvap.db")



@asynccontextmanager
async def get_db() -> AsyncIterator[aiosqlite.Connection]:
    """Async context manager that yields an aiosqlite connection with WAL mode and 30s busy timeout."""
    db = await aiosqlite.connect(DB_PATH, timeout=30.0)
    db.row_factory = aiosqlite.Row
    try:
        await db.execute("PRAGMA busy_timeout=30000")
        await db.execute("PRAGMA synchronous=NORMAL")
        await db.execute("PRAGMA cache_size=-32000")  # 32 MB page cache
        await db.execute("PRAGMA foreign_keys=ON")
        yield db
    finally:
        await db.close()




async def init_db() -> None:
    """Create all tables and indexes. Idempotent — safe to call on every startup."""
    try:
        async with get_db() as db:
            await db.execute("PRAGMA journal_mode=WAL")
            await db.executescript("""
                CREATE TABLE IF NOT EXISTS cameras (
                    id                      TEXT PRIMARY KEY,
                    code                    TEXT NOT NULL,
                    name                    TEXT NOT NULL,
                    location                TEXT NOT NULL DEFAULT '',
                    latitude                REAL,
                    longitude               REAL,
                    altitude                REAL,
                    gps_coords              TEXT NOT NULL DEFAULT '',
                    rtsp_url                TEXT NOT NULL DEFAULT '',
                    status                  TEXT NOT NULL DEFAULT 'ONLINE',
                    fps                     INTEGER NOT NULL DEFAULT 30,
                    resolution              TEXT NOT NULL DEFAULT '1080p FHD',
                    mode                    TEXT NOT NULL DEFAULT 'STANDARD',
                    analytics_modes         TEXT NOT NULL DEFAULT '[]',
                    fence_points            TEXT NOT NULL DEFAULT '[]',
                    rtsp_reconnect_attempts INTEGER NOT NULL DEFAULT 5,
                    last_frame_at           TEXT
                );

                CREATE TABLE IF NOT EXISTS alerts (
                    id              TEXT PRIMARY KEY,
                    camera_id       TEXT NOT NULL,
                    timestamp       TEXT NOT NULL,
                    category        TEXT NOT NULL,
                    severity        TEXT NOT NULL,
                    title           TEXT NOT NULL,
                    description     TEXT NOT NULL DEFAULT '',
                    target_id       TEXT,
                    status          TEXT NOT NULL DEFAULT 'NEW',
                    snapshot_path   TEXT,
                    frs_match_name  TEXT,
                    frs_match_score REAL,
                    plate_text      TEXT,
                    latitude        REAL,
                    longitude       REAL,
                    gps_coords      TEXT NOT NULL DEFAULT '',
                    FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS frs_watchlist (
                    id              TEXT PRIMARY KEY,
                    name            TEXT NOT NULL,
                    alias           TEXT NOT NULL DEFAULT '',
                    category        TEXT NOT NULL DEFAULT '',
                    threat_level    TEXT NOT NULL DEFAULT 'MEDIUM',
                    avatar_url      TEXT NOT NULL DEFAULT '',
                    notes           TEXT NOT NULL DEFAULT '',
                    face_embedding  TEXT,           -- JSON array of 128 floats
                    last_seen       TEXT,
                    last_seen_at    TEXT,
                    enrolled_at     TEXT NOT NULL,
                    is_weapon_authorized INTEGER DEFAULT 0,
                    is_authorized        INTEGER DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS anpr_watchlist (
                    plate           TEXT PRIMARY KEY,
                    owner           TEXT NOT NULL DEFAULT 'Unknown',
                    status          TEXT NOT NULL DEFAULT 'SUSPICIOUS',
                    vehicle_type    TEXT NOT NULL DEFAULT '',
                    threat_level    TEXT NOT NULL DEFAULT 'HIGH',
                    notes           TEXT NOT NULL DEFAULT '',
                    flagged_date    TEXT,
                    is_weapon_authorized INTEGER DEFAULT 0,
                    is_authorized        INTEGER DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS snapshots (
                    alert_id        TEXT NOT NULL,
                    camera_id       TEXT NOT NULL,
                    frame_number    INTEGER NOT NULL,
                    file_path       TEXT NOT NULL,
                    captured_at     TEXT NOT NULL,
                    file_size_bytes INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (alert_id),
                    FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS track_history (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    target_id   TEXT NOT NULL,
                    camera_id   TEXT NOT NULL,
                    cx          REAL NOT NULL,
                    cy          REAL NOT NULL,
                    recorded_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS users (
                    id              TEXT PRIMARY KEY,
                    username        TEXT UNIQUE NOT NULL,
                    email           TEXT UNIQUE NOT NULL,
                    password_hash   TEXT NOT NULL,
                    full_name       TEXT NOT NULL,
                    role            TEXT NOT NULL DEFAULT 'OPERATOR',
                    clearance_level TEXT NOT NULL DEFAULT 'SECRET',
                    badge_number    TEXT NOT NULL DEFAULT 'SEC-8821',
                    department      TEXT NOT NULL DEFAULT 'Sector-4 Border Defense',
                    created_at      TEXT NOT NULL,
                    last_login_at   TEXT
                );

                CREATE TABLE IF NOT EXISTS blockchain_blocks (
                    block_index     INTEGER PRIMARY KEY,
                    timestamp       TEXT NOT NULL,
                    event_type      TEXT NOT NULL,
                    camera_id       TEXT NOT NULL,
                    alert_id        TEXT,
                    payload_json    TEXT NOT NULL,
                    data_hash       TEXT NOT NULL,
                    previous_hash   TEXT NOT NULL,
                    merkle_root     TEXT NOT NULL,
                    block_hash      TEXT NOT NULL,
                    validator_node  TEXT NOT NULL DEFAULT 'NODE-BSF-SECTOR4-ALPHA',
                    signature       TEXT NOT NULL DEFAULT '',
                    nonce           INTEGER NOT NULL DEFAULT 0
                );

                -- Performance indexes
                CREATE INDEX IF NOT EXISTS idx_alerts_camera   ON alerts(camera_id);
                CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
                CREATE INDEX IF NOT EXISTS idx_alerts_status   ON alerts(status);
                CREATE INDEX IF NOT EXISTS idx_alerts_ts       ON alerts(timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_anpr_plate      ON anpr_watchlist(plate);
                CREATE INDEX IF NOT EXISTS idx_track_target    ON track_history(target_id, camera_id);
                CREATE INDEX IF NOT EXISTS idx_users_username  ON users(username);
                CREATE INDEX IF NOT EXISTS idx_blockchain_hash ON blockchain_blocks(block_hash);
                CREATE INDEX IF NOT EXISTS idx_blockchain_alert ON blockchain_blocks(alert_id);
            """)
            await db.commit()

            # Ensure GPS and Tamper columns exist on existing databases (safe migration)
            for col, col_type in [
                ("latitude", "REAL"),
                ("longitude", "REAL"),
                ("altitude", "REAL"),
                ("gps_coords", "TEXT NOT NULL DEFAULT ''"),
                ("tamper_status", "TEXT NOT NULL DEFAULT 'NORMAL'"),
                ("focus_score", "REAL DEFAULT 100.0"),
                ("occlusion_percent", "REAL DEFAULT 0.0"),
                ("last_tamper_at", "TEXT"),
            ]:
                try:
                    await db.execute(f"ALTER TABLE cameras ADD COLUMN {col} {col_type}")
                except Exception:
                    pass

            for col, col_type in [
                ("latitude", "REAL"),
                ("longitude", "REAL"),
                ("gps_coords", "TEXT NOT NULL DEFAULT ''"),
            ]:
                try:
                    await db.execute(f"ALTER TABLE alerts ADD COLUMN {col} {col_type}")
                except Exception:
                    pass

            for col, col_type in [
                ("is_weapon_authorized", "INTEGER DEFAULT 0"),
                ("is_authorized", "INTEGER DEFAULT 0"),
            ]:
                try:
                    await db.execute(f"ALTER TABLE frs_watchlist ADD COLUMN {col} {col_type}")
                except Exception:
                    pass
                try:
                    await db.execute(f"ALTER TABLE anpr_watchlist ADD COLUMN {col} {col_type}")
                except Exception:
                    pass

            # Ensure all cameras have FRS and ANPR enabled in analytics_modes
            try:
                await db.execute("""
                    UPDATE cameras 
                    SET analytics_modes='["WEAPON", "INTRUSION", "PERSON", "FRS", "ANPR"]'
                    WHERE analytics_modes NOT LIKE '%FRS%' OR analytics_modes NOT LIKE '%ANPR%'
                """)
                await db.commit()
            except Exception:
                pass

            log.info("Database schema initialised at %s", DB_PATH)

        # Seed demo data if database is empty
        await seed_initial_data_if_empty()
    except Exception as exc:
        log.critical("Failed to initialise database: %s", exc, exc_info=True)
        raise SystemExit(1) from exc




async def seed_initial_data_if_empty() -> None:
    """Watchlists start clean and are dynamically managed by the admin."""
    pass




async def upsert_camera(cam: CameraConfig) -> None:
    gps = cam.gps_coords
    if not gps and cam.latitude is not None and cam.longitude is not None:
        gps = f"{abs(cam.latitude):.4f}° {'N' if cam.latitude >= 0 else 'S'}, {abs(cam.longitude):.4f}° {'E' if cam.longitude >= 0 else 'W'}"

    async with get_db() as db:
        await db.execute(
            """INSERT INTO cameras
               (id, code, name, location, latitude, longitude, altitude, gps_coords,
                rtsp_url, status, fps, resolution,
                mode, analytics_modes, fence_points, rtsp_reconnect_attempts, last_frame_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 location=excluded.location, latitude=excluded.latitude,
                 longitude=excluded.longitude, altitude=excluded.altitude,
                 gps_coords=excluded.gps_coords,
                 status=excluded.status, fps=excluded.fps, mode=excluded.mode,
                 analytics_modes=excluded.analytics_modes,
                 fence_points=excluded.fence_points,
                 last_frame_at=excluded.last_frame_at""",
            (
                cam.id, cam.code, cam.name, cam.location,
                cam.latitude, cam.longitude, cam.altitude, gps or "",
                cam.rtsp_url,
                cam.status, cam.fps, cam.resolution, cam.mode,
                json.dumps(cam.analytics_modes),
                json.dumps(cam.fence_points),
                cam.rtsp_reconnect_attempts,
                cam.last_frame_at.isoformat() if cam.last_frame_at else None,
            ),
        )
        await db.commit()


async def get_all_cameras() -> List[CameraConfig]:
    async with get_db() as db:
        async with db.execute("SELECT * FROM cameras") as cursor:
            rows = await cursor.fetchall()
    return [_row_to_camera(r) for r in rows]


async def get_camera(cam_id: str) -> Optional[CameraConfig]:
    async with get_db() as db:
        async with db.execute("SELECT * FROM cameras WHERE id=?", (cam_id,)) as cur:
            row = await cur.fetchone()
    return _row_to_camera(row) if row else None


async def update_camera_fence(cam_id: str, fence_points: list) -> None:
    async with get_db() as db:
        await db.execute(
            "UPDATE cameras SET fence_points=? WHERE id=?",
            (json.dumps(fence_points), cam_id),
        )
        await db.commit()


async def update_camera_status(cam_id: str, status: str) -> None:
    async with get_db() as db:
        await db.execute(
            "UPDATE cameras SET status=?, last_frame_at=? WHERE id=?",
            (status, datetime.datetime.utcnow().isoformat(), cam_id),
        )
        await db.commit()


async def delete_camera(cam_id: str) -> None:
    async with get_db() as db:
        await db.execute("DELETE FROM cameras WHERE id=?", (cam_id,))
        await db.commit()


async def sync_cameras_to_geolocation(
    lat: float, lon: float, location_name: str = "Live Device Location", delta: float = 0.0008
) -> List[CameraConfig]:
    """
    Repositions existing cameras along a linear perimeter chain centered around (lat, lon).
    cam-01: North Post (lat + 2*delta, lon - 2*delta)
    cam-02: Approach Corridor (lat + delta, lon - delta)
    cam-03: Central Optical Hub (lat, lon)
    cam-04: South Sector (lat - delta, lon + delta)
    Additional cameras offset further along the perimeter line.
    """
    cameras = await get_all_cameras()
    if not cameras:
        return []

    n = len(cameras)
    center_idx = min(2, n - 1)
    
    updated = []
    async with get_db() as db:
        for i, cam in enumerate(cameras):
            step = center_idx - i
            c_lat = round(lat + (step * delta), 6)
            c_lon = round(lon - (step * delta), 6)
            c_gps = f"{abs(c_lat):.4f}° {'N' if c_lat >= 0 else 'S'}, {abs(c_lon):.4f}° {'E' if c_lon >= 0 else 'W'}"
            c_loc = f"{location_name} (Post {i+1})"
            
            await db.execute(
                """UPDATE cameras 
                   SET latitude=?, longitude=?, gps_coords=?, location=? 
                   WHERE id=?""",
                (c_lat, c_lon, c_gps, c_loc, cam.id),
            )
            cam.latitude = c_lat
            cam.longitude = c_lon
            cam.gps_coords = c_gps
            cam.location = c_loc
            updated.append(cam)
        await db.commit()

    return updated



def _row_to_camera(row: aiosqlite.Row) -> CameraConfig:
    d = dict(row)
    lat = d.get("latitude")
    lng = d.get("longitude")
    gps = d.get("gps_coords")
    if not gps and lat is not None and lng is not None:
        gps = f"{abs(lat):.4f}° {'N' if lat >= 0 else 'S'}, {abs(lng):.4f}° {'E' if lng >= 0 else 'W'}"

    return CameraConfig(
        id=d["id"], code=d["code"], name=d["name"],
        location=d["location"],
        latitude=lat,
        longitude=lng,
        altitude=d.get("altitude"),
        gps_coords=gps or "",
        rtsp_url=d["rtsp_url"],
        status=d["status"], fps=d["fps"], resolution=d["resolution"],
        mode=d["mode"],
        analytics_modes=json.loads(d["analytics_modes"]),
        fence_points=json.loads(d["fence_points"]),
        rtsp_reconnect_attempts=d["rtsp_reconnect_attempts"],
        last_frame_at=(
            datetime.datetime.fromisoformat(d["last_frame_at"])
            if d["last_frame_at"] else None
        ),
    )




async def save_alert(alert: AlertRecord) -> None:
    async with get_db() as db:
        await db.execute(
            """INSERT OR IGNORE INTO alerts
               (id, camera_id, timestamp, category, severity, title, description,
                target_id, status, snapshot_path, frs_match_name, frs_match_score, plate_text,
                latitude, longitude, gps_coords)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                alert.id, alert.camera_id,
                alert.timestamp.isoformat(),
                alert.category, alert.severity, alert.title,
                alert.description, alert.target_id, alert.status,
                alert.snapshot_path, alert.frs_match_name,
                alert.frs_match_score, alert.plate_text,
                alert.latitude, alert.longitude, alert.gps_coords or "",
            ),
        )
        await db.commit()

    # Mirror alert to Firebase Realtime Database cloud sync
    try:
        from ..core.firebase_service import push_realtime_alert
        push_realtime_alert({
            "id": alert.id,
            "camera_id": alert.camera_id,
            "timestamp": alert.timestamp.isoformat(),
            "category": alert.category,
            "severity": alert.severity,
            "title": alert.title,
            "description": alert.description,
            "target_id": alert.target_id,
            "status": alert.status,
            "snapshot_path": alert.snapshot_path,
            "snapshot_url": getattr(alert, "snapshot_url", None) or (f"/api/v1/snapshots/{alert.id}" if alert.snapshot_path else None),
            "snapshot_base64": getattr(alert, "snapshot_base64", None),
            "frs_match_name": alert.frs_match_name,
            "frs_match_score": alert.frs_match_score,
            "plate_text": alert.plate_text,
            "latitude": alert.latitude,
            "longitude": alert.longitude,
            "gps_coords": alert.gps_coords or "",
        })
    except Exception as e:
        log.debug("Firebase alert cloud sync skipped/failed: %s", e)


async def get_alerts(
    camera_id: Optional[str] = None,
    severity: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 500,
    offset: int = 0,
) -> List[AlertRecord]:
    clauses, params = [], []
    if camera_id:
        clauses.append("camera_id=?"); params.append(camera_id)
    if severity:
        clauses.append("severity=?"); params.append(severity)
    if status:
        clauses.append("status=?"); params.append(status)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    params += [limit, offset]

    async with get_db() as db:
        async with db.execute(
            f"SELECT * FROM alerts {where} ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            params,
        ) as cur:
            rows = await cur.fetchall()
    return [_row_to_alert(r) for r in rows]


async def update_alert_status(alert_id: str, status: str) -> None:
    async with get_db() as db:
        await db.execute("UPDATE alerts SET status=? WHERE id=?", (status, alert_id))
        await db.commit()


async def get_alert(alert_id: str) -> Optional[AlertRecord]:
    async with get_db() as db:
        async with db.execute("SELECT * FROM alerts WHERE id=?", (alert_id,)) as cur:
            row = await cur.fetchone()
            if row:
                return _row_to_alert(row)
    return None


def _row_to_alert(row: aiosqlite.Row) -> AlertRecord:
    d = dict(row)
    return AlertRecord(
        id=d["id"], camera_id=d["camera_id"],
        timestamp=datetime.datetime.fromisoformat(d["timestamp"]),
        category=d["category"], severity=d["severity"],
        title=d["title"], description=d["description"],
        target_id=d["target_id"], status=d["status"],
        snapshot_path=d["snapshot_path"],
        frs_match_name=d["frs_match_name"],
        frs_match_score=d["frs_match_score"],
        plate_text=d["plate_text"],
        latitude=d.get("latitude"),
        longitude=d.get("longitude"),
        gps_coords=d.get("gps_coords"),
    )




async def save_frs_subject(subject: WatchlistSubject) -> None:
    async with get_db() as db:
        await db.execute(
            """INSERT OR REPLACE INTO frs_watchlist
               (id, name, alias, category, threat_level, avatar_url, notes,
                face_embedding, last_seen, last_seen_at, enrolled_at,
                is_weapon_authorized, is_authorized)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                subject.id, subject.name, subject.alias, subject.category,
                subject.threat_level, subject.avatar_url, subject.notes,
                json.dumps(subject.face_embedding) if subject.face_embedding else None,
                subject.last_seen,
                subject.last_seen_at.isoformat() if subject.last_seen_at else None,
                subject.enrolled_at.isoformat(),
                1 if getattr(subject, "is_weapon_authorized", False) else 0,
                1 if getattr(subject, "is_authorized", False) else 0,
            ),
        )
        await db.commit()


async def get_frs_watchlist() -> List[WatchlistSubject]:
    async with get_db() as db:
        async with db.execute("SELECT * FROM frs_watchlist ORDER BY threat_level") as cur:
            rows = await cur.fetchall()
    return [_row_to_frs(r) for r in rows]


async def get_frs_subject(subject_id: str) -> Optional[WatchlistSubject]:
    async with get_db() as db:
        async with db.execute(
            "SELECT * FROM frs_watchlist WHERE id=?", (subject_id,)
        ) as cur:
            row = await cur.fetchone()
    return _row_to_frs(row) if row else None


async def update_frs_embedding(subject_id: str, embedding: List[float], avatar_url: Optional[str] = None) -> None:
    async with get_db() as db:
        if avatar_url:
            await db.execute(
                "UPDATE frs_watchlist SET face_embedding=?, avatar_url=? WHERE id=?",
                (json.dumps(embedding), avatar_url, subject_id),
            )
        else:
            await db.execute(
                "UPDATE frs_watchlist SET face_embedding=? WHERE id=?",
                (json.dumps(embedding), subject_id),
            )
        await db.commit()


async def delete_frs_subject(subject_id: str) -> None:
    async with get_db() as db:
        await db.execute("DELETE FROM frs_watchlist WHERE id=?", (subject_id,))
        await db.commit()


def _row_to_frs(row: aiosqlite.Row) -> WatchlistSubject:
    d = dict(row)
    cat_upper = (d.get("category") or "").upper()
    threat_upper = (d.get("threat_level") or "").upper()
    is_auth = (
        bool(d.get("is_authorized", 0))
        or threat_upper == "AUTHORIZED"
        or cat_upper in ("SECURITY_OFFICER", "SENTRY", "PATROL_LEAD", "AUTHORIZED_PERSONNEL")
    )
    is_wep_auth = bool(d.get("is_weapon_authorized", 0)) or (is_auth and cat_upper in ("SECURITY_OFFICER", "SENTRY", "PATROL_LEAD", "AUTHORIZED_PERSONNEL"))
    return WatchlistSubject(
        id=d["id"], name=d["name"], alias=d["alias"] or "",
        category=d["category"] or "", threat_level=d["threat_level"],
        avatar_url=d["avatar_url"] or "", notes=d["notes"] or "",
        face_embedding=json.loads(d["face_embedding"]) if d["face_embedding"] else None,
        last_seen=d["last_seen"],
        last_seen_at=(
            datetime.datetime.fromisoformat(d["last_seen_at"])
            if d["last_seen_at"] else None
        ),
        enrolled_at=datetime.datetime.fromisoformat(d["enrolled_at"]),
        is_weapon_authorized=is_wep_auth,
        is_authorized=is_auth,
    )




async def save_anpr_vehicle(vehicle: WatchlistVehicle) -> None:
    async with get_db() as db:
        await db.execute(
            """INSERT OR REPLACE INTO anpr_watchlist
               (plate, owner, status, vehicle_type, threat_level, notes, flagged_date,
                is_weapon_authorized, is_authorized)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                vehicle.plate.upper(), vehicle.owner, vehicle.status,
                vehicle.vehicle_type, vehicle.threat_level, vehicle.notes,
                vehicle.flagged_date,
                1 if getattr(vehicle, "is_weapon_authorized", False) else 0,
                1 if getattr(vehicle, "is_authorized", False) or vehicle.status.upper() == "AUTHORIZED" else 0,
            ),
        )
        await db.commit()


async def get_anpr_watchlist() -> List[WatchlistVehicle]:
    async with get_db() as db:
        async with db.execute("SELECT * FROM anpr_watchlist ORDER BY threat_level") as cur:
            rows = await cur.fetchall()
    return [_row_to_anpr(r) for r in rows]


async def check_plate_in_watchlist(plate: str) -> Optional[WatchlistVehicle]:
    """Exact match lookup — fuzzy matching is in anpr_engine.py."""
    async with get_db() as db:
        async with db.execute(
            "SELECT * FROM anpr_watchlist WHERE plate=?", (plate.upper(),)
        ) as cur:
            row = await cur.fetchone()
    return _row_to_anpr(row) if row else None


async def delete_anpr_vehicle(plate: str) -> None:
    async with get_db() as db:
        await db.execute("DELETE FROM anpr_watchlist WHERE plate=?", (plate.upper(),))
        await db.commit()


def _row_to_anpr(row: aiosqlite.Row) -> WatchlistVehicle:
    d = dict(row)
    status_upper = (d.get("status") or "").upper()
    threat_upper = (d.get("threat_level") or "").upper()
    is_auth = bool(d.get("is_authorized", 0)) or status_upper == "AUTHORIZED" or threat_upper == "AUTHORIZED"
    return WatchlistVehicle(
        plate=d["plate"], owner=d["owner"] or "Unknown",
        status=d["status"], vehicle_type=d["vehicle_type"] or "",
        threat_level=d["threat_level"], notes=d["notes"] or "",
        flagged_date=d["flagged_date"],
        is_weapon_authorized=bool(d.get("is_weapon_authorized", 0)),
        is_authorized=is_auth,
    )




async def save_snapshot(snap: SnapshotRecord) -> None:
    async with get_db() as db:
        await db.execute(
            """INSERT OR IGNORE INTO snapshots
               (alert_id, camera_id, frame_number, file_path, captured_at, file_size_bytes)
               VALUES (?,?,?,?,?,?)""",
            (
                snap.alert_id, snap.camera_id, snap.frame_number,
                snap.file_path, snap.captured_at.isoformat(), snap.file_size_bytes,
            ),
        )
        await db.commit()


async def get_snapshot(alert_id: str) -> Optional[SnapshotRecord]:
    async with get_db() as db:
        async with db.execute(
            "SELECT * FROM snapshots WHERE alert_id=?", (alert_id,)
        ) as cur:
            row = await cur.fetchone()
    if not row:
        return None
    d = dict(row)
    return SnapshotRecord(
        alert_id=d["alert_id"], camera_id=d["camera_id"],
        frame_number=d["frame_number"], file_path=d["file_path"],
        captured_at=datetime.datetime.fromisoformat(d["captured_at"]),
        file_size_bytes=d["file_size_bytes"],
    )


async def delete_snapshot_record(identifier: str) -> bool:
    """Delete a snapshot record from SQLite database and unlink from alert."""
    async with get_db() as db:
        await db.execute(
            "DELETE FROM snapshots WHERE alert_id = ? OR file_path LIKE ?",
            (identifier, f"%{identifier}%"),
        )
        await db.execute(
            "UPDATE alerts SET snapshot_path = NULL WHERE id = ? OR snapshot_path LIKE ?",
            (identifier, f"%{identifier}%"),
        )
        await db.commit()
    return True

async def get_alert_summary(hours: int = 24) -> dict:
    """Return threat counts, trends, and aggregates for the last N hours from SQLite."""
    since = (datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) - datetime.timedelta(hours=hours)).isoformat()
    async with get_db() as db:
        # 1. Severity breakdown
        async with db.execute(
            "SELECT severity, COUNT(*) AS cnt FROM alerts WHERE timestamp >= ? GROUP BY severity",
            (since,),
        ) as cur:
            severity_rows = await cur.fetchall()

        # 2. Category breakdown
        async with db.execute(
            "SELECT category, COUNT(*) AS cnt FROM alerts WHERE timestamp >= ? GROUP BY category",
            (since,),
        ) as cur:
            category_rows = await cur.fetchall()

        # 3. Total count
        async with db.execute(
            "SELECT COUNT(*) AS cnt FROM alerts WHERE timestamp >= ?", (since,)
        ) as cur:
            total_row = await cur.fetchone()
            total = total_row["cnt"] if total_row else 0

        # 4. Hourly trend
        async with db.execute(
            """
            SELECT 
                strftime('%H:00', timestamp) AS hour_slot,
                COUNT(*) AS total,
                SUM(CASE WHEN severity = 'CRITICAL' THEN 1 ELSE 0 END) AS critical
            FROM alerts 
            WHERE timestamp >= ?
            GROUP BY hour_slot
            ORDER BY hour_slot ASC
            """,
            (since,),
        ) as cur:
            hourly_rows = await cur.fetchall()

        hourly_trend = [
            {"hour": r["hour_slot"], "total": r["total"], "critical": r["critical"]}
            for r in hourly_rows
        ]

        # 5. Peak hour & count
        peak_hour = "12:00"
        peak_count = 0
        if hourly_trend:
            peak_entry = max(hourly_trend, key=lambda x: x["total"])
            peak_hour = peak_entry["hour"]
            peak_count = peak_entry["total"]

        # 6. Top cameras by volume
        async with db.execute(
            """
            SELECT a.camera_id, COALESCE(c.name, a.camera_id) AS name, COALESCE(c.code, UPPER(a.camera_id)) AS code, COUNT(*) AS event_count
            FROM alerts a
            LEFT JOIN cameras c ON a.camera_id = c.id
            WHERE a.timestamp >= ?
            GROUP BY a.camera_id
            ORDER BY event_count DESC
            LIMIT 5
            """,
            (since,),
        ) as cur:
            cam_rows = await cur.fetchall()
            top_cameras = [
                {
                    "camera_id": r["camera_id"],
                    "name": r["name"],
                    "code": r["code"],
                    "event_count": r["event_count"],
                }
                for r in cam_rows
            ]

        # 7. Top targets / active tracked objects
        async with db.execute(
            """
            SELECT 
                COALESCE(NULLIF(target_id, ''), 'OBJ-' || substr(id, 1, 4)) AS obj_id,
                category,
                title,
                severity,
                camera_id,
                MAX(timestamp) AS last_seen,
                COUNT(*) AS count
            FROM alerts
            WHERE timestamp >= ?
            GROUP BY obj_id, category
            ORDER BY count DESC
            LIMIT 5
            """,
            (since,),
        ) as cur:
            target_rows = await cur.fetchall()
            top_targets = [
                {
                    "obj_id": r["obj_id"],
                    "category": r["category"],
                    "title": r["title"],
                    "severity": r["severity"],
                    "camera_id": r["camera_id"],
                    "last_seen": r["last_seen"],
                    "count": r["count"],
                }
                for r in target_rows
            ]

        # 8. Person, Intrusion, Loitering, Weapon, ANPR, FRS totals
        async with db.execute(
            """
            SELECT COUNT(*) AS cnt FROM alerts 
            WHERE timestamp >= ? AND (
                category IN ('HUMAN', 'PERSON', 'LOITERING', 'SUSPICIOUS_POSTURE', 'UNAUTHORIZED_ENTRY')
                OR (frs_match_name IS NOT NULL AND frs_match_name != '')
            )
            """,
            (since,),
        ) as cur:
            r = await cur.fetchone()
            person_count = r["cnt"] if r else 0

        async with db.execute(
            """
            SELECT COUNT(*) AS cnt FROM alerts 
            WHERE timestamp >= ? AND category IN ('VIRTUAL_FENCE_INTRUSION', 'INTRUSION', 'TRIPWIRE_CROSSING', 'UNAUTHORIZED_ENTRY')
            """,
            (since,),
        ) as cur:
            r = await cur.fetchone()
            intrusion_count = r["cnt"] if r else 0

        async with db.execute(
            "SELECT COUNT(*) AS cnt FROM alerts WHERE timestamp >= ? AND category = 'LOITERING'",
            (since,),
        ) as cur:
            r = await cur.fetchone()
            loitering_count = r["cnt"] if r else 0

        async with db.execute(
            """
            SELECT COUNT(*) AS cnt FROM alerts 
            WHERE timestamp >= ? AND category IN ('WEAPON_DETECTED', 'WEAPON', 'UNUSUAL_ITEM')
            """,
            (since,),
        ) as cur:
            r = await cur.fetchone()
            weapon_count = r["cnt"] if r else 0

        async with db.execute(
            """
            SELECT COUNT(*) AS cnt FROM alerts 
            WHERE timestamp >= ? AND (
                (plate_text IS NOT NULL AND plate_text != '') OR category = 'ANPR_MATCH'
            )
            """,
            (since,),
        ) as cur:
            r = await cur.fetchone()
            anpr_count = r["cnt"] if r else 0

        async with db.execute(
            """
            SELECT COUNT(*) AS cnt FROM alerts 
            WHERE timestamp >= ? AND (
                (frs_match_name IS NOT NULL AND frs_match_name != '') OR category = 'FRS_MATCH'
            )
            """,
            (since,),
        ) as cur:
            r = await cur.fetchone()
            frs_count = r["cnt"] if r else 0

    return {
        "total": total,
        "hours": hours,
        "by_severity": {r["severity"]: r["cnt"] for r in severity_rows},
        "by_category": {r["category"]: r["cnt"] for r in category_rows},
        "hourly_trend": hourly_trend,
        "peak_hour": peak_hour,
        "peak_count": peak_count,
        "person_count": person_count,
        "intrusion_count": intrusion_count,
        "loitering_count": loitering_count,
        "weapon_count": weapon_count,
        "anpr_count": anpr_count,
        "frs_count": frs_count,
        "top_cameras": top_cameras,
        "top_targets": top_targets,
    }




async def get_user_by_username(username: str) -> Optional[dict]:
    async with get_db() as db:
        async with db.execute("SELECT * FROM users WHERE username = ? OR email = ?", (username, username)) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def get_user_by_id(user_id: str) -> Optional[dict]:
    async with get_db() as db:
        async with db.execute("SELECT * FROM users WHERE id = ?", (user_id,)) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def create_user(user_data: dict) -> dict:
    async with get_db() as db:
        await db.execute(
            """
            INSERT INTO users (id, username, email, password_hash, full_name, role, clearance_level, badge_number, department, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_data["id"],
                user_data["username"],
                user_data["email"],
                user_data["password_hash"],
                user_data.get("full_name", "Surveillance Officer"),
                user_data.get("role", "OPERATOR"),
                user_data.get("clearance_level", "SECRET"),
                user_data.get("badge_number", "SEC-8821"),
                user_data.get("department", "Sector-4 Border Defense"),
                user_data.get("created_at", datetime.datetime.utcnow().isoformat()),
            ),
        )
        await db.commit()
    return await get_user_by_id(user_data["id"])


async def update_user_last_login(user_id: str) -> None:
    async with get_db() as db:
        now = datetime.datetime.utcnow().isoformat()
        await db.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (now, user_id))
        await db.commit()




async def save_blockchain_block(block) -> None:
    """Persists an AuditBlock to SQLite."""
    async with get_db() as db:
        payload_json = json.dumps(block.payload, sort_keys=True)
        await db.execute(
            """INSERT OR REPLACE INTO blockchain_blocks
               (block_index, timestamp, event_type, camera_id, alert_id,
                payload_json, data_hash, previous_hash, merkle_root,
                block_hash, validator_node, signature, nonce)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                block.index,
                block.timestamp,
                block.event_type,
                block.camera_id,
                block.alert_id,
                payload_json,
                block.data_hash,
                block.previous_hash,
                block.merkle_root,
                block.block_hash,
                block.validator_node,
                block.signature,
                block.nonce,
            ),
        )
        await db.commit()


async def get_blockchain_blocks(limit: int = 100, offset: int = 0) -> List[dict]:
    """Retrieves blocks ordered by index ascending."""
    async with get_db() as db:
        async with db.execute(
            """SELECT block_index, timestamp, event_type, camera_id, alert_id,
                      payload_json, data_hash, previous_hash, merkle_root,
                      block_hash, validator_node, signature, nonce
               FROM blockchain_blocks
               ORDER BY block_index ASC
               LIMIT ? OFFSET ?""",
            (limit, offset),
        ) as cur:
            rows = await cur.fetchall()
            results = []
            for r in rows:
                d = dict(r)
                try:
                    d["payload"] = json.loads(d["payload_json"])
                except Exception:
                    d["payload"] = {}
                results.append(d)
            return results


async def get_blockchain_block_by_alert(alert_id: str) -> Optional[dict]:
    """Retrieves a specific block associated with an alert."""
    async with get_db() as db:
        async with db.execute(
            """SELECT block_index, timestamp, event_type, camera_id, alert_id,
                      payload_json, data_hash, previous_hash, merkle_root,
                      block_hash, validator_node, signature, nonce
               FROM blockchain_blocks
               WHERE alert_id = ?
               LIMIT 1""",
            (alert_id,),
        ) as cur:
            row = await cur.fetchone()
            if not row:
                return None
            d = dict(row)
            try:
                d["payload"] = json.loads(d["payload_json"])
            except Exception:
                d["payload"] = {}
            return d


async def load_blockchain_from_db() -> int:
    """Loads all persisted blocks from SQLite into the in-memory BlockchainLedger singleton."""
    from ..core.blockchain import AuditBlock, blockchain_ledger
    async with get_db() as db:
        async with db.execute(
            """SELECT block_index, timestamp, event_type, camera_id, alert_id,
                      payload_json, data_hash, previous_hash, merkle_root,
                      block_hash, validator_node, signature, nonce
               FROM blockchain_blocks
               ORDER BY block_index ASC"""
        ) as cur:
            rows = await cur.fetchall()
            if not rows:
                # Initialize genesis block and persist
                genesis = blockchain_ledger.create_genesis_block()
                blockchain_ledger.chain = [genesis]
                await save_blockchain_block(genesis)
                return 1

            loaded_chain = []
            for r in rows:
                d = dict(r)
                try:
                    payload = json.loads(d["payload_json"])
                except Exception:
                    payload = {}
                blk = AuditBlock(
                    index=d["block_index"],
                    timestamp=d["timestamp"],
                    event_type=d["event_type"],
                    camera_id=d["camera_id"],
                    alert_id=d["alert_id"],
                    payload=payload,
                    data_hash=d["data_hash"],
                    previous_hash=d["previous_hash"],
                    merkle_root=d["merkle_root"],
                    block_hash=d["block_hash"],
                    validator_node=d["validator_node"],
                    signature=d["signature"],
                    nonce=d["nonce"],
                )
                loaded_chain.append(blk)
                if blk.alert_id:
                    blockchain_ledger._alert_index_map[blk.alert_id] = blk.index

            blockchain_ledger.chain = loaded_chain
            log.info("Loaded %d blockchain audit blocks from SQLite database.", len(loaded_chain))
            return len(loaded_chain)


async def update_camera_tamper_telemetry(
    camera_id: str,
    tamper_status: str,
    focus_score: float,
    occlusion_percent: float,
) -> None:
    """Updates real-time cyber tamper telemetry on camera record."""
    async with get_db() as db:
        now = datetime.datetime.utcnow().isoformat()
        await db.execute(
            """UPDATE cameras
               SET tamper_status = ?, focus_score = ?, occlusion_percent = ?, last_tamper_at = ?
               WHERE id = ?""",
            (tamper_status, focus_score, occlusion_percent, now, camera_id),
        )
        await db.commit()

