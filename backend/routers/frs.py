import datetime
import uuid
from fastapi import APIRouter, File, HTTPException, UploadFile, status
from typing import List
from ..database import db
from ..database.models import WatchlistSubject
from ..schemas import (
    EmbeddingEnrollRequest, FRSSubjectCreate, FRSSubjectResponse, SuccessResponse,
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
    subject = WatchlistSubject(
        id=subject_id, name=body.name, alias=body.alias,
        category=body.category, threat_level=body.threat_level,
        avatar_url=body.avatar_url, notes=body.notes,
        enrolled_at=datetime.datetime.utcnow(),
    )
    await db.save_frs_subject(subject)
    return _to_response(subject)


@router.delete("/watchlist/{subject_id}", response_model=SuccessResponse)
async def delete_frs_subject(subject_id: str):
    subj = await db.get_frs_subject(subject_id)
    if not subj:
        raise HTTPException(status_code=404, detail=f"Subject {subject_id} not found.")
    await db.delete_frs_subject(subject_id)
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
        raise HTTPException(status_code=422, detail="No face detected in the uploaded photo.")

    best_face = max(faces, key=lambda f: f.confidence)
    if best_face.face_crop is None:
        raise HTTPException(status_code=422, detail="Face crop alignment failed.")

    embedding = recognizer.embed(best_face.face_crop)
    if embedding is None:
        raise HTTPException(status_code=422, detail="Embedding extraction failed.")

    emb_list = recognizer.embedding_to_list(embedding)
    await db.update_frs_embedding(subject_id, emb_list)
    await pipeline_manager.reload_watchlists()

    return SuccessResponse(
        message=f"Face embedding enrolled for '{subj.name}' (confidence: {best_face.confidence:.1%})."
    )


def _to_response(s) -> dict:
    return {
        "id": s.id, "name": s.name, "alias": s.alias,
        "category": s.category, "threat_level": s.threat_level,
        "avatar_url": s.avatar_url, "notes": s.notes,
        "has_embedding": s.face_embedding is not None,
        "last_seen": s.last_seen, "last_seen_at": s.last_seen_at,
        "enrolled_at": s.enrolled_at,
    }
