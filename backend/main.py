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
from .database.db import init_db, load_blockchain_from_db
from .database.models import AlertRecord
from .pipeline.pipeline_manager import pipeline_manager
from .routers import alerts, analytics, anpr, auth, cameras, frs, snapshots, blockchain
from .schemas import HealthResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("ibvap.main")


class ConnectionManager:
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
        async with self._lock:
            targets = set(self._connections)

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


async def _on_alert(alert: AlertRecord) -> None:
    await ws_manager.broadcast({
        "type": "ALERT",
        "payload": alert.to_dict(),
    })


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting IBVAP surveillance platform...")

    await init_db()
    await load_blockchain_from_db()

    pipeline_manager.register_alert_callback(_on_alert)
    await pipeline_manager.start()

    from .pipeline.ip_camera_manager import ip_camera_manager
    from .database.db import get_all_cameras
    try:
        registered_cams = await get_all_cameras()
        for cam in registered_cams:
            url = (cam.rtsp_url or "").strip().lower()
            if url and not url.startswith("synthetic") and not url.startswith("mobile://"):
                ip_camera_manager.start_camera(cam)
    except Exception as exc:
        log.warning("Could not auto-start IP cameras: %s", exc)

    async def _warmup_ai():
        try:
            from .ai.direct_analyzer import DirectAIAnalyzer
            import numpy as np
            analyzer = DirectAIAnalyzer.get_instance()
            dummy = np.zeros((320, 320, 3), dtype=np.uint8)
            await asyncio.to_thread(analyzer.process_frame, dummy, "cam-warmup", "WARMUP")
            log.info("DirectAIAnalyzer neural engines pre-warmed.")
        except Exception as w_err:
            log.warning("AI warmup background task exception: %s", w_err)

    asyncio.create_task(_warmup_ai())

    log.info("IBVAP platform ready. Listening for connections.")
    yield

    log.info("IBVAP shutting down...")
    for cam_id in list(ip_camera_manager._streamers.keys()):
        ip_camera_manager.stop_camera(cam_id)
    await pipeline_manager.stop()
    log.info("Shutdown complete.")


app = FastAPI(
    title=settings.PROJECT_NAME,
    version="2.0.0",
    description="AI-Driven Border Surveillance Analytics Platform",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_origin_regex=r"^https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def api_key_middleware(request: Request, call_next):
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


prefix = settings.API_V1_STR
app.include_router(auth.router,       prefix=prefix)
app.include_router(cameras.router,    prefix=prefix)
app.include_router(alerts.router,     prefix=prefix)
app.include_router(frs.router,        prefix=prefix)
app.include_router(anpr.router,       prefix=prefix)
app.include_router(analytics.router,  prefix=prefix)
app.include_router(snapshots.router,  prefix=prefix)
app.include_router(blockchain.router, prefix=prefix)

if settings.SNAPSHOT_DIR.exists():
    app.mount("/snapshots", StaticFiles(directory=str(settings.SNAPSHOT_DIR)), name="snapshots")


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


@app.websocket("/ws/alerts")
async def alert_websocket(ws: WebSocket):
    await ws_manager.connect(ws)

    await ws.send_text(json.dumps({"type": "CONNECTED", "payload": {
        "message": "IBVAP Alert Stream active.",
        "platform": settings.PROJECT_NAME,
    }}))

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
            data = await ws.receive_text()
            if data == "CLOSE":
                break
    except WebSocketDisconnect:
        pass
    finally:
        ping_task.cancel()
        await ws_manager.disconnect(ws)


@app.websocket("/ws/stream/{cam_id}")
async def frame_stream(ws: WebSocket, cam_id: str):
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
