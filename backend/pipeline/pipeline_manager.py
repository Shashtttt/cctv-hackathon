"""
IBVAP — Pipeline Manager
Orchestrates one CameraWorker process per camera using ProcessPoolExecutor.
Bridges multiprocessing result queue → FastAPI async alert broadcaster.
"""

from __future__ import annotations

import asyncio
import datetime
import io
import logging
import multiprocessing as mp
import os
import threading
import time
import uuid
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Callable, Dict, List, Optional, Set

from ..config import settings
from ..database.db import (
    get_all_cameras, get_anpr_watchlist, get_frs_watchlist,
    save_alert, save_snapshot, update_camera_status,
)
from ..database.models import AlertRecord, CameraConfig, FrameResult, SnapshotRecord
from .camera_worker import CameraWorker

log = logging.getLogger("ibvap.pipeline.manager")


# ────────────────────────────────────────────────────────────────────────────
# Worker process entry-point (must be top-level for multiprocessing to pickle)
# ────────────────────────────────────────────────────────────────────────────

def _run_worker(
    camera_dict: dict,
    result_queue: "mp.Queue",
    stop_event: "mp.Event",
    watchlist_frs: list,
    watchlist_anpr_plates: list,
) -> None:
    """
    Top-level function executed in a child process by ProcessPoolExecutor.
    Reconstructs CameraConfig from dict (to survive pickling) and runs the worker.
    """
    import logging
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(name)s] %(levelname)s %(message)s")

    from ..database.models import CameraConfig
    cam = CameraConfig(**camera_dict)
    worker = CameraWorker(
        camera=cam,
        result_queue=result_queue,
        stop_event=stop_event,
        watchlist_frs=watchlist_frs,
        watchlist_anpr=watchlist_anpr_plates,
    )
    worker.run()


# ────────────────────────────────────────────────────────────────────────────
# Pipeline Manager
# ────────────────────────────────────────────────────────────────────────────

