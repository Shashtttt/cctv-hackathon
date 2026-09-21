import datetime
import uuid
from fastapi import APIRouter, File, HTTPException, UploadFile, status
from typing import List
from ..database import db
from ..database.models import WatchlistSubject
from ..schemas import (
    EmbeddingEnrollRequest, FRSSubjectCreate, FRSSubjectResponse, FRSSubjectUpdate, SuccessResponse,
)
from ..pipeline.pipeline_manager import pipeline_manager

router = APIRouter(prefix="/frs", tags=["FRS Watchlist"])


@router.get("/watchlist", response_model=List[FRSSubjectResponse])
async def list_frs_watchlist():
    subjects = await db.get_frs_watchlist()
    return [_to_response(s) for s in subjects]


@router.post("/watchlist", response_model=FRSSubjectResponse, status_code=status.HTTP_201_CREATED)
async def add_frs_subject(body: FRSSubjectCreate):
    subject_id = body.id or f"W-{uuid.uuid4().hex[:6].upper()}"
    cat_upper = (body.category or "").upper()
    threat_upper = (body.threat_level or "").upper()
    is_auth = (
        body.is_authorized
        or threat_upper == "AUTHORIZED"
        or cat_upper in ("SECURITY_OFFICER", "SENTRY", "PATROL_LEAD", "AUTHORIZED_PERSONNEL")
    )
    is_wep_auth = body.is_weapon_authorized or (is_auth and cat_upper in ("SECURITY_OFFICER", "SENTRY", "PATROL_LEAD", "AUTHORIZED_PERSONNEL"))
    subject = WatchlistSubject(
        id=subject_id, name=body.name, alias=body.alias,
        category=body.category, threat_level=body.threat_level,
        avatar_url=body.avatar_url, notes=body.notes,
        enrolled_at=datetime.datetime.utcnow(),
        is_weapon_authorized=is_wep_auth,
        is_authorized=is_auth,
    )
    await db.save_frs_subject(subject)
    await pipeline_manager.reload_watchlists()
    return _to_response(subject)


@router.put("/watchlist/{subject_id}", response_model=FRSSubjectResponse)
async def update_frs_subject(subject_id: str, body: FRSSubjectUpdate):
    subj = await db.get_frs_subject(subject_id)
    if not subj:
        raise HTTPException(status_code=404, detail=f"Subject {subject_id} not found.")

    if body.name is not None:
        subj.name = body.name
    if body.alias is not None:
        subj.alias = body.alias
    if body.category is not None:
        subj.category = body.category
    if body.threat_level is not None:
        subj.threat_level = body.threat_level
    if body.avatar_url is not None:
        subj.avatar_url = body.avatar_url
    if body.notes is not None:
        subj.notes = body.notes

    cat_upper = (subj.category or "").upper()
    threat_upper = (subj.threat_level or "").upper()

    if body.is_authorized is not None:
        subj.is_authorized = body.is_authorized
    else:
        subj.is_authorized = (
            subj.is_authorized
            or threat_upper == "AUTHORIZED"
            or cat_upper in ("SECURITY_OFFICER", "SENTRY", "PATROL_LEAD", "AUTHORIZED_PERSONNEL")
        )

    if body.is_weapon_authorized is not None:
        subj.is_weapon_authorized = body.is_weapon_authorized
    else:
        subj.is_weapon_authorized = subj.is_weapon_authorized or (subj.is_authorized and cat_upper in ("SECURITY_OFFICER", "SENTRY", "PATROL_LEAD", "AUTHORIZED_PERSONNEL"))

    await db.save_frs_subject(subj)
    await pipeline_manager.reload_watchlists()
    return _to_response(subj)


@router.delete("/watchlist/{subject_id}", response_model=SuccessResponse)
async def delete_frs_subject(subject_id: str):
    subj = await db.get_frs_subject(subject_id)
    if not subj:
        raise HTTPException(status_code=404, detail=f"Subject {subject_id} not found.")
    await db.delete_frs_subject(subject_id)
    await pipeline_manager.reload_watchlists()
    return SuccessResponse(message=f"Subject {subject_id} removed.")


