from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import FileResponse
from pathlib import Path
from ..database.db import get_snapshot, get_alert
from ..config import settings
from ..pipeline.pipeline_manager import pipeline_manager

router = APIRouter(prefix="/snapshots", tags=["Snapshots"])


@router.get("/{alert_id}")
async def get_snapshot_image(alert_id: str):
    """
    Serve the live captured annotated JPEG snapshot for a given alert ID or file path.
    Includes smart fallback to category folders and latest camera frame.
    """
    # 1. Check direct database snapshot record
    snap = await get_snapshot(alert_id)
    if snap and snap.file_path and Path(snap.file_path).exists():
        return FileResponse(path=str(snap.file_path), media_type="image/jpeg")

    # 2. Check alert record for snapshot_path
    alert = await get_alert(alert_id)
    if alert and alert.snapshot_path and Path(alert.snapshot_path).exists():
        return FileResponse(path=str(alert.snapshot_path), media_type="image/jpeg")

    # 3. Direct disk search in settings.SNAPSHOT_DIR
    base_dir = settings.SNAPSHOT_DIR
    if base_dir.exists():
        # Check direct filename
        target_file = base_dir / alert_id
        if target_file.exists() and target_file.is_file():
            return FileResponse(path=str(target_file), media_type="image/jpeg")
        
        # Search by pattern
        matching_files = list(base_dir.rglob(f"*{alert_id}*.jpg"))
        if matching_files:
            return FileResponse(path=str(matching_files[0]), media_type="image/jpeg")

    # 4. Fallback to latest annotated camera frame if available
    cam_id = alert.camera_id if alert else "cam-01"
    latest_bytes = pipeline_manager.get_latest_frame(cam_id) or pipeline_manager.get_latest_frame("cam-01")
    if latest_bytes:
        return Response(content=latest_bytes, media_type="image/jpeg")

    raise HTTPException(status_code=404, detail=f"No snapshot image found for alert {alert_id}.")