class PipelineManager:
    """
    Singleton that manages all camera worker processes.
    Created once in FastAPI lifespan and torn down on shutdown.

    Usage:
        manager = PipelineManager()
        await manager.start()          # spawns workers
        manager.register_alert_cb(cb)  # async callback for alert broadcast
        await manager.stop()           # graceful shutdown
    """

    def __init__(self) -> None:
        self._workers: Dict[str, mp.Process] = {}
        self._stop_events: Dict[str, mp.Event] = {}

        # Shared result queue (all workers push here)
        self._result_q: mp.Queue = mp.Queue(maxsize=settings.RESULT_QUEUE_MAX_SIZE)

        # Alert callbacks registered by FastAPI WebSocket layer
        self._alert_callbacks: List[Callable] = []

        # Background thread that drains result_q and calls callbacks
        self._drain_thread: Optional[threading.Thread] = None
        self._running = False

        # Active camera registry
        self._cameras: Dict[str, CameraConfig] = {}

        # Latest annotated JPEG frames per camera (cam_id -> bytes)
        self._latest_frames: Dict[str, bytes] = {}

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def start(self) -> None:
        """
        Load all cameras from DB, spawn one worker process per camera,
        start the result drainer thread.
        """
        log.info("PipelineManager starting …")
        settings.ensure_dirs()
        settings.warn_missing_models()

        # Load cameras and watchlists from DB
        cameras      = await get_all_cameras()
        frs_subjects = await get_frs_watchlist()
        anpr_vehicles = await get_anpr_watchlist()

        frs_list = [
            {
                "id": s.id, "name": s.name, "threat_level": s.threat_level,
                "face_embedding": s.face_embedding,
            }
            for s in frs_subjects
        ]
        anpr_plates = [v.plate for v in anpr_vehicles]

        if not cameras:
            log.warning("No cameras registered in DB. Workers will start when cameras are added.")

        for cam in cameras:
            self._spawn_worker(cam, frs_list, anpr_plates)

        self._running = True
        self._drain_thread = threading.Thread(
            target=self._drain_result_queue,
            name="pipeline-drainer",
            daemon=True,
        )
        self._drain_thread.start()
        log.info("PipelineManager started. %d camera workers spawned.", len(self._workers))

    async def stop(self) -> None:
        """Signal all workers to stop and wait for them."""
        log.info("PipelineManager shutting down …")
        self._running = False

        for cam_id, event in self._stop_events.items():
            event.set()

        for cam_id, proc in self._workers.items():
            proc.join(timeout=10)
            if proc.is_alive():
                log.warning("Worker for %s did not stop cleanly — terminating.", cam_id)
                proc.terminate()

        self._workers.clear()
        self._stop_events.clear()
        self._cameras.clear()
        log.info("PipelineManager stopped.")

    # ── Camera hot-plug ───────────────────────────────────────────────────────

    async def add_camera(self, camera: CameraConfig) -> None:
        """Hot-add a new camera and spawn its worker."""
        if camera.id in self._workers:
            log.warning("Camera %s already has a running worker.", camera.id)
            return
        frs_subjects  = await get_frs_watchlist()
        anpr_vehicles = await get_anpr_watchlist()
        frs_list = [
            {"id": s.id, "name": s.name, "threat_level": s.threat_level,
             "face_embedding": s.face_embedding}
            for s in frs_subjects
        ]
        anpr_plates = [v.plate for v in anpr_vehicles]
        self._spawn_worker(camera, frs_list, anpr_plates)
        log.info("Camera %s added and worker spawned.", camera.id)

    async def remove_camera(self, cam_id: str) -> None:
        """Stop and remove a camera worker."""
        if cam_id not in self._workers:
            return
        self._stop_events[cam_id].set()
        self._workers[cam_id].join(timeout=10)
        if self._workers[cam_id].is_alive():
            self._workers[cam_id].terminate()
        del self._workers[cam_id]
        del self._stop_events[cam_id]
        self._cameras.pop(cam_id, None)
        log.info("Camera %s worker removed.", cam_id)

    async def update_fence(self, cam_id: str, fence_points: list) -> None:
        """
        Update the virtual fence for a camera.
        Since workers are separate processes, we restart the worker
        with the new config (simplest safe approach).
        """
        cam = self._cameras.get(cam_id)
        if cam:
            await self.remove_camera(cam_id)
            cam.fence_points = fence_points
            await self.add_camera(cam)
            log.info("Fence updated for %s — worker restarted.", cam_id)

    async def reload_watchlists(self) -> None:
        """Reload FRS and ANPR watchlists — restarts all workers."""
        log.info("Reloading watchlists — restarting all workers …")
        camera_list = list(self._cameras.values())
        await self.stop()
        for cam in camera_list:
            self._cameras[cam.id] = cam
        await self.start()

    # ── Alert callback registration ───────────────────────────────────────────

    def register_alert_callback(self, cb: Callable) -> None:
        """Register an async callback that receives AlertRecord on each new alert."""
        self._alert_callbacks.append(cb)

    def unregister_alert_callback(self, cb: Callable) -> None:
        self._alert_callbacks = [c for c in self._alert_callbacks if c is not cb]

    # ── Internal: spawn worker process ────────────────────────────────────────

    def _spawn_worker(
        self,
        camera: CameraConfig,
        frs_list: list,
        anpr_plates: list,
    ) -> None:
        stop_event = mp.Event()
        self._stop_events[camera.id] = stop_event
        self._cameras[camera.id] = camera

        # Serialise CameraConfig to plain dict for pickling
        cam_dict = {
            "id": camera.id, "code": camera.code, "name": camera.name,
            "location": camera.location, "rtsp_url": camera.rtsp_url,
            "status": camera.status, "fps": camera.fps,
            "resolution": camera.resolution, "mode": camera.mode,
            "analytics_modes": camera.analytics_modes,
            "fence_points": camera.fence_points,
            "rtsp_reconnect_attempts": camera.rtsp_reconnect_attempts,
        }

        proc = mp.Process(
            target=_run_worker,
            args=(cam_dict, self._result_q, stop_event, frs_list, anpr_plates),
            name=f"worker-{camera.code}",
            daemon=True,
        )
        proc.start()
        self._workers[camera.id] = proc
        log.info("[%s] Worker process PID %d spawned.", camera.code, proc.pid)

    # ── Result drain thread ───────────────────────────────────────────────────

    def _drain_result_queue(self) -> None:
        """
        Blocking thread: reads FrameResult objects from the shared mp.Queue,
        persists alerts to DB, saves snapshots, and fires async callbacks.
        """
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        while self._running:
            try:
                result: FrameResult = self._result_q.get(timeout=1.0)
            except Exception:
                continue

            if result.annotated_frame_jpg:
                self._latest_frames[result.camera_id] = result.annotated_frame_jpg

            if result.alerts:
                loop.run_until_complete(
                    self._persist_and_broadcast(result)
                )

        loop.close()

    def get_latest_frame(self, cam_id: str) -> Optional[bytes]:
        """Return the latest annotated JPEG frame bytes for a camera."""
        return self._latest_frames.get(cam_id)

    async def _persist_and_broadcast(self, result: FrameResult) -> None:
        """Save alerts + snapshots to DB and call all registered callbacks."""
        for alert in result.alerts:
            # Persist to DB
            try:
                await save_alert(alert)
            except Exception as exc:
                log.error("Failed to save alert %s: %s", alert.id, exc)

            # Save snapshot JPEG if available
            if result.annotated_frame_jpg and alert.id:
                snap_path = self._save_snapshot(result, alert.id)
                alert.snapshot_path = snap_path
                if snap_path:
                    snap = SnapshotRecord(
                        alert_id=alert.id,
                        camera_id=result.camera_id,
                        frame_number=result.frame_number,
                        file_path=snap_path,
                        captured_at=result.timestamp,
                        file_size_bytes=len(result.annotated_frame_jpg),
                    )
                    try:
                        await save_snapshot(snap)
                    except Exception as exc:
                        log.error("Failed to save snapshot: %s", exc)

            # Fire all async alert callbacks (WebSocket broadcasters)
            for cb in self._alert_callbacks:
                try:
                    if asyncio.iscoroutinefunction(cb):
                        await cb(alert)
                    else:
                        cb(alert)
                except Exception as exc:
                    log.error("Alert callback error: %s", exc)

    def _save_snapshot(self, result: FrameResult, alert_id: str) -> Optional[str]:
        """Write annotated JPEG to disk. Returns path string or None."""
        if not result.annotated_frame_jpg:
            return None
        try:
            snap_dir: Path = settings.SNAPSHOT_DIR / result.camera_id
            snap_dir.mkdir(parents=True, exist_ok=True)
            filename = f"{alert_id}_{result.frame_number}.jpg"
            file_path = snap_dir / filename
            file_path.write_bytes(result.annotated_frame_jpg)
            return str(file_path)
        except Exception as exc:
            log.error("Snapshot save error: %s", exc)
            return None

    # ── Status API ────────────────────────────────────────────────────────────

    def update_latest_frame(self, cam_id: str, frame_bytes: bytes) -> None:
        """Manually update the latest frame for a camera."""
        self._latest_frames[cam_id] = frame_bytes

    async def ingest_frame_result(self, result: FrameResult) -> None:
        """Handle externally processed frame result (e.g. from direct webcam ingest)."""
        if result.annotated_frame_jpg:
            self._latest_frames[result.camera_id] = result.annotated_frame_jpg
        if result.alerts:
            await self._persist_and_broadcast(result)

    def get_worker_statuses(self) -> Dict[str, dict]:
        """Return liveness status of all worker processes."""
        return {
            cam_id: {
                "pid": proc.pid,
                "alive": proc.is_alive(),
                "exit_code": proc.exitcode,
            }
            for cam_id, proc in self._workers.items()
        }

    def result_queue_depth(self) -> int:
        """Return approximate number of unprocessed results in the queue."""
        try:
            return self._result_q.qsize()
        except Exception:
            return -1


# Singleton instance created at FastAPI startup
pipeline_manager = PipelineManager()