@router.post("/watchlist/{subject_id}/enroll-embedding", response_model=SuccessResponse)
async def enroll_embedding(subject_id: str, body: EmbeddingEnrollRequest):
    """Store a pre-computed 128-dim SFace embedding for a subject."""
    subj = await db.get_frs_subject(subject_id)
    if not subj:
        raise HTTPException(status_code=404, detail=f"Subject {subject_id} not found.")
    await db.update_frs_embedding(subject_id, body.embedding)
    await pipeline_manager.reload_watchlists()
    return SuccessResponse(message=f"Embedding enrolled for {subject_id}. Watchlists reloaded.")


@router.post("/watchlist/{subject_id}/enroll-photo", response_model=SuccessResponse)
async def enroll_photo(subject_id: str, photo: UploadFile = File(...)):
    """
    Upload a face photo → extract SFace embedding → save to DB.
    Requires YuNet + SFace models to be installed.
    """
    subj = await db.get_frs_subject(subject_id)
    if not subj:
        raise HTTPException(status_code=404, detail=f"Subject {subject_id} not found.")

    import numpy as np
    import cv2   # type: ignore
    from ..ai.face_detector import FaceDetector
    from ..ai.face_recognizer import FaceRecognizer

    contents = await photo.read()
    arr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode uploaded image.")

    detector   = FaceDetector()
    recognizer = FaceRecognizer()

    faces = detector.detect(frame)
    if not faces:
        raise HTTPException(status_code=422, detail="No face detected in the uploaded photo. Please use a clear, front-facing portrait.")

    best_face = max(faces, key=lambda f: f.confidence)

    # If landmark-based alignment failed, fall back to a plain bbox crop resized to 112×112
    if best_face.face_crop is None:
        x, y, fw, fh = best_face.bbox
        h, w = frame.shape[:2]
        x1 = max(0, x)
        y1 = max(0, y)
        x2 = min(w, x + fw)
        y2 = min(h, y + fh)
        raw_crop = frame[y1:y2, x1:x2]
        if raw_crop.size == 0:
            raise HTTPException(status_code=422, detail="Face detected but crop region is invalid. Please use a higher resolution photo.")
        best_face.face_crop = cv2.resize(raw_crop, (112, 112))

    embedding = recognizer.embed(best_face.face_crop)
    if embedding is None:
        raise HTTPException(status_code=422, detail="Embedding extraction failed. Ensure SFace model is loaded.")

    # Encode face crop thumbnail as base64 JPEG for avatar_url
    import base64
    avatar_b64 = None
    try:
        _, buf = cv2.imencode(".jpg", best_face.face_crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
        avatar_b64 = "data:image/jpeg;base64," + base64.b64encode(buf).decode("utf-8")
    except Exception:
        pass

    emb_list = recognizer.embedding_to_list(embedding)
    await db.update_frs_embedding(subject_id, emb_list, avatar_url=avatar_b64)
    await pipeline_manager.reload_watchlists()

    return SuccessResponse(
        message=f"Face embedding enrolled for '{subj.name}' (confidence: {best_face.confidence:.1%})."
    )


def _to_response(s) -> dict:
    cat_upper = (s.category or "").upper()
    threat_upper = (s.threat_level or "").upper()
    is_auth = (
        getattr(s, "is_authorized", False)
        or threat_upper == "AUTHORIZED"
        or cat_upper in ("SECURITY_OFFICER", "SENTRY", "PATROL_LEAD", "AUTHORIZED_PERSONNEL")
    )
    is_wep_auth = getattr(s, "is_weapon_authorized", False) or (is_auth and cat_upper in ("SECURITY_OFFICER", "SENTRY", "PATROL_LEAD", "AUTHORIZED_PERSONNEL"))
    return {
        "id": s.id, "name": s.name, "alias": s.alias,
        "category": s.category, "threat_level": s.threat_level,
        "avatar_url": s.avatar_url, "notes": s.notes,
        "has_embedding": s.face_embedding is not None,
        "last_seen": s.last_seen, "last_seen_at": s.last_seen_at,
        "enrolled_at": s.enrolled_at,
        "is_weapon_authorized": is_wep_auth,
        "is_authorized": is_auth,
    }
