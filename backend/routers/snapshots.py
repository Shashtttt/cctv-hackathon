from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path
from ..database.db import get_snapshot
from ..config import settings

router = APIRouter(prefix="/snapshots", tags=["Snapshots"])


@router.get("/{alert_id}")
async def get_snapshot_image(alert_id: str):
    """Serve the annotated JPEG snapshot for a given alert."""
    snap = await get_snapshot(alert_id)
    if not snap:
        raise HTTPException(status_code=404, detail=f"No snapshot for alert {alert_id}.")
    path = Path(snap.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Snapshot file missing from disk.")
    return FileResponse(
        path=str(path),
        media_type="image/jpeg",
        filename=f"snapshot_{alert_id}.jpg",
    )
