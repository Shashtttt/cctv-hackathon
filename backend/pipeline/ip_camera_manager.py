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
import os
import socket
import sys
import threading
import time
from typing import Dict, List, Optional, Tuple
import urllib.request
import requests

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


def _normalize_stream_url(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return ""
    lower = url.lower()
    if lower.startswith("http://") or lower.startswith("https://") or lower.startswith("rtsp://"):
        return url
    if lower.startswith("device:") or lower.startswith("camera:"):
        return url
    if url.isdigit():
        return url
    if ":" in url or "." in url:
        return f"http://{url}"
    return url


class IPCameraStreamer:
    """
    Dedicated Zero-Latency Video Ingestion Worker for a single IP/RTSP camera.
    Thread 1 (Capture): Continuously drains OpenCV buffer to guarantee ZERO latency.
    Thread 2 (Inference): Runs fast AI inference on the latest available frame.
    """

    def __init__(self, camera: CameraConfig) -> None:
        self.camera = camera
        self.camera_id = camera.id
        self.camera_code = camera.code or camera.id.upper()
        self.stream_url = _normalize_stream_url(camera.rtsp_url)
        self.target_fps = max(10, min(camera.fps or 25, 30))
        self.is_running = False

        self._capture_thread: Optional[threading.Thread] = None
        self._inference_thread: Optional[threading.Thread] = None

        self._raw_frame: Optional[np.ndarray] = None
        self._raw_frame_lock = threading.Lock()

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

        self._capture_thread = threading.Thread(
            target=self._capture_loop,
            name=f"ip-cap-{self.camera_id}",
            daemon=True,
        )
        self._inference_thread = threading.Thread(
            target=self._inference_loop,
            name=f"ip-inf-{self.camera_id}",
            daemon=True,
        )

        self._capture_thread.start()
        self._inference_thread.start()
        log.info("[%s] Started Zero-Latency IP Streamer for: %s", self.camera_code, self.stream_url)

    def stop(self) -> None:
        self.is_running = False
        if self._capture_thread and self._capture_thread.is_alive():
            self._capture_thread.join(timeout=1.5)
        if self._inference_thread and self._inference_thread.is_alive():
            self._inference_thread.join(timeout=1.5)
        log.info("[%s] Stopped IP Camera Streamer", self.camera_code)

    def _is_snapshot_url(self, url: str) -> bool:
        lower = url.lower()
        return (
            lower.endswith(".jpg")
            or lower.endswith(".jpeg")
            or "/shot.jpg" in lower
            or "/snapshot" in lower
            or "/photo.jpg" in lower
            or "/shot" in lower
        )

    def _fetch_snapshot_frame(self, url: str) -> Optional[np.ndarray]:
        """Fetch a single frame from an HTTP snapshot URL (e.g. IP Webcam /shot.jpg)."""
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "IBVAP-Surveillance/2.0"},
            )
            with urllib.request.urlopen(req, timeout=2.5) as response:
                img_data = response.read()
                if img_data:
                    nparr = np.frombuffer(img_data, np.uint8)
                    return cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        except Exception as exc:
            self.last_error = str(exc)
        return None

    def _capture_loop(self) -> None:
        """
        DEDICATED CAPTURE THREAD:
        Continuously drains incoming video frames without waiting on AI inference.
        Ensures OpenCV's socket buffer is always empty, eliminating lag completely.
        """
        url = self.stream_url
        is_snapshot = self._is_snapshot_url(url)
        cap = None
        session = requests.Session()
        session.headers.update({"User-Agent": "IBVAP-Surveillance/2.0"})

        while self.is_running:
            if is_snapshot:
                try:
                    resp = session.get(url, timeout=2.0)
                    if resp.status_code == 200 and resp.content:
                        nparr = np.frombuffer(resp.content, np.uint8)
                        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                        if frame is not None and frame.size > 0:
                            with self._raw_frame_lock:
                                self._raw_frame = frame
                            self.last_status = "ONLINE"
                            self.last_frame_time = time.time()
                        else:
                            self.last_status = "CONNECTING"
                    else:
                        self.last_status = "CONNECTING"
                except Exception as exc:
                    self.last_error = str(exc)
                    self.last_status = "CONNECTING"
                time.sleep(0.04)  # ~25 fps snapshot poll
                continue

            # VideoCapture handling (RTSP / HTTP / USB)
            if cap is None or not cap.isOpened():
                self.last_status = "CONNECTING"
                try:
                    clean_url = url.replace("device:", "").replace("camera:", "").strip()
                    if clean_url.isdigit():
                        dev_backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
                        cap = cv2.VideoCapture(int(clean_url), dev_backend)
                    else:
                        # Use CAP_FFMPEG for RTSP and HTTP network streams on Windows
                        is_net = any(clean_url.lower().startswith(p) for p in ("rtsp://", "http://", "https://"))
                        backend = cv2.CAP_FFMPEG if is_net else cv2.CAP_ANY
                        cap = cv2.VideoCapture(clean_url, backend)

                    if cap and cap.isOpened():
                        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                        self.last_status = "ONLINE"
                        log.info("[%s] Capture thread connected to stream via %s.", self.camera_code, clean_url)
                    else:
                        # Attempt fallback snapshot endpoints if HTTP stream (e.g. Android IP Webcam)
                        lower = url.lower()
                        if lower.startswith("http://") or lower.startswith("https://"):
                            candidate_urls = []
                            if "/video" in lower:
                                candidate_urls.append(url.replace("/video", "/shot.jpg").replace("/VIDEO", "/shot.jpg"))
                            else:
                                candidate_urls.append(url.rstrip("/") + "/shot.jpg")
                                candidate_urls.append(url.rstrip("/") + "/video")

                            found_frame = None
                            for cand in candidate_urls:
                                try:
                                    r = session.get(cand, timeout=2.0)
                                    if r.status_code == 200 and r.content:
                                        nparr = np.frombuffer(r.content, np.uint8)
                                        f = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                                        if f is not None and f.size > 0:
                                            found_frame = f
                                            url = cand
                                            is_snapshot = True
                                            break
                                except Exception:
                                    pass

                            if found_frame is not None:
                                with self._raw_frame_lock:
                                    self._raw_frame = found_frame
                                self.last_status = "ONLINE"
                                self.last_frame_time = time.time()
                                log.info("[%s] Switched to snapshot endpoint: %s", self.camera_code, url)
                                continue

                        time.sleep(2.0)
                        continue
                except Exception as exc:
                    log.warning("[%s] VideoCapture init error: %s", self.camera_code, exc)
                    time.sleep(2.0)
                    continue

            # Read latest frame directly
            ret, frame = cap.read()
            if not ret or frame is None:
                lower = url.lower()
                if lower.startswith("http://") or lower.startswith("https://"):
                    candidate_urls = []
                    if "/video" in lower:
                        candidate_urls.append(url.replace("/video", "/shot.jpg").replace("/VIDEO", "/shot.jpg"))
                    else:
                        candidate_urls.append(url.rstrip("/") + "/shot.jpg")
                    for cand in candidate_urls:
                        try:
                            r = session.get(cand, timeout=2.0)
                            if r.status_code == 200 and r.content:
                                nparr = np.frombuffer(r.content, np.uint8)
                                f = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                                if f is not None and f.size > 0:
                                    is_snapshot = True
                                    url = cand
                                    if cap:
                                        cap.release()
                                    cap = None
                                    self.last_status = "ONLINE"
                                    self.last_frame_time = time.time()
                                    with self._raw_frame_lock:
                                        self._raw_frame = f
                                    log.info("[%s] Failover to snapshot endpoint: %s", self.camera_code, url)
                                    break
                        except Exception:
                            pass
                    if is_snapshot:
                        continue

                self.last_status = "RECONNECTING"
                if cap:
                    cap.release()
                cap = None
                time.sleep(1.0)
                continue

            with self._raw_frame_lock:
                self._raw_frame = frame
            self.last_status = "ONLINE"
            self.last_frame_time = time.time()

        if cap and cap.isOpened():
            cap.release()
        session.close()

    def _inference_loop(self) -> None:
        """
        DEDICATED INFERENCE & ANNOTATION THREAD:
        Processes the most recent raw frame. Automatically scales for high-speed inference,
        produces real-time annotated video, and detects/persists weapon snapshots live.
        """
        analyzer = DirectAIAnalyzer.get_instance()
        frame_interval = 1.0 / self.target_fps
        frame_count = 0
        fps_timer = time.time()

        while self.is_running:
            t0 = time.time()

            raw = None
            with self._raw_frame_lock:
                if self._raw_frame is not None:
                    raw = self._raw_frame.copy()

            if raw is None or raw.size == 0:
                time.sleep(0.02)
                continue

            try:
                # Downscale to max 640px for ultra-low-latency YOLO inference
                h, w = raw.shape[:2]
                if w > 640:
                    scale = 640.0 / w
                    raw_scaled = cv2.resize(raw, (640, int(h * scale)), interpolation=cv2.INTER_AREA)
                else:
                    raw_scaled = raw

                result: FrameResult = analyzer.process_frame(
                    frame_bgr=raw_scaled,
                    camera_id=self.camera_id,
                    camera_code=self.camera_code,
                    fence_points=self.camera.fence_points or [],
                    analytics_modes=self.camera.analytics_modes or ["INTRUSION", "WEAPON", "PERSON"],
                    annotate=True,
                    gps_info=self.camera.location or self.camera.gps_coords,
                )

                if result.annotated_frame_jpg:
                    self.last_frame_bytes = result.annotated_frame_jpg
                    pipeline_manager.update_latest_frame(self.camera_id, result.annotated_frame_jpg)

                # Persist weapon snapshot immediately if weapon detected
                has_weapon = any(
                    "WEAPON" in (a.category or "").upper() or "WEAPON" in (a.threat_type or "").upper()
                    for a in result.alerts
                ) or any(
                    d.is_weapon or "knife" in (d.class_name or "").lower() or "gun" in (d.class_name or "").lower()
                    for d in result.detections
                )

                if has_weapon and result.annotated_frame_jpg:
                    w_dir = settings.SNAPSHOT_DIR / "weapon_captured"
                    w_dir.mkdir(parents=True, exist_ok=True)
                    t_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:19]
                    snap_name = f"{self.camera_id}_{t_str}_weapon.jpg"
                    snap_file = w_dir / snap_name
                    snap_file.write_bytes(result.annotated_frame_jpg)

                if result.alerts:
                    try:
                        asyncio.run(pipeline_manager.ingest_frame_result(result))
                    except Exception as a_exc:
                        log.debug("[%s] Alert ingest error: %s", self.camera_code, a_exc)

                self.total_frames_processed += 1
                self.last_frame_time = time.time()
            except Exception as exc:
                log.error("[%s] AI processing error: %s", self.camera_code, exc)

            frame_count += 1
            if time.time() - fps_timer >= 1.0:
                self.fps_actual = round(frame_count / (time.time() - fps_timer), 1)
                frame_count = 0
                fps_timer = time.time()

            elapsed = time.time() - t0
            sleep_needed = frame_interval - elapsed
            if sleep_needed > 0:
                time.sleep(sleep_needed)


