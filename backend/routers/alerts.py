from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
from ..database import db
from ..schemas import AlertListResponse, AlertResponse, AlertStatusUpdate, SuccessResponse

router = APIRouter(prefix="/alerts", tags=["Alerts"])


@router.get("/", response_model=AlertListResponse)
async def list_alerts(
    camera_id: Optional[str] = None,
    severity: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
):
    alerts = await db.get_alerts(
        camera_id=camera_id, severity=severity, status=status,
        limit=limit, offset=offset,
    )
    return AlertListResponse(
        items=[_to_response(a) for a in alerts],
        total=len(alerts),
        limit=limit,
        offset=offset,
    )


@router.post("/{alert_id}/acknowledge", response_model=SuccessResponse)
async def acknowledge_alert(alert_id: str):
    await db.update_alert_status(alert_id, "ACKNOWLEDGED")
    return SuccessResponse(message=f"Alert {alert_id} acknowledged.")


@router.post("/{alert_id}/dispatch", response_model=SuccessResponse)
async def dispatch_qrt(alert_id: str):
    await db.update_alert_status(alert_id, "DISPATCHED")
    return SuccessResponse(message=f"QRT dispatched for alert {alert_id}.")


@router.post("/{alert_id}/resolve", response_model=SuccessResponse)
async def resolve_alert(alert_id: str):
    await db.update_alert_status(alert_id, "RESOLVED")
    return SuccessResponse(message=f"Alert {alert_id} resolved.")


@router.patch("/{alert_id}/status", response_model=SuccessResponse)
async def update_alert_status(alert_id: str, body: AlertStatusUpdate):
    await db.update_alert_status(alert_id, body.status)
    return SuccessResponse(message=f"Alert {alert_id} status → {body.status}.")


def _to_response(alert) -> dict:
    return {
        "id": alert.id, "camera_id": alert.camera_id,
        "timestamp": alert.timestamp, "category": alert.category,
        "severity": alert.severity, "title": alert.title,
        "description": alert.description, "target_id": alert.target_id,
        "status": alert.status, "snapshot_path": alert.snapshot_path,
        "frs_match_name": alert.frs_match_name,
        "frs_match_score": alert.frs_match_score,
        "plate_text": alert.plate_text,
    }
