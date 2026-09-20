import datetime
import logging
import os
import shutil
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..config import settings
from ..database.db import get_snapshot, get_alert, delete_snapshot_record
from ..pipeline.pipeline_manager import pipeline_manager

log = logging.getLogger("ibvap.routers.snapshots")

router = APIRouter(prefix="/snapshots", tags=["Snapshots"])


class BulkDeleteRequest(BaseModel):
    ids: List[str]


def _format_size(num_bytes: int) -> str:
    if num_bytes < 1024:
        return f"{num_bytes} B"
    elif num_bytes < 1024 * 1024:
        return f"{num_bytes / 1024:.1f} KB"
    else:
        return f"{num_bytes / (1024 * 1024):.1f} MB"


def _infer_category(filename: str, rel_path: str) -> str:
    lower = f"{filename} {rel_path}".lower()
    if "weapon" in lower or "gun" in lower or "knife" in lower:
        return "WEAPON"
    elif "vehicle" in lower or "car" in lower or "truck" in lower or "plate" in lower:
        return "VEHICLE"
    elif "person" in lower or "human" in lower or "face" in lower:
        return "PERSON"
    elif "fence" in lower or "intrusion" in lower or "perimeter" in lower:
        return "INTRUSION"
    return "SURVEILLANCE"


def _infer_camera(filename: str, rel_path: str) -> str:
    lower = f"{filename} {rel_path}".lower()
    for cam in ["cam-01", "cam-02", "cam-03", "cam-04", "cam-05", "cam-06"]:
        if cam in lower:
            return cam.upper()
    return "CAM-01"



@router.get("/")
async def list_snapshots(limit: int = 150, category: Optional[str] = None):
    """
    List all surveillance snapshot images captured across all border cameras and detectors.
    Includes file size, captured timestamp, camera code, threat category, and image URL.
    """
    base_dir = settings.SNAPSHOT_DIR
    if not base_dir.exists():
        return {"total": 0, "total_size_bytes": 0, "total_size_formatted": "0 B", "snapshots": []}

    import asyncio

    def _scan_snapshots_sync():
        records = []
        total_bytes = 0
        valid_exts = {".jpg", ".jpeg", ".png", ".webp"}

        for root, dirs, files in os.walk(base_dir):
            for fname in files:
                ext = os.path.splitext(fname)[1].lower()
                if ext in valid_exts:
                    fpath = os.path.join(root, fname)
                    try:
                        st = os.stat(fpath)
                        file_size = st.st_size
                        total_bytes += file_size
                        mtime = datetime.datetime.fromtimestamp(st.st_mtime).isoformat()
                        rel_path = os.path.relpath(fpath, base_dir).replace("\\", "/")
                        cat = _infer_category(fname, rel_path)
                        cam = _infer_camera(fname, rel_path)

                        if category and category.upper() != "ALL" and cat != category.upper():
                            continue

                        alert_id = None
                        if "_ALT-" in fname:
                            parts = fname.split("_ALT-")
                            if len(parts) > 1:
                                alert_id = "ALT-" + parts[1].split("_")[0].split(".")[0]

                        records.append({
                            "id": os.path.splitext(fname)[0],
                            "filename": fname,
                            "relative_path": rel_path,
                            "camera_id": cam,
                            "category": cat,
                            "alert_id": alert_id,
                            "captured_at": mtime,
                            "file_size_bytes": file_size,
                            "file_size_formatted": _format_size(file_size),
                            "url": f"/api/v1/snapshots/image/{rel_path}",
                        })
                    except Exception as exc:
                        log.debug("Error reading snapshot %s: %s", fpath, exc)

        records.sort(key=lambda r: r["captured_at"], reverse=True)
        sliced = records[:limit]
        return {
            "total": len(records),
            "returned": len(sliced),
            "total_size_bytes": total_bytes,
            "total_size_formatted": _format_size(total_bytes),
            "snapshots": sliced,
        }

    return await asyncio.to_thread(_scan_snapshots_sync)


@router.get("/image/{file_path:path}")
async def get_snapshot_by_path(file_path: str):
    """
    Serve a specific snapshot image by its relative path inside the snapshot directory.
    """
    base_dir = settings.SNAPSHOT_DIR
    target = (base_dir / file_path).resolve()

    # Path traversal safety check
    if not str(target).startswith(str(base_dir.resolve())):
        raise HTTPException(status_code=403, detail="Forbidden file access path.")

    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Snapshot image not found.")

    return FileResponse(path=str(target), media_type="image/jpeg")


