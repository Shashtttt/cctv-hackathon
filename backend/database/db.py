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

# ── Connection helper ──────────────────────────────────────────────────────────

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


# ── Schema init ──────────────────────────────────────────────────────────────

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
                    enrolled_at     TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS anpr_watchlist (
                    plate           TEXT PRIMARY KEY,
                    owner           TEXT NOT NULL DEFAULT 'Unknown',
                    status          TEXT NOT NULL DEFAULT 'SUSPICIOUS',
                    vehicle_type    TEXT NOT NULL DEFAULT '',
                    threat_level    TEXT NOT NULL DEFAULT 'HIGH',
                    notes           TEXT NOT NULL DEFAULT '',
                    flagged_date    TEXT
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

                -- Performance indexes
                CREATE INDEX IF NOT EXISTS idx_alerts_camera   ON alerts(camera_id);
                CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
                CREATE INDEX IF NOT EXISTS idx_alerts_status   ON alerts(status);
                CREATE INDEX IF NOT EXISTS idx_alerts_ts       ON alerts(timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_anpr_plate      ON anpr_watchlist(plate);
                CREATE INDEX IF NOT EXISTS idx_track_target    ON track_history(target_id, camera_id);
                CREATE INDEX IF NOT EXISTS idx_users_username  ON users(username);
            """)
            await db.commit()

            # Ensure GPS columns exist on existing databases (safe migration)
            for col, col_type in [
                ("latitude", "REAL"),
                ("longitude", "REAL"),
                ("altitude", "REAL"),
                ("gps_coords", "TEXT NOT NULL DEFAULT ''"),
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

            # Backfill initial camera coordinates if unset or old
            await db.execute("UPDATE cameras SET location='Noida Sector 28', latitude=28.5708, longitude=77.3271, altitude=200.0, gps_coords='28.5708° N, 77.3271° E' WHERE id='cam-01' AND (latitude IS NULL OR latitude > 30.0)")
            await db.execute("UPDATE cameras SET location='Gurgaon Cyber City', latitude=28.4949, longitude=77.0895, altitude=220.0, gps_coords='28.4949° N, 77.0895° E' WHERE id='cam-02' AND (latitude IS NULL OR latitude > 30.0)")
            await db.execute("UPDATE cameras SET location='Gurgaon Sector 29', latitude=28.4682, longitude=77.0620, altitude=215.0, gps_coords='28.4682° N, 77.0620° E' WHERE id='cam-03' AND (latitude IS NULL OR latitude > 30.0)")
            await db.execute("UPDATE cameras SET location='Noida Sector 132 Expressway', latitude=28.5085, longitude=77.3774, altitude=198.0, gps_coords='28.5085° N, 77.3774° E' WHERE id='cam-04' AND (latitude IS NULL OR latitude > 30.0)")
            await db.commit()

            log.info("Database schema initialised at %s", DB_PATH)

        # Seed demo data if database is empty
        await seed_initial_data_if_empty()
    except Exception as exc:
        log.critical("Failed to initialise database: %s", exc, exc_info=True)
        raise SystemExit(1) from exc


# ── Initial Data Seeding ──────────────────────────────────────────────────────

async def seed_initial_data_if_empty() -> None:
    """Populates default border cameras and watchlists if tables are empty."""
    async with get_db() as db:
        async with db.execute("SELECT COUNT(*) AS cnt FROM cameras") as cur:
            row = await cur.fetchone()
            if row and row["cnt"] > 0:
                return  # Database already seeded

        log.info("Seeding initial border cameras and intelligence watchlists …")
        now = datetime.datetime.utcnow().isoformat()

        # 1. Cameras
        cameras = [
            (
                "cam-01", "BOP-01", "North Ridge Perimeter",
                "Noida Sector 28",
                28.5708, 77.3271, 200.0, "28.5708° N, 77.3271° E",
                "public/videos/mumbai_traffic.mp4",
                "ONLINE", 30, "1080p FHD", "STANDARD",
                json.dumps(["HUMAN", "VEHICLE", "FRS", "ANPR"]),
                json.dumps([
                    {"x": 0.15, "y": 0.35}, {"x": 0.85, "y": 0.35},
                    {"x": 0.90, "y": 0.85}, {"x": 0.10, "y": 0.85},
                ]),
                5, now,
            ),
            (
                "cam-02", "BOP-04", "Riverine Marshland IR",
                "Gurgaon Cyber City",
                28.4949, 77.0895, 220.0, "28.4949° N, 77.0895° E",
                "public/videos/delhi_traffic.mp4",
                "ONLINE", 25, "1080p FHD", "THERMAL",
                json.dumps(["HUMAN", "VEHICLE", "FRS"]),
                json.dumps([
                    {"x": 0.20, "y": 0.40}, {"x": 0.80, "y": 0.40},
                    {"x": 0.75, "y": 0.90}, {"x": 0.25, "y": 0.90},
                ]),
                5, now,
            ),
            (
                "cam-03", "CHK-02", "Checkpoint Alpha Inspection",
                "Gurgaon Sector 29",
                28.4682, 77.0620, 215.0, "28.4682° N, 77.0620° E",
                "public/videos/bangalore_traffic.mp4",
                "ONLINE", 60, "4K Ultra HD", "ANPR_FOCUS",
                json.dumps(["VEHICLE", "ANPR"]),
                json.dumps([]),
                5, now,
            ),
            (
                "cam-04", "BOP-12", "South Gate FRS Scanner",
                "Noida Sector 132 Expressway",
                28.5085, 77.3774, 198.0, "28.5085° N, 77.3774° E",
                "public/videos/goa_traffic.mp4",
                "ONLINE", 30, "1080p FHD", "FRS_FOCUS",
                json.dumps(["HUMAN", "FRS"]),
                json.dumps([
                    {"x": 0.30, "y": 0.20}, {"x": 0.70, "y": 0.20},
                    {"x": 0.70, "y": 0.80}, {"x": 0.30, "y": 0.80},
                ]),
                5, now,
            ),
        ]
        await db.executemany(
            """INSERT INTO cameras
               (id, code, name, location, latitude, longitude, altitude, gps_coords,
                rtsp_url, status, fps, resolution,
                mode, analytics_modes, fence_points, rtsp_reconnect_attempts, last_frame_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            cameras,
        )

        # 2. FRS Watchlist
        subjects = [
            (
                "W-901", "Viktor K. Petrov", "The Fox", "High-Value Target", "CRITICAL",
                "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
                "Wanted for unauthorized border crossing & reconnaissance.",
                None, "BOP-04 Marshland", now, now,
            ),
            (
                "W-902", "Tariq Al-Mansoor", "Falcon", "Smuggling Suspect", "HIGH",
                "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80",
                "Associated with night perimeter breaches.",
                None, "BOP-12 South Gate", now, now,
            ),
            (
                "W-903", "Elena Rostova", "Shadow", "Persons of Interest", "MEDIUM",
                "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
                "Frequent movement around Sector 7 buffer zone.",
                None, "CHK-02 Checkpoint", now, now,
            ),
        ]
        await db.executemany(
            """INSERT INTO frs_watchlist
               (id, name, alias, category, threat_level, avatar_url, notes,
                face_embedding, last_seen, last_seen_at, enrolled_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            subjects,
        )

        # 3. ANPR Watchlist
        vehicles = [
            (
                "JK-02-AX-8912", "Unknown / Suspicious", "WANTED",
                "Heavy Utility Truck", "CRITICAL",
                "Reported stolen from border staging warehouse.", "2026-09-02",
            ),
            (
                "PB-10-CZ-4401", "Ramanjit Singh", "SUSPICIOUS",
                "Armored SUV / 4x4", "HIGH",
                "Unregistered border transit route.", "2026-09-05",
            ),
            (
                "HR-26-BQ-7719", "Defense Logistics Corp", "PERMITTED",
                "Cargo Supply Truck", "LOW",
                "Cleared supply convoy clearance.", "2026-09-01",
            ),
        ]
        await db.executemany(
            """INSERT INTO anpr_watchlist
               (plate, owner, status, vehicle_type, threat_level, notes, flagged_date)
               VALUES (?,?,?,?,?,?,?)""",
            vehicles,
        )

        await db.commit()
        log.info("Initial demo dataset seeded successfully.")


# ── Camera CRUD ───────────────────────────────────────────────────────────────

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


# ── Alert CRUD ────────────────────────────────────────────────────────────────

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


# ── FRS Watchlist CRUD ────────────────────────────────────────────────────────

async def save_frs_subject(subject: WatchlistSubject) -> None:
    async with get_db() as db:
        await db.execute(
            """INSERT OR REPLACE INTO frs_watchlist
               (id, name, alias, category, threat_level, avatar_url, notes,
                face_embedding, last_seen, last_seen_at, enrolled_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (
                subject.id, subject.name, subject.alias, subject.category,
                subject.threat_level, subject.avatar_url, subject.notes,
                json.dumps(subject.face_embedding) if subject.face_embedding else None,
                subject.last_seen,
                subject.last_seen_at.isoformat() if subject.last_seen_at else None,
                subject.enrolled_at.isoformat(),
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


async def update_frs_embedding(subject_id: str, embedding: List[float]) -> None:
    async with get_db() as db:
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
    )


# ── ANPR Watchlist CRUD ───────────────────────────────────────────────────────

async def save_anpr_vehicle(vehicle: WatchlistVehicle) -> None:
    async with get_db() as db:
        await db.execute(
            """INSERT OR REPLACE INTO anpr_watchlist
               (plate, owner, status, vehicle_type, threat_level, notes, flagged_date)
               VALUES (?,?,?,?,?,?,?)""",
            (
                vehicle.plate.upper(), vehicle.owner, vehicle.status,
                vehicle.vehicle_type, vehicle.threat_level, vehicle.notes,
                vehicle.flagged_date,
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
    return WatchlistVehicle(
        plate=d["plate"], owner=d["owner"] or "Unknown",
        status=d["status"], vehicle_type=d["vehicle_type"] or "",
        threat_level=d["threat_level"], notes=d["notes"] or "",
        flagged_date=d["flagged_date"],
    )


# ── Snapshot CRUD ─────────────────────────────────────────────────────────────

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


# ── Analytics helpers ─────────────────────────────────────────────────────────

async def get_alert_summary(hours: int = 24) -> dict:
    """Return threat counts by severity and category for the last N hours."""
    since = (datetime.datetime.utcnow() - datetime.timedelta(hours=hours)).isoformat()
    async with get_db() as db:
        async with db.execute(
            "SELECT severity, COUNT(*) AS cnt FROM alerts WHERE timestamp >= ? GROUP BY severity",
            (since,),
        ) as cur:
            severity_rows = await cur.fetchall()
        async with db.execute(
            "SELECT category, COUNT(*) AS cnt FROM alerts WHERE timestamp >= ? GROUP BY category",
            (since,),
        ) as cur:
            category_rows = await cur.fetchall()
        async with db.execute(
            "SELECT COUNT(*) AS cnt FROM alerts WHERE timestamp >= ?", (since,)
        ) as cur:
            total = (await cur.fetchone())["cnt"]

    return {
        "total": total,
        "hours": hours,
        "by_severity": {r["severity"]: r["cnt"] for r in severity_rows},
        "by_category": {r["category"]: r["cnt"] for r in category_rows},
    }


# ── User & Auth helpers ───────────────────────────────────────────────────────

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

