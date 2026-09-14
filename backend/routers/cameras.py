import asyncio
import datetime
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse

from ..database import db
from ..database.models import CameraConfig
from ..pipeline.ip_camera_manager import ip_camera_manager, get_lan_ip
from ..pipeline.pipeline_manager import pipeline_manager
from ..schemas import (
    CameraCreateRequest, CameraResponse, CameraUpdateRequest, SuccessResponse,
    CameraSyncGeoRequest,
)

router = APIRouter(prefix="/cameras", tags=["Cameras"])


# ── Static routes (MUST be defined before /{cam_id}) ──────────────────────────

@router.get("/", response_model=List[CameraResponse])
async def list_cameras():
    cameras = await db.get_all_cameras()
    return [_to_response(c) for c in cameras]


@router.post("/sync-geo")
async def sync_camera_locations(req: CameraSyncGeoRequest):
    """Dynamically reposition registered cameras along perimeter chain matching user geolocation."""
    updated = await db.sync_cameras_to_geolocation(
        lat=req.latitude,
        lon=req.longitude,
        location_name=req.location_name or "Live Device Location",
        delta=req.delta or 0.0008,
    )
    return {
        "status": "success",
        "message": f"Updated {len(updated)} cameras to {req.location_name}",
        "cameras": [_to_response(c) for c in updated],
    }