@router.post("/bulk-delete")
async def bulk_delete_snapshots(payload: BulkDeleteRequest):
    """
    Bulk delete snapshots by their ID, relative path, or filenames. (Admin operation)
    """
    base_dir = settings.SNAPSHOT_DIR
    deleted_count = 0
    errors = []

    for raw_id in payload.ids:
        item_id = str(raw_id).strip().replace("\\", "/")
        deleted_for_item = False

        # 1. Direct path check
        target = (base_dir / item_id).resolve()
        if target.exists() and target.is_file() and str(target).startswith(str(base_dir.resolve())):
            try:
                target.unlink(missing_ok=True)
                deleted_count += 1
                deleted_for_item = True
            except Exception as exc:
                errors.append(f"Failed deleting {target.name}: {exc}")

        # 2. Match files on disk by stem/filename if not matched directly
        if not deleted_for_item:
            clean_name = Path(item_id).stem
            candidates = list(base_dir.rglob(f"*{clean_name}*"))
            for cand in candidates:
                if cand.is_file() and str(cand.resolve()).startswith(str(base_dir.resolve())):
                    try:
                        cand.unlink(missing_ok=True)
                        deleted_count += 1
                    except Exception as exc:
                        errors.append(f"Failed deleting {cand.name}: {exc}")

        # 3. Remove from database
        try:
            await delete_snapshot_record(item_id)
        except Exception:
            pass

    return {
        "status": "success",
        "deleted_count": deleted_count,
        "errors": errors,
        "message": f"Successfully purged {deleted_count} snapshot files.",
    }


@router.delete("/{snapshot_id:path}")
async def delete_single_snapshot(snapshot_id: str):
    """
    Delete a single snapshot file and its database record. (Admin only)
    """
    base_dir = settings.SNAPSHOT_DIR
    deleted = False
    clean_id = snapshot_id.strip().replace("\\", "/")

    # 1. Direct relative path check
    target = (base_dir / clean_id).resolve()
    if target.exists() and target.is_file() and str(target).startswith(str(base_dir.resolve())):
        try:
            target.unlink(missing_ok=True)
            deleted = True
            log.info("Deleted snapshot file directly: %s", target)
        except Exception as exc:
            log.error("Failed to delete snapshot %s: %s", target, exc)

    # 2. Search by stem/filename in base directory and subdirectories
    if not deleted:
        clean_name = Path(clean_id).stem
        candidates = list(base_dir.rglob(f"*{clean_name}*"))
        for cand in candidates:
            if cand.is_file() and str(cand.resolve()).startswith(str(base_dir.resolve())):
                try:
                    cand.unlink(missing_ok=True)
                    deleted = True
                    log.info("Deleted snapshot candidate file: %s", cand)
                except Exception as exc:
                    log.error("Failed to delete snapshot %s: %s", cand, exc)

    # 3. Delete database records
    await delete_snapshot_record(clean_id)

    return {
        "status": "success",
        "deleted": deleted,
        "message": f"Snapshot '{snapshot_id}' successfully purged from storage.",
    }



@router.get("/{alert_id}")
async def get_snapshot_image(alert_id: str):
    """
    Serve the live captured annotated JPEG snapshot for a given alert ID.
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
        target_file = base_dir / alert_id
        if target_file.exists() and target_file.is_file():
            return FileResponse(path=str(target_file), media_type="image/jpeg")

        matching_files = list(base_dir.rglob(f"*{alert_id}*.jpg"))
        if matching_files:
            return FileResponse(path=str(matching_files[0]), media_type="image/jpeg")

    # 4. Fallback to latest annotated camera frame if available
    cam_id = alert.camera_id if alert else "cam-01"
    latest_bytes = pipeline_manager.get_latest_frame(cam_id) or pipeline_manager.get_latest_frame("cam-01")
    if latest_bytes:
        return Response(content=latest_bytes, media_type="image/jpeg")

    raise HTTPException(status_code=404, detail=f"No snapshot image found for alert {alert_id}.")
