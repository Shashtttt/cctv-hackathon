"""
IBVAP — FastAPI Application Entry Point
Implements:
  • Lifespan context (startup/shutdown)
  • Secure WebSocket broadcast with error isolation
  • API key middleware
  • All REST routers
  • CORS with explicit origin whitelist
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from contextlib import asynccontextmanager
from typing import Set

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .database.db import init_db
from .database.models import AlertRecord
from .pipeline.pipeline_manager import pipeline_manager
from .routers import alerts, analytics, anpr, auth, cameras, frs, snapshots
from .schemas import HealthResponse

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("ibvap.main")


# ── WebSocket connection manager ──────────────────────────────────────────────

class ConnectionManager:
    """Thread-safe WebSocket connection pool with safe broadcast."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._connections: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._connections.add(ws)
        log.info("WebSocket client connected. Total: %d", len(self._connections))

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(ws)
        log.info("WebSocket client disconnected. Remaining: %d", len(self._connections))

    async def broadcast(self, payload: dict) -> None:
        """
        Send payload to all connected clients concurrently.
        Isolates individual send failures so one dead client never stops others.
        """
        async with self._lock:
            targets = set(self._connections)   # snapshot to avoid mutation during iteration

        if not targets:
            return

        text = json.dumps(payload)
        dead: Set[WebSocket] = set()

        async def _send_one(ws: WebSocket) -> None:
            try:
                await ws.send_text(text)
            except (WebSocketDisconnect, Exception):
                dead.add(ws)

        await asyncio.gather(*[_send_one(ws) for ws in targets], return_exceptions=True)

        if dead:
            async with self._lock:
                self._connections -= dead
            log.debug("Removed %d dead WebSocket connections.", len(dead))


ws_manager = ConnectionManager()


# ── Alert callback (pipeline → WebSocket broadcast) ──────────────────────────

async def _on_alert(alert: AlertRecord) -> None:
    """Broadcast a new alert to all connected WebSocket clients."""
    await ws_manager.broadcast({
        "type": "ALERT",
        "payload": alert.to_dict(),
    })


# ── FastAPI lifespan ──────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup: initialise DB, start pipeline workers.
    Shutdown: gracefully stop all workers.
    """
    log.info("=" * 60)
    log.info(" IBVAP — Intelligent Border Video Analytics Platform")
    log.info("=" * 60)

    # Initialise database
    await init_db()

    # Register WebSocket alert callback
    pipeline_manager.register_alert_callback(_on_alert)

    # Start AI pipeline (spawns camera worker processes)
    await pipeline_manager.start()

    log.info("IBVAP platform ready. Listening for connections …")
    yield

    # Graceful shutdown
    log.info("IBVAP shutting down …")
    await pipeline_manager.stop()
    log.info("Shutdown complete.")


# ── App creation ──────────────────────────────────────────────────────────────

app = FastAPI(
    title=settings.PROJECT_NAME,
    version="2.0.0",
    description="AI-Driven Border Surveillance Analytics Platform",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# ── CORS ──────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_origin_regex=r"^https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── API Key middleware ────────────────────────────────────────────────────────

@app.middleware("http")
async def api_key_middleware(request: Request, call_next):
    """
    Validate X-API-Key header on all /api/v1 routes.
    Skips /api/docs, /api/health, and WebSocket upgrade requests.
    """
    path = request.url.path
    exempt_prefixes = ("/api/docs", "/api/redoc", "/api/openapi", "/api/health", "/ws")
    if path.startswith(settings.API_V1_STR) and not any(path.startswith(e) for e in exempt_prefixes):
        if settings.ENV != "development":
            key = request.headers.get("X-API-Key", "")
            if key != settings.API_SECRET_KEY:
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Invalid or missing X-API-Key header."},
                )
    return await call_next(request)


# ── REST Routers ──────────────────────────────────────────────────────────────

prefix = settings.API_V1_STR
app.include_router(auth.router,      prefix=prefix)
app.include_router(cameras.router,   prefix=prefix)
app.include_router(alerts.router,    prefix=prefix)
app.include_router(frs.router,       prefix=prefix)
app.include_router(anpr.router,      prefix=prefix)
app.include_router(analytics.router, prefix=prefix)
app.include_router(snapshots.router, prefix=prefix)

# Mount snapshots static folder for direct image access
if settings.SNAPSHOT_DIR.exists():
    app.mount("/snapshots", StaticFiles(directory=str(settings.SNAPSHOT_DIR)), name="snapshots")


# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/api/health", response_model=HealthResponse, tags=["System"])
async def health_check():
    statuses = pipeline_manager.get_worker_statuses()
    active = sum(1 for s in statuses.values() if s["alive"])
    return HealthResponse(
        status="OPERATIONAL",
        platform=settings.PROJECT_NAME,
        version="2.0.0",
        ai_engine="YOLOv8-pose + YuNet + SFace + EasyOCR",
        active_cameras=active,
        queue_depth=pipeline_manager.result_queue_depth(),
    )


# ── WebSocket alert stream ────────────────────────────────────────────────────

@app.websocket("/ws/alerts")
async def alert_websocket(ws: WebSocket):
    """
    Real-time alert stream. Clients receive JSON messages:
      {"type": "ALERT", "payload": {...}}
      {"type": "PING",  "payload": null}
    """
    await ws_manager.connect(ws)

    # Send initial handshake
    await ws.send_text(json.dumps({"type": "CONNECTED", "payload": {
        "message": "IBVAP Alert Stream active.",
        "platform": settings.PROJECT_NAME,
    }}))

    # Keepalive ping every 30 seconds
    async def _ping():
        while True:
            await asyncio.sleep(30)
            try:
                await ws.send_text(json.dumps({"type": "PING", "payload": None}))
            except Exception:
                break

    ping_task = asyncio.create_task(_ping())

    try:
        while True:
            # Keep connection alive; ignore incoming messages (read-only stream)
            data = await ws.receive_text()
            if data == "CLOSE":
                break
    except WebSocketDisconnect:
        pass
    finally:
        ping_task.cancel()
        await ws_manager.disconnect(ws)


# ── WebSocket live frame stream ───────────────────────────────────────────────

@app.websocket("/ws/stream/{cam_id}")
async def frame_stream(ws: WebSocket, cam_id: str):
    """
    Stream annotated JPEG frames for a specific camera as binary WebSocket messages.
    Clients receive binary JPEG bytes at ~15 fps.
    """
    await ws.accept()
    log.info("Frame stream opened for camera %s", cam_id)
    try:
        while True:
            frame_bytes = pipeline_manager.get_latest_frame(cam_id)
            if frame_bytes:
                await ws.send_bytes(frame_bytes)
            else:
                await ws.send_text(json.dumps({"type": "WAITING_FOR_FRAME", "camera_id": cam_id}))
            await asyncio.sleep(0.066)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.debug("Frame stream disconnected for %s: %s", cam_id, exc)
    finally:
        log.info("Frame stream closed for camera %s", cam_id)
