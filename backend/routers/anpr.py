from fastapi import APIRouter, HTTPException, status
from typing import List
from ..database import db
from ..database.models import WatchlistVehicle
from ..schemas import ANPRVehicleCreate, ANPRVehicleResponse, SuccessResponse
from ..pipeline.pipeline_manager import pipeline_manager

router = APIRouter(prefix="/anpr", tags=["ANPR Watchlist"])


@router.get("/watchlist", response_model=List[ANPRVehicleResponse])
async def list_anpr_watchlist():
    vehicles = await db.get_anpr_watchlist()
    return [_to_response(v) for v in vehicles]


@router.post("/watchlist", response_model=ANPRVehicleResponse, status_code=status.HTTP_201_CREATED)
async def add_vehicle(body: ANPRVehicleCreate):
    vehicle = WatchlistVehicle(
        plate=body.plate.upper(), owner=body.owner, status=body.status,
        vehicle_type=body.vehicle_type, threat_level=body.threat_level,
        notes=body.notes, flagged_date=body.flagged_date,
    )
    await db.save_anpr_vehicle(vehicle)
    await pipeline_manager.reload_watchlists()
    return _to_response(vehicle)


@router.delete("/watchlist/{plate}", response_model=SuccessResponse)
async def delete_vehicle(plate: str):
    await db.delete_anpr_vehicle(plate)
    await pipeline_manager.reload_watchlists()
    return SuccessResponse(message=f"Vehicle {plate.upper()} removed from watchlist.")


@router.get("/check/{plate}")
async def check_plate(plate: str):
    """Quick lookup of a specific plate."""
    vehicle = await db.check_plate_in_watchlist(plate)
    if not vehicle:
        return {"found": False, "plate": plate.upper()}
    return {"found": True, "vehicle": _to_response(vehicle)}


def _to_response(v) -> dict:
    return {
        "plate": v.plate, "owner": v.owner, "status": v.status,
        "vehicle_type": v.vehicle_type, "threat_level": v.threat_level,
        "notes": v.notes, "flagged_date": v.flagged_date,
    }
