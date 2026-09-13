"""
IBVAP — Intelligent Border Video Analytics Platform
Firebase Cloud & Realtime Database Integration Service
"""

from __future__ import annotations
import logging
import os
from typing import Any, Optional
from pathlib import Path

logger = logging.getLogger("ibvap.firebase")

_firebase_initialized = False
_db_ref = None

try:
    import firebase_admin
    from firebase_admin import credentials, db, auth, firestore
    FIREBASE_ADMIN_AVAILABLE = True
except ImportError:
    FIREBASE_ADMIN_AVAILABLE = False
    logger.warning("firebase-admin is not installed. Cloud synchronization will run in simulated mode.")


def initialize_firebase_admin(
    credentials_path: Optional[str] = None,
    database_url: Optional[str] = None,
    project_id: str = "ibvap-hackathon"
) -> bool:
    """Initialize Firebase Admin SDK singleton."""
    global _firebase_initialized, _db_ref

    if _firebase_initialized:
        return True

    if not FIREBASE_ADMIN_AVAILABLE:
        return False

    # Check if Firebase Admin app already initialized elsewhere
    if firebase_admin._apps:
        _firebase_initialized = True
        try:
            _db_ref = db.reference()
        except Exception:
            _db_ref = None
        return True

    db_url = database_url or os.getenv("FIREBASE_DATABASE_URL", "https://ibvap-hackathon-default-rtdb.firebaseio.com")
    
    # Candidate credential file locations
    candidates = [
        credentials_path,
        os.getenv("FIREBASE_CREDENTIALS_PATH"),
        os.getenv("GOOGLE_APPLICATION_CREDENTIALS"),
        "backend/serviceAccountKey.json",
        "serviceAccountKey.json",
        str(Path(__file__).parent.parent / "serviceAccountKey.json"),
    ]

    target_cred = None
    for cand in candidates:
        if cand and Path(cand).is_file():
            target_cred = str(Path(cand).resolve())
            break

    try:
        app_options = {"projectId": project_id}
        if db_url:
            app_options["databaseURL"] = db_url

        if target_cred:
            cred = credentials.Certificate(target_cred)
            firebase_admin.initialize_app(cred, app_options)
            logger.info("Firebase Admin initialized with service account key: %s", target_cred)
        else:
            # Fallback to Application Default Credentials or options-only
            try:
                cred = credentials.ApplicationDefault()
                firebase_admin.initialize_app(cred, app_options)
                logger.info("Firebase Admin initialized with Application Default Credentials.")
            except Exception:
                firebase_admin.initialize_app(options=app_options)
                logger.info("Firebase Admin initialized with project options: %s", project_id)

        _firebase_initialized = True
        try:
            _db_ref = db.reference()
        except Exception:
            _db_ref = None
        return True
    except Exception as e:
        logger.warning("Firebase Admin initialization deferred/notice: %s", e)
        return False


import threading

def push_realtime_alert(alert_payload: dict[str, Any]) -> bool:
    """Push new surveillance or perimeter breach alert to Firebase (Firestore & RTDB) in background thread (non-blocking)."""
    def _async_push():
        global _firebase_initialized
        if not _firebase_initialized:
            if not initialize_firebase_admin():
                return

        # 1. Push to Cloud Firestore
        try:
            fs_db = firestore.client()
            doc_id = alert_payload.get("id")
            if doc_id:
                fs_db.collection("alerts").document(doc_id).set(alert_payload)
            else:
                fs_db.collection("alerts").add(alert_payload)
        except Exception as e:
            logger.debug("Firestore alert push deferred: %s", e)

        # 2. Push to Realtime Database
        try:
            alerts_ref = db.reference("alerts")
            alerts_ref.push(alert_payload)
        except Exception:
            pass

    try:
        threading.Thread(target=_async_push, daemon=True).start()
        return True
    except Exception:
        return False


def update_camera_telemetry(camera_id: str, telemetry_data: dict[str, Any]) -> bool:
    """Update live camera status and sensor telemetry in Firebase (Firestore & RTDB)."""
    global _firebase_initialized
    if not _firebase_initialized:
        if not initialize_firebase_admin():
            return False

    # 1. Update in Cloud Firestore
    try:
        fs_db = firestore.client()
        fs_db.collection("telemetry").document(camera_id).set(telemetry_data, merge=True)
    except Exception as e:
        logger.debug("Firestore telemetry update deferred: %s", e)

    # 2. Update in Realtime Database
    try:
        telemetry_ref = db.reference(f"telemetry/{camera_id}")
        telemetry_ref.set(telemetry_data)
        return True
    except Exception as e:
        return False


def verify_firebase_token(id_token: str) -> Optional[dict[str, Any]]:
    """Verify Firebase JWT token from authorization header."""
    global _firebase_initialized
    if not _firebase_initialized:
        if not initialize_firebase_admin():
            return None

    try:
        decoded_token = auth.verify_id_token(id_token)
        return decoded_token
    except Exception as e:
        logger.warning(f"Firebase token verification failed: {e}")
        return None
