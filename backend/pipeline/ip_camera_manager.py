"""
IBVAP — IP Camera & External Device Stream Manager
Manages real-time capture and live AI inference for external IP cameras,
smartphones (via IP Webcam, DroidCam), RTSP CCTV streams, and HTTP MJPEG feeds.
"""

from __future__ import annotations

import asyncio
import base64
import datetime
import io
import logging
import socket
import sys
import threading
import time
from typing import Dict, List, Optional, Tuple
import urllib.request

import cv2
import numpy as np

from ..ai.direct_analyzer import DirectAIAnalyzer
from ..config import settings
from ..database.models import CameraConfig, FrameResult
from .pipeline_manager import pipeline_manager

log = logging.getLogger("ibvap.pipeline.ip_camera")


def get_lan_ip() -> str:
    """Detect local LAN IP for cross-device mobile pairing."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


class IPCameraStreamer:
    """
    Dedicated worker thread per active external IP camera.
    Continuously ingests video frames, runs AI detection (weapons, pose, intrusion),
    updates the latest annotated frame, and triggers alerts.
    """

    def __init__(self, camera: CameraConfig) -> None:
        self.camera = camera
        self.camera_id = camera.id
        self.camera_code = camera.code or camera.id.upper()
        self.stream_url = camera.rtsp_url.strip()
        self.target_fps = max(5, min(camera.fps or 20, 30))
        self.is_running = False
        self.thread: Optional[threading.Thread] = None
        self.last_frame_bytes: Optional[bytes] = None
        self.last_status = "CONNECTING"
        self.last_error: Optional[str] = None
        self.fps_actual = 0.0
        self.last_frame_time = 0.0
        self.total_frames_processed = 0

    def start(self) -> None:
        if self.is_running:
            return
        self.is_running = True
        self.thread = threading.Thread(
            target=self._run_loop,
            name=f"ip-stream-{self.camera_id}",
            daemon=True,
        )
        self.thread.start()
        log.info("[%s] Started IP Camera Streamer for: %s", self.camera_code, self.stream_url)

    def stop(self) -> None:
        self.is_running = False
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2.0)
        log.info("[%s] Stopped IP Camera Streamer", self.camera_code)

    def _is_snapshot_url(self, url: str) -> bool:
        lower = url.lower()
        return lower.endswith(".jpg") or lower.endswith(".jpeg") or "/shot.jpg" in lower or "/snapshot" in lower

    def _fetch_snapshot_frame(self, url: str) -> Optional[np.ndarray]:
        """Fetch a single frame from an HTTP snapshot URL (e.g. IP Webcam /shot.jpg)."""
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "IBVAP-Surveillance/2.0"},
            )
            with urllib.request.urlopen(req, timeout=3.0) as response:
                img_data = response.read()
                if img_data:
                    nparr = np.frombuffer(img_data, np.uint8)
                    return cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        except Exception as exc:
            self.last_error = str(exc)
        return None

    def _run_loop(self) -> None:
        analyzer = DirectAIAnalyzer.get_instance()
        frame_interval = 1.0 / self.target_fps
        url = self.stream_url
        is_snapshot = self._is_snapshot_url(url)

        cap = None
        reconnect_attempts = 0
        frame_count = 0
        fps_timer = time.time()

        while self.is_running:
            t0 = time.time()

            frame_bgr: Optional[np.ndarray] = None

            if is_snapshot:
                frame_bgr = self._fetch_snapshot_frame(url)
                if frame_bgr is None:
                    self.last_status = "CONNECTING"
                    time.sleep(1.0)
                    continue
                self.last_status = "ONLINE"
            else:
                # VideoCapture for RTSP, HTTP MJPEG, or local device
                if cap is None or not cap.isOpened():
                    self.last_status = "CONNECTING"
                    try:
                        clean_url = url.replace("device:", "").replace("camera:", "").strip()
                        if clean_url.isdigit():
                            dev_backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
                            cap = cv2.VideoCapture(int(clean_url), dev_backend)
                        else:
                            cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)

                        if cap and cap.isOpened():
                            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                            self.last_status = "ONLINE"
                            reconnect_attempts = 0
                            log.info("[%s] Successfully connected to stream.", self.camera_code)
                        else:
                            reconnect_attempts += 1
                            self.last_status = "CONNECTING"
                            time.sleep(2.0)
                            continue
                    except Exception as exc:
                        log.warning("[%s] VideoCapture error: %s", self.camera_code, exc)
                        time.sleep(2.0)
                        continue

                ret, frame = cap.read()
                if not ret or frame is None:
                    reconnect_attempts += 1
                    if cap:
                        cap.release()
                    cap = None
                    self.last_status = "RECONNECTING"
                    time.sleep(1.5)
                    continue

                frame_bgr = frame
                self.last_status = "ONLINE"

            # Frame received — run Direct AI Analysis
            if frame_bgr is not None and frame_bgr.size > 0:
                try:
                    result: FrameResult = analyzer.process_frame(
                        frame_bgr=frame_bgr,
                        camera_id=self.camera_id,
                        camera_code=self.camera_code,
                        fence_points=self.camera.fence_points or [],
                        analytics_modes=self.camera.analytics_modes or ["INTRUSION", "WEAPON", "PERSON"],
                        annotate=True,
                        gps_info=self.camera.location or self.camera.gps_coords,
                    )

                    # Update latest frame bytes in pipeline manager
                    if result.annotated_frame_jpg:
                        self.last_frame_bytes = result.annotated_frame_jpg
                        pipeline_manager.update_latest_frame(self.camera_id, result.annotated_frame_jpg)

                    # Ingest result asynchronously if alerts triggered
                    if result.alerts:
                        try:
                            asyncio.run(pipeline_manager.ingest_frame_result(result))
                        except Exception as a_exc:
                            log.debug("[%s] Alert persist: %s", self.camera_code, a_exc)
                    elif result.detections and result.annotated_frame_jpg:
                        try:
                            pipeline_manager._save_categorized_snapshots(result, result.annotated_frame_jpg)
                        except Exception:
                            pass

                    self.total_frames_processed += 1
                    self.last_frame_time = time.time()
                except Exception as exc:
                    log.error("[%s] AI processing error: %s", self.camera_code, exc)

            # Update FPS tracking
            frame_count += 1
            if time.time() - fps_timer >= 1.0:
                self.fps_actual = round(frame_count / (time.time() - fps_timer), 1)
                frame_count = 0
                fps_timer = time.time()

            # Pace loop to target FPS
            elapsed = time.time() - t0
            sleep_needed = frame_interval - elapsed
            if sleep_needed > 0:
                time.sleep(sleep_needed)

        if cap and cap.isOpened():
            cap.release()


class IPCameraManager:
    """
    Central coordinator for all external IP camera streams.
    """

    def __init__(self) -> None:
        self._streamers: Dict[str, IPCameraStreamer] = {}
        self._lock = threading.Lock()

    def start_camera(self, camera: CameraConfig) -> bool:
        """Start stream ingest worker for an external IP camera."""
        url = (camera.rtsp_url or "").strip()
        # Only start streamer if it has a valid external URL
        if not url or url.startswith("synthetic") or url in ("test", "demo"):
            log.info("Skipping streamer for non-network feed: %s", camera.id)
            return False

        with self._lock:
            # Stop existing if any
            if camera.id in self._streamers:
                self._streamers[camera.id].stop()
            streamer = IPCameraStreamer(camera)
            self._streamers[camera.id] = streamer
            streamer.start()
            return True

    def stop_camera(self, camera_id: str) -> None:
        """Stop streamer for a camera."""
        with self._lock:
            streamer = self._streamers.pop(camera_id, None)
            if streamer:
                streamer.stop()

    def get_streamer(self, camera_id: str) -> Optional[IPCameraStreamer]:
        return self._streamers.get(camera_id)

    def get_latest_frame(self, camera_id: str) -> Optional[bytes]:
        streamer = self._streamers.get(camera_id)
        if streamer and streamer.last_frame_bytes:
            return streamer.last_frame_bytes
        return None

    def get_status(self, camera_id: str) -> dict:
        streamer = self._streamers.get(camera_id)
        if not streamer:
            return {"active": False, "status": "OFFLINE", "fps": 0}
        return {
            "active": streamer.is_running,
            "status": streamer.last_status,
            "fps": streamer.fps_actual,
            "processed": streamer.total_frames_processed,
            "last_frame_time": streamer.last_frame_time,
        }

    @staticmethod
    def test_stream_url(url: str, timeout: float = 4.0) -> dict:
        """
        Verify stream connectivity and return preview snapshot + metadata.
        """
        url = url.strip()
        if not url:
            return {"reachable": False, "error": "Stream URL cannot be empty."}

        t0 = time.time()
        lower = url.lower()
        frame_bgr: Optional[np.ndarray] = None

        # 1. Check if snapshot URL
        if lower.endswith(".jpg") or lower.endswith(".jpeg") or "/shot.jpg" in lower or "/snapshot" in lower:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "IBVAP-Surveillance/2.0"})
                with urllib.request.urlopen(req, timeout=timeout) as response:
                    data = response.read()
                    if data:
                        nparr = np.frombuffer(data, np.uint8)
                        frame_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            except Exception as exc:
                return {
                    "reachable": False,
                    "latency_ms": int((time.time() - t0) * 1000),
                    "error": f"Snapshot connection failed: {str(exc)}",
                }
        else:
            # 2. Try cv2.VideoCapture
            cap = None
            try:
                dev = int(url) if url.isdigit() else url
                cap = cv2.VideoCapture(dev, cv2.CAP_FFMPEG if isinstance(dev, str) else cv2.CAP_ANY)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                
                # Try reading one frame with timeout
                if cap.isOpened():
                    ret, frame = cap.read()
                    if ret and frame is not None and frame.size > 0:
                        frame_bgr = frame
                else:
                    return {
                        "reachable": False,
                        "latency_ms": int((time.time() - t0) * 1000),
                        "error": "Could not open video stream. Verify IP address, port, and Wi-Fi connection.",
                    }
            except Exception as exc:
                return {
                    "reachable": False,
                    "latency_ms": int((time.time() - t0) * 1000),
                    "error": f"Stream error: {str(exc)}",
                }
            finally:
                if cap:
                    cap.release()

        if frame_bgr is not None and frame_bgr.size > 0:
            h, w = frame_bgr.shape[:2]
            latency_ms = int((time.time() - t0) * 1000)

            # Resize preview thumbnail to 480px width for fast transit
            preview_w = 480
            preview_h = int(h * (preview_w / w))
            resized = cv2.resize(frame_bgr, (preview_w, preview_h), interpolation=cv2.INTER_AREA)

            # Watermark tactical preview tag
            cv2.putText(
                resized,
                f"STREAM VERIFIED | {w}x{h} | {latency_ms}ms",
                (12, 28),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (0, 242, 254),
                2,
                cv2.LINE_AA,
            )

            _, buf = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, 80])
            b64_preview = "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()

            return {
                "reachable": True,
                "latency_ms": latency_ms,
                "resolution": f"{w}x{h}",
                "fps": 25,
                "preview_base64": b64_preview,
            }

        return {
            "reachable": False,
            "latency_ms": int((time.time() - t0) * 1000),
            "error": "Stream opened but returned no valid video frames.",
        }


# Singleton instance
ip_camera_manager = IPCameraManager()
