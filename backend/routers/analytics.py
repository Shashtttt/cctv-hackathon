from fastapi import APIRouter, Query
from ..database.db import get_alert_summary
from ..pipeline.pipeline_manager import pipeline_manager
from ..schemas import AlertSummaryResponse

router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get("/summary", response_model=AlertSummaryResponse)
async def alert_summary(hours: int = Query(default=24, ge=1, le=720)):
    """Return alert counts by severity and category for the last N hours."""
    return await get_alert_summary(hours=hours)


@router.get("/workers")
async def pipeline_health():
    """Return worker process liveness + queue depth."""
    statuses = pipeline_manager.get_worker_statuses()
    return {
        "active_workers": sum(1 for s in statuses.values() if s["alive"]),
        "total_workers": len(statuses),
        "result_queue_depth": pipeline_manager.result_queue_depth(),
        "workers": statuses,
    }