@router.post("/test-stream")
async def test_stream(request: Request):
    """
    Test connection to an IP camera or stream URL (RTSP, HTTP MJPEG, /shot.jpg).
    Returns latency, resolution, and a base64 preview snapshot.
    """
    body = await request.json()
    url = body.get("url", "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="Stream URL is required.")
    return ip_camera_manager.test_stream_url(url)


@router.get("/network-info")
async def get_network_info():
    """Return local LAN IP and mobile pairing details for connecting other devices."""
    lan_ip = get_lan_ip()
    return {
        "status": "success",
        "lan_ip": lan_ip,
        "mobile_pairing_url": f"https://{lan_ip}:5173/?mode=remote-cam",
        "mobile_ingest_endpoint": f"https://{lan_ip}:5173/api/v1/cameras",
        "instructions": "Ensure both devices are connected to the same Wi-Fi network.",
    }


@router.get("/trafficvision/feeds")
async def get_trafficvision_feeds():
    """Return TrafficVision feeds catalog for India and international streaming configuration."""
    from ..trafficvision_feeds import TRAFFICVISION_INDIA_FEEDS, TRAFFICVISION_STREAM_SETTINGS
    return {
        "status": "success",
        "settings": TRAFFICVISION_STREAM_SETTINGS,
        "country": "India",
        "total_feeds": len(TRAFFICVISION_INDIA_FEEDS),
        "feeds": TRAFFICVISION_INDIA_FEEDS,
    }


@router.get("/workers/status")
async def worker_status():
    """Return status of all camera worker processes."""
    statuses = pipeline_manager.get_worker_statuses()
    return {"workers": statuses, "queue_depth": pipeline_manager.result_queue_depth()}



@router.post("/", response_model=CameraResponse, status_code=status.HTTP_201_CREATED)
async def create_camera(body: CameraCreateRequest):
    gps = body.gps_coords
    if not gps and body.latitude is not None and body.longitude is not None:
        gps = f"{abs(body.latitude):.4f}° {'N' if body.latitude >= 0 else 'S'}, {abs(body.longitude):.4f}° {'E' if body.longitude >= 0 else 'W'}"

    cam = CameraConfig(
        id=body.id, code=body.code, name=body.name,
        location=body.location,
        latitude=body.latitude,
        longitude=body.longitude,
        altitude=body.altitude,
        gps_coords=gps or "",
        rtsp_url=body.rtsp_url,
        fps=body.fps, resolution=body.resolution, mode=body.mode,
        analytics_modes=body.analytics_modes,
        fence_points=[p.model_dump() for p in body.fence_points],
        rtsp_reconnect_attempts=body.rtsp_reconnect_attempts,
    )
    await db.upsert_camera(cam)
    await pipeline_manager.add_camera(cam)
    if cam.rtsp_url and not cam.rtsp_url.startswith("synthetic"):
        ip_camera_manager.start_camera(cam)
    return _to_response(cam)



# ── Parameterized routes ──────────────────────────────────────────────────────

@router.get("/{cam_id}", response_model=CameraResponse)
async def get_camera(cam_id: str):
    cam = await db.get_camera(cam_id)
    if not cam:
        raise HTTPException(status_code=404, detail=f"Camera {cam_id} not found.")
    return _to_response(cam)


@router.put("/{cam_id}", response_model=CameraResponse)
async def update_camera(cam_id: str, body: CameraUpdateRequest):
    cam = await db.get_camera(cam_id)
    if not cam:
        raise HTTPException(status_code=404, detail=f"Camera {cam_id} not found.")

    if hasattr(body, "name") and body.name is not None:
        cam.name = body.name
    if hasattr(body, "location") and body.location is not None:
        cam.location = body.location
    if hasattr(body, "latitude") and body.latitude is not None:
        cam.latitude = body.latitude
    if hasattr(body, "longitude") and body.longitude is not None:
        cam.longitude = body.longitude
    if hasattr(body, "altitude") and body.altitude is not None:
        cam.altitude = body.altitude
    if hasattr(body, "gps_coords") and body.gps_coords is not None:
        cam.gps_coords = body.gps_coords
    elif cam.latitude is not None and cam.longitude is not None:
        cam.gps_coords = f"{abs(cam.latitude):.4f}° {'N' if cam.latitude >= 0 else 'S'}, {abs(cam.longitude):.4f}° {'E' if cam.longitude >= 0 else 'W'}"

    if hasattr(body, "rtsp_url") and body.rtsp_url is not None:
        cam.rtsp_url = body.rtsp_url
    if hasattr(body, "fps") and body.fps is not None:
        cam.fps = body.fps
    if hasattr(body, "resolution") and body.resolution is not None:
        cam.resolution = body.resolution
    if body.mode is not None:
        cam.mode = body.mode
    if body.analytics_modes is not None:
        cam.analytics_modes = body.analytics_modes
    if body.fence_points is not None:
        cam.fence_points = [p.model_dump() for p in body.fence_points]

    await db.upsert_camera(cam)
    # Restart camera worker to apply new configuration
    await pipeline_manager.remove_camera(cam_id)
    await pipeline_manager.add_camera(cam)
    return _to_response(cam)


@router.put("/{cam_id}/fence", response_model=SuccessResponse)
async def update_fence(cam_id: str, request: Request):
    cam = await db.get_camera(cam_id)
    if not cam:
        raise HTTPException(status_code=404, detail=f"Camera {cam_id} not found.")
    try:
        body = await request.json()
    except Exception:
        body = []
    if isinstance(body, dict):
        points = body.get("points") or body.get("fence_points") or []
    elif isinstance(body, list):
        points = body
    else:
        points = []

    await db.update_camera_fence(cam_id, points)
    await pipeline_manager.update_fence(cam_id, points)
    return SuccessResponse(message=f"Fence updated for {cam_id}.")


@router.delete("/{cam_id}", response_model=SuccessResponse)
async def delete_camera(cam_id: str):
    ip_camera_manager.stop_camera(cam_id)
    await pipeline_manager.remove_camera(cam_id)
    await db.delete_camera(cam_id)
    return SuccessResponse(message=f"Camera {cam_id} removed.")


# ── Live Video & Frame Endpoints ──────────────────────────────────────────────

def _generate_standby_frame(camera_code: str = "CAM-01") -> bytes:
    """Generate a clean dark tactical standby frame when no stream frame is ready."""
    import cv2
    import numpy as np
    w, h = 1280, 720
    frame = np.full((h, w, 3), (15, 20, 26), dtype=np.uint8)
    cv2.putText(frame, f"[ {camera_code} LIVE SURVEILLANCE FEED ]", (w // 2 - 240, h // 2 - 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 242, 254), 2, cv2.LINE_AA)
    cv2.putText(frame, "AI ENGINE STANDBY | AWAITING CAMERA FRAMES", (w // 2 - 260, h // 2 + 25),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (120, 180, 140), 1, cv2.LINE_AA)
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return buf.tobytes()


@router.get("/{cam_id}/frame")
async def get_latest_frame(cam_id: str):
    """Serve the latest annotated JPEG frame for the camera."""
    frame_bytes = ip_camera_manager.get_latest_frame(cam_id) or pipeline_manager.get_latest_frame(cam_id)
    if not frame_bytes:
        cam = await db.get_camera(cam_id)
        code = cam.code if cam else cam_id.upper()
        frame_bytes = _generate_standby_frame(code)
    return Response(content=frame_bytes, media_type="image/jpeg")


@router.get("/{cam_id}/stream")
async def mjpeg_stream(cam_id: str):
    """
    Continuous MJPEG video stream (multipart/x-mixed-replace).
    Can be used directly in <img> tags: <img src="/api/v1/cameras/cam-01/stream" />
    """
    cam = await db.get_camera(cam_id)
    if not cam:
        raise HTTPException(status_code=404, detail=f"Camera {cam_id} not found.")

    async def _frame_generator():
        while True:
            frame_bytes = ip_camera_manager.get_latest_frame(cam_id) or pipeline_manager.get_latest_frame(cam_id)
            if not frame_bytes:
                frame_bytes = _generate_standby_frame(cam.code)
            
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n"
                b"Content-Length: " + str(len(frame_bytes)).encode() + b"\r\n\r\n"
                + frame_bytes + b"\r\n"
            )
            await asyncio.sleep(0.05)  # ~20 fps stream

    return StreamingResponse(
        _frame_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@router.post("/{cam_id}/ingest")
async def ingest_camera_frame(cam_id: str, request: Request):
    """
    Direct ingestion endpoint for browser webcam frames or external cameras.
    Accepts raw JPEG/PNG bytes or JSON with { image: 'data:image/jpeg;base64,...' }.
    Runs full YOLOv8 pose, YuNet, SFace, Virtual Fence and persists alerts in real time.
    """
    import base64
    import cv2
    import numpy as np
    from ..ai.direct_analyzer import DirectAIAnalyzer

    cam = await db.get_camera(cam_id)
    if not cam:
        # Auto-provision camera so paired smartphones or new IP cameras connect seamlessly
        cam = CameraConfig(
            id=cam_id,
            code=cam_id.upper()[:12],
            name=f"Tactical Unit {cam_id.upper()[:12]}",
            location="Field Patrol Sector",
            gps_coords="34.1524° N, 74.8211° E",
            rtsp_url=f"mobile://{cam_id}",
            status="online",
            fps=20,
            resolution="720p HD",
            mode="MOBILE PAIRED",
            analytics_modes=["WEAPON", "INTRUSION", "PERSON"],
            fence_points=[],
        )
        try:
            await db.upsert_camera(cam)
            await pipeline_manager.add_camera(cam)
        except Exception as e:
            log.warning("Could not auto-provision camera %s: %s", cam_id, e)

    content_type = request.headers.get("content-type", "")
    frame_bgr = None

    if "application/json" in content_type:
        body = await request.json()
        b64_str = body.get("image") or body.get("frame_base64", "")
        if not b64_str:
            raise HTTPException(status_code=400, detail="No base64 image data found in request.")
        if "," in b64_str:
            b64_str = b64_str.split(",", 1)[1]
        try:
            raw_bytes = base64.b64decode(b64_str)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid base64 payload: {str(e)}")
        if not raw_bytes:
            raise HTTPException(status_code=400, detail="Decoded image payload is empty.")
        nparr = np.frombuffer(raw_bytes, np.uint8)
        frame_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    else:
        raw_bytes = await request.body()
        if not raw_bytes:
            raise HTTPException(status_code=400, detail="Empty request body received.")
        nparr = np.frombuffer(raw_bytes, np.uint8)
        frame_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if frame_bgr is None or frame_bgr.size == 0:
        raise HTTPException(status_code=400, detail="Invalid image data received or failed to decode.")

    body_location = None
    body_gps = None
    if "application/json" in content_type and isinstance(body, dict):
        body_location = body.get("location")
        body_gps = body.get("gps")

    # Format GPS coordinate string
    gps_str = ""
    if isinstance(body_gps, dict):
        lat = body_gps.get("latitude")
        lon = body_gps.get("longitude")
        if lat is not None and lon is not None:
            lat_dir = "N" if lat >= 0 else "S"
            lon_dir = "E" if lon >= 0 else "W"
            acc = f" (±{int(body_gps.get('accuracy', 0))}m)" if body_gps.get("accuracy") else ""
            gps_str = f"{abs(lat):.4f}° {lat_dir}, {abs(lon):.4f}° {lon_dir}{acc}"
    elif isinstance(body_gps, str):
        gps_str = body_gps
    elif getattr(cam, "gps_coords", None):
        gps_str = cam.gps_coords

    loc_name = body_location or cam.location
    gps_full_label = f"{loc_name} | GPS: {gps_str}" if (loc_name and gps_str) else (gps_str or loc_name)

    analyzer = DirectAIAnalyzer.get_instance()
    result = analyzer.process_frame(
        frame_bgr=frame_bgr,
        camera_id=cam.id,
        camera_code=cam.code,
        fence_points=cam.fence_points,
        analytics_modes=cam.analytics_modes,
        annotate=True,
        gps_info=gps_full_label,
    )

    await pipeline_manager.ingest_frame_result(result)

    # Return summary + annotated JPEG as base64
    annotated_b64 = None
    if result.annotated_frame_jpg:
        annotated_b64 = "data:image/jpeg;base64," + base64.b64encode(result.annotated_frame_jpg).decode()

    return {
        "success": True,
        "camera_id": cam.id,
        "location": loc_name,
        "gps": gps_str,
        "detections_count": len(result.detections),
        "alerts_count": len(result.alerts),
        "detections": [
            {
                "target_id": str(d.target_id),
                "class_id": int(d.class_id),
                "class_name": str(d.class_name),
                "confidence": float(d.bbox.confidence) if d.bbox else 0.90,
                "pose_label": str(d.pose_label) if d.pose_label else None,
                "is_unusual": bool(d.is_unusual),
                "unusual_item": str(d.unusual_item) if d.unusual_item else None,
                "threat_level": str(d.threat_level),
                "is_weapon": bool(getattr(d, "is_weapon", False)),
                "is_casual_object": bool(getattr(d, "is_casual_object", False)),
                "is_holding": bool(getattr(d, "is_holding", False)),
                "held_item": str(getattr(d, "held_item", None)) if getattr(d, "held_item", None) else None,
                "held_item_type": str(getattr(d, "held_item_type", None)) if getattr(d, "held_item_type", None) else None,
                "held_by_hand": str(getattr(d, "held_by_hand", None)) if getattr(d, "held_by_hand", None) else None,
                "is_held": bool(getattr(d, "is_held", False)),
                "held_by_target_id": str(getattr(d, "held_by_target_id", None)) if getattr(d, "held_by_target_id", None) else None,
                "bbox": {
                    "x": float(d.bbox.x),
                    "y": float(d.bbox.y),
                    "w": float(d.bbox.w),
                    "h": float(d.bbox.h),
                    "confidence": float(d.bbox.confidence),
                } if d.bbox else None,
                "keypoints": [
                    {"x": float(p[0]), "y": float(p[1]), "conf": float(p[2])} for p in d.keypoints.points
                ] if d.keypoints and hasattr(d.keypoints, "points") and d.keypoints.points else [],
                "frs_match_name": str(d.frs_match_name) if d.frs_match_name else None,
                "frs_match_score": float(d.frs_match_score) if d.frs_match_score is not None else None,
                "loiter_seconds": float(d.loiter_seconds),
                "is_in_fence": bool(d.is_in_fence),
            }
            for d in result.detections
        ],
        "annotated_frame": annotated_b64,
    }


def _to_response(cam: CameraConfig) -> dict:
    lat = getattr(cam, "latitude", None)
    lng = getattr(cam, "longitude", None)
    gps = getattr(cam, "gps_coords", None)
    if not gps and lat is not None and lng is not None:
        gps = f"{abs(lat):.4f}° {'N' if lat >= 0 else 'S'}, {abs(lng):.4f}° {'E' if lng >= 0 else 'W'}"

    return {
        "id": cam.id, "code": cam.code, "name": cam.name,
        "location": cam.location,
        "latitude": lat,
        "longitude": lng,
        "altitude": getattr(cam, "altitude", None),
        "gps_coords": gps or "",
        "rtsp_url": cam.rtsp_url,
        "status": cam.status, "fps": cam.fps, "resolution": cam.resolution,
        "mode": cam.mode, "analytics_modes": cam.analytics_modes,
        "fence_points": cam.fence_points, "last_frame_at": cam.last_frame_at,
    }
