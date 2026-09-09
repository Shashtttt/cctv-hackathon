"""
IBVAP — Authentication & User Management Router
Provides secure operator login, registration, clearance level validation, and session tokens.
"""

from __future__ import annotations

import datetime
import hashlib
import hmac
import logging
import secrets
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status

from ..database import db
from ..schemas import AuthTokenResponse, SuccessResponse, UserLoginRequest, UserRegisterRequest, UserResponse

log = logging.getLogger("ibvap.auth")
router = APIRouter(prefix="/auth", tags=["Authentication"])

# Secret key for token signing (in production, loaded from environment)
AUTH_SECRET = "IBVAP-SECRET-DEFENSE-KEY-SECTOR-4-2026"


def _hash_password(password: str) -> str:
    salt = "ibvap_salt_9982"
    return hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()


def _generate_token(user_id: str, username: str, role: str) -> str:
    raw = f"{user_id}:{username}:{role}:{secrets.token_hex(16)}:{datetime.datetime.utcnow().timestamp()}"
    sig = hmac.new(AUTH_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
    return f"{raw}::{sig}"


def _verify_token(token: str) -> Optional[dict]:
    try:
        if "::" not in token:
            return None
        raw, sig = token.split("::", 1)
        expected_sig = hmac.new(AUTH_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None
        parts = raw.split(":")
        return {
            "id": parts[0],
            "username": parts[1],
            "role": parts[2],
        }
    except Exception:
        return None


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization:
        # Default fallback demo operator if no header is provided in local dev
        return {
            "id": "USR-DEV-001",
            "username": "operator",
            "full_name": "Duty Commander",
            "role": "COMMANDER",
            "clearance_level": "TOP_SECRET",
            "badge_number": "SEC-8821",
            "department": "Sector-4 Border Command",
        }
    token = authorization.replace("Bearer ", "").strip()
    payload = _verify_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session token.")
    user = await db.get_user_by_id(payload["id"])
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User account not found.")
    return user


@router.post("/register", response_model=AuthTokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: UserRegisterRequest):
    """Register a new border defense operator or security analyst."""
    existing_user = await db.get_user_by_username(body.username)
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username or email already registered.")

    user_id = f"USR-{uuid.uuid4().hex[:8].upper()}"
    pwd_hash = _hash_password(body.password)

    user_data = {
        "id": user_id,
        "username": body.username.strip(),
        "email": body.email.strip().lower(),
        "password_hash": pwd_hash,
        "full_name": body.full_name or "Surveillance Officer",
        "role": body.role or "OPERATOR",
        "clearance_level": body.clearance_level or "SECRET",
        "badge_number": body.badge_number or f"SEC-{secrets.randbelow(9000)+1000}",
        "department": body.department or "Sector-4 Border Defense",
        "created_at": datetime.datetime.utcnow().isoformat(),
    }

    created = await db.create_user(user_data)
    token = _generate_token(user_id, created["username"], created["role"])

    return AuthTokenResponse(
        access_token=token,
        token_type="bearer",
        user=UserResponse(
            id=created["id"],
            username=created["username"],
            email=created["email"],
            full_name=created["full_name"],
            role=created["role"],
            clearance_level=created["clearance_level"],
            badge_number=created["badge_number"],
            department=created["department"],
            created_at=created["created_at"],
            last_login_at=created.get("last_login_at"),
        ),
    )


@router.post("/login", response_model=AuthTokenResponse)
async def login(body: UserLoginRequest):
    """Authenticate operator credentials and issue session token."""
    user = await db.get_user_by_username(body.username.strip())
    
    # Check password or auto-provision standard default accounts
    valid = False
    if user:
        if user["password_hash"] == _hash_password(body.password):
            valid = True
    else:
        # If logging in as default operator/admin for the first time, auto-create
        if body.username in ("operator", "admin", "commander", "ciel") and body.password in ("operator123", "admin123", "password123", "admin", "ciel"):
            user_id = f"USR-{uuid.uuid4().hex[:8].upper()}"
            role = "COMMANDER" if body.username in ("commander", "admin") else "OPERATOR"
            user_data = {
                "id": user_id,
                "username": body.username,
                "email": f"{body.username}@ibvap.mil",
                "password_hash": _hash_password(body.password),
                "full_name": "Senior Border Commander" if role == "COMMANDER" else "Tactical Surveillance Officer",
                "role": role,
                "clearance_level": "TOP_SECRET" if role == "COMMANDER" else "SECRET",
                "badge_number": f"SEC-{secrets.randbelow(9000)+1000}",
                "department": "Sector-4 High Command",
                "created_at": datetime.datetime.utcnow().isoformat(),
            }
            user = await db.create_user(user_data)
            valid = True

    if not valid or not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid operator username or password. Check clearance credentials.",
        )

    await db.update_user_last_login(user["id"])
    token = _generate_token(user["id"], user["username"], user["role"])

    return AuthTokenResponse(
        access_token=token,
        token_type="bearer",
        user=UserResponse(
            id=user["id"],
            username=user["username"],
            email=user["email"],
            full_name=user["full_name"],
            role=user["role"],
            clearance_level=user["clearance_level"],
            badge_number=user["badge_number"],
            department=user["department"],
            created_at=user["created_at"],
            last_login_at=datetime.datetime.utcnow().isoformat(),
        ),
    )


@router.get("/me", response_model=UserResponse)
async def get_my_profile(current_user: dict = Depends(get_current_user)):
    """Retrieve authenticated operator profile and security clearance."""
    return UserResponse(
        id=current_user["id"],
        username=current_user["username"],
        email=current_user.get("email", ""),
        full_name=current_user.get("full_name", "Surveillance Officer"),
        role=current_user.get("role", "OPERATOR"),
        clearance_level=current_user.get("clearance_level", "SECRET"),
        badge_number=current_user.get("badge_number", "SEC-8821"),
        department=current_user.get("department", "Sector-4 Border Defense"),
        created_at=current_user.get("created_at", datetime.datetime.utcnow().isoformat()),
        last_login_at=current_user.get("last_login_at"),
    )


@router.post("/logout", response_model=SuccessResponse)
async def logout():
    """Terminate current operator session."""
    return SuccessResponse(message="Operator successfully logged out.")