class IPCameraManager:
    """
    Central coordinator for all external IP camera streams.
    """

    def __init__(self) -> None:
        self._streamers: Dict[str, IPCameraStreamer] = {}
        self._lock = threading.Lock()

    def _find_streamer(self, camera_id: str) -> Optional[IPCameraStreamer]:
        if not camera_id:
            return None
        if camera_id in self._streamers:
            return self._streamers[camera_id]
        cid_lower = camera_id.lower()
        if cid_lower in self._streamers:
            return self._streamers[cid_lower]
        cid_upper = camera_id.upper()
        if cid_upper in self._streamers:
            return self._streamers[cid_upper]
        for k, v in self._streamers.items():
            if k.lower() == cid_lower:
                return v
        return None

    def start_camera(self, camera: CameraConfig) -> bool:
        """Start stream ingest worker for an external IP camera."""
        raw_url = (camera.rtsp_url or "").strip()
        url = raw_url.lower()
        # Only start streamer if it has a valid external URL that is pulled via VideoCapture/HTTP
        if not url or url.startswith("synthetic") or url.startswith("mobile://") or url.startswith("webcam://") or url.startswith("browser://") or url in ("test", "demo"):
            log.info("Skipping streamer for ingest-based or non-network feed: %s (%s)", camera.id, url)
            return False

        with self._lock:
            # Stop existing if any
            existing = self._find_streamer(camera.id)
            if existing:
                existing.stop()
                self._streamers.pop(camera.id, None)
                self._streamers.pop(camera.id.lower(), None)
                self._streamers.pop(camera.id.upper(), None)

            streamer = IPCameraStreamer(camera)
            self._streamers[camera.id] = streamer
            streamer.start()
            return True

    def stop_camera(self, camera_id: str) -> None:
        """Stop streamer for a camera."""
        with self._lock:
            streamer = self._find_streamer(camera_id)
            if streamer:
                streamer.stop()
                self._streamers.pop(camera_id, None)
                self._streamers.pop(camera_id.lower(), None)
                self._streamers.pop(camera_id.upper(), None)

    def get_streamer(self, camera_id: str) -> Optional[IPCameraStreamer]:
        return self._find_streamer(camera_id)

    def get_latest_frame(self, camera_id: str) -> Optional[bytes]:
        streamer = self._find_streamer(camera_id)
        if streamer:
            if streamer.last_frame_bytes:
                return streamer.last_frame_bytes
            with streamer._raw_frame_lock:
                if streamer._raw_frame is not None and streamer._raw_frame.size > 0:
                    _, buf = cv2.imencode(".jpg", streamer._raw_frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                    return buf.tobytes()
        return None

    def is_stream_active(self, camera_id: str, max_age_seconds: float = 30.0) -> bool:
        """Check whether the external IP camera stream is online and receiving frames."""
        streamer = self._find_streamer(camera_id)
        if not streamer or not streamer.is_running:
            return False
        if streamer.last_status != "ONLINE":
            return False
        if streamer.last_frame_time <= 0 or (time.time() - streamer.last_frame_time) > max_age_seconds:
            return False
        return True

    def get_status(self, camera_id: str) -> dict:
        streamer = self._find_streamer(camera_id)
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

                # If VideoCapture fails and URL is HTTP, try snapshot fallback
                if frame_bgr is None and ("/video" in lower or ":8080" in lower or ":4747" in lower):
                    try:
                        fallback_url = url.replace("/video", "/shot.jpg").replace("/VIDEO", "/shot.jpg")
                        if not fallback_url.endswith(".jpg"):
                            fallback_url = fallback_url.rstrip("/") + "/shot.jpg"
                        req = urllib.request.Request(fallback_url, headers={"User-Agent": "IBVAP-Surveillance/2.0"})
                        with urllib.request.urlopen(req, timeout=timeout) as response:
                            data = response.read()
                            if data:
                                nparr = np.frombuffer(data, np.uint8)
                                frame_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    except Exception:
                        pass

                if frame_bgr is None:
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
