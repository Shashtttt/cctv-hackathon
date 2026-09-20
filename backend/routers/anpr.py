from fastapi import APIRouter, HTTPException, status
from typing import List
from ..database import db
from ..database.models import WatchlistVehicle
from ..schemas import ANPRVehicleCreate, ANPRVehicleResponse, ANPRVehicleUpdate, SuccessResponse
from ..pipeline.pipeline_manager import pipeline_manager

router = APIRouter(prefix="/anpr", tags=["ANPR Watchlist"])


@router.get("/watchlist", response_model=List[ANPRVehicleResponse])
async def list_anpr_watchlist():
    vehicles = await db.get_anpr_watchlist()
    return [_to_response(v) for v in vehicles]


@router.post("/watchlist", response_model=ANPRVehicleResponse, status_code=status.HTTP_201_CREATED)
async def add_vehicle(body: ANPRVehicleCreate):
    status_upper = (body.status or "").upper()
    threat_upper = (body.threat_level or "").upper()
    is_auth = body.is_authorized or status_upper == "AUTHORIZED" or threat_upper == "AUTHORIZED"
    vehicle = WatchlistVehicle(
        plate=body.plate.upper(), owner=body.owner, status=body.status,
        vehicle_type=body.vehicle_type, threat_level=body.threat_level,
        notes=body.notes, flagged_date=body.flagged_date,
        is_weapon_authorized=body.is_weapon_authorized,
        is_authorized=is_auth,
    )
    await db.save_anpr_vehicle(vehicle)
    await pipeline_manager.reload_watchlists()
    return _to_response(vehicle)


@router.put("/watchlist/{plate}", response_model=ANPRVehicleResponse)
async def update_vehicle(plate: str, body: ANPRVehicleUpdate):
    clean_plate = plate.upper()
    veh = await db.check_plate_in_watchlist(clean_plate)
    if not veh:
        raise HTTPException(status_code=404, detail=f"Vehicle {clean_plate} not found.")

    if body.owner is not None:
        veh.owner = body.owner
    if body.status is not None:
        veh.status = body.status
    if body.vehicle_type is not None:
        veh.vehicle_type = body.vehicle_type
    if body.threat_level is not None:
        veh.threat_level = body.threat_level
    if body.notes is not None:
        veh.notes = body.notes
    if body.flagged_date is not None:
        veh.flagged_date = body.flagged_date
    if body.is_weapon_authorized is not None:
        veh.is_weapon_authorized = body.is_weapon_authorized
    if body.is_authorized is not None:
        veh.is_authorized = body.is_authorized
    else:
        status_upper = (veh.status or "").upper()
        threat_upper = (veh.threat_level or "").upper()
        veh.is_authorized = veh.is_authorized or status_upper == "AUTHORIZED" or threat_upper == "AUTHORIZED"

    await db.save_anpr_vehicle(veh)
    await pipeline_manager.reload_watchlists()
    return _to_response(veh)


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
    status_upper = (getattr(v, "status", "") or "").upper()
    threat_upper = (getattr(v, "threat_level", "") or "").upper()
    is_auth = getattr(v, "is_authorized", False) or status_upper == "AUTHORIZED" or threat_upper == "AUTHORIZED"
    return {
        "plate": v.plate, "owner": v.owner, "status": v.status,
        "vehicle_type": v.vehicle_type, "threat_level": v.threat_level,
        "notes": v.notes, "flagged_date": v.flagged_date,
        "is_weapon_authorized": getattr(v, "is_weapon_authorized", False),
        "is_authorized": is_auth,
    }
