import asyncio
import datetime
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse

from ..database import db
from ..database.models import CameraConfig
from ..pipeline.pipeline_manager import pipeline_manager
from ..schemas import (
    CameraCreateRequest, CameraResponse, CameraUpdateRequest, SuccessResponse,
)

router = APIRouter(prefix="/cameras", tags=["Cameras"])


# ── Static routes (MUST be defined before /{cam_id}) ──────────────────────────

@router.get("/", response_model=List[CameraResponse])
async def list_cameras():
    cameras = await db.get_all_cameras()
    return [_to_response(c) for c in cameras]


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
    cam = CameraConfig(
        id=body.id, code=body.code, name=body.name,
        location=body.location, rtsp_url=body.rtsp_url,
        fps=body.fps, resolution=body.resolution, mode=body.mode,
        analytics_modes=body.analytics_modes,
        fence_points=[p.model_dump() for p in body.fence_points],
        rtsp_reconnect_attempts=body.rtsp_reconnect_attempts,
    )
    await db.upsert_camera(cam)
    await pipeline_manager.add_camera(cam)
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

    if body.name is not None:
        cam.name = body.name
    if body.location is not None:
        cam.location = body.location
    if body.rtsp_url is not None:
        cam.rtsp_url = body.rtsp_url
    if body.fps is not None:
        cam.fps = body.fps
    if body.resolution is not None:
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
async def update_fence(cam_id: str, fence_points: List[dict]):
    cam = await db.get_camera(cam_id)
    if not cam:
        raise HTTPException(status_code=404, detail=f"Camera {cam_id} not found.")
    await db.update_camera_fence(cam_id, fence_points)
    await pipeline_manager.update_fence(cam_id, fence_points)
    return SuccessResponse(message=f"Fence updated for {cam_id}.")


@router.delete("/{cam_id}", response_model=SuccessResponse)
async def delete_camera(cam_id: str):
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
    frame_bytes = pipeline_manager.get_latest_frame(cam_id)
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
            frame_bytes = pipeline_manager.get_latest_frame(cam_id)
            if not frame_bytes:
                frame_bytes = _generate_standby_frame(cam.code)
            
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n"
                b"Content-Length: " + str(len(frame_bytes)).encode() + b"\r\n\r\n"
                + frame_bytes + b"\r\n"
            )
            await asyncio.sleep(0.066)  # ~15 fps stream

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
        raise HTTPException(status_code=404, detail=f"Camera {cam_id} not found.")

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

    analyzer = DirectAIAnalyzer.get_instance()
    result = analyzer.process_frame(
        frame_bgr=frame_bgr,
        camera_id=cam.id,
        camera_code=cam.code,
        fence_points=cam.fence_points,
        analytics_modes=cam.analytics_modes,
        annotate=False,
    )

    await pipeline_manager.ingest_frame_result(result)

    # Return summary + annotated JPEG as base64
    annotated_b64 = None
    if result.annotated_frame_jpg:
        annotated_b64 = "data:image/jpeg;base64," + base64.b64encode(result.annotated_frame_jpg).decode()

    return {
        "success": True,
        "camera_id": cam.id,
        "detections_count": len(result.detections),
        "alerts_count": len(result.alerts),
        "detections": [
            {
                "target_id": d.target_id,
                "class_id": d.class_id,
                "class_name": d.class_name,
                "confidence": d.bbox.confidence if d.bbox else 0.90,
                "pose_label": d.pose_label,
                "is_unusual": d.is_unusual,
                "unusual_item": d.unusual_item,
                "threat_level": d.threat_level,
                "is_weapon": getattr(d, "is_weapon", False),
                "is_casual_object": getattr(d, "is_casual_object", False),
                "is_holding": getattr(d, "is_holding", False),
                "held_item": getattr(d, "held_item", None),
                "held_item_type": getattr(d, "held_item_type", None),
                "held_by_hand": getattr(d, "held_by_hand", None),
                "is_held": getattr(d, "is_held", False),
                "held_by_target_id": getattr(d, "held_by_target_id", None),
                "bbox": {
                    "x": d.bbox.x,
                    "y": d.bbox.y,
                    "w": d.bbox.w,
                    "h": d.bbox.h,
                    "confidence": d.bbox.confidence,
                } if d.bbox else None,
                "keypoints": [
                    {"x": p[0], "y": p[1], "conf": p[2]} for p in d.keypoints.points
                ] if d.keypoints else [],
                "frs_match_name": d.frs_match_name,
                "frs_match_score": d.frs_match_score,
                "loiter_seconds": d.loiter_seconds,
                "is_in_fence": d.is_in_fence,
            }
            for d in result.detections
        ],
        "annotated_frame": annotated_b64,
    }


def _to_response(cam: CameraConfig) -> dict:
    return {
        "id": cam.id, "code": cam.code, "name": cam.name,
        "location": cam.location, "rtsp_url": cam.rtsp_url,
        "status": cam.status, "fps": cam.fps, "resolution": cam.resolution,
        "mode": cam.mode, "analytics_modes": cam.analytics_modes,
        "fence_points": cam.fence_points, "last_frame_at": cam.last_frame_at,
    }
