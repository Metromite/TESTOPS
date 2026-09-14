"""
api/routes/setup.py
---------------------
First-run setup flow: no terminal commands, no seed.py. The very first
person to open the app in a browser creates the Admin account themselves.

Self-disabling by construction: /create-admin refuses to run once ANY user
row exists (not a separate on/off flag - "the users table is non-empty"
IS the disabled state), so there's no config value to forget to flip.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import hash_password, create_access_token
from app.models.user import User, Role
from app.schemas.schemas import Token

router = APIRouter(prefix="/api/setup", tags=["setup"])


@router.get("/status")
def setup_status(db: Session = Depends(get_db)):
    """Public, unauthenticated - the frontend calls this before anyone
    has logged in to decide whether to show the setup wizard or the
    normal login page."""
    return {"needs_setup": db.query(User).count() == 0}


class CreateAdminRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)


@router.post("/create-admin", response_model=Token)
def create_admin(payload: CreateAdminRequest, db: Session = Depends(get_db)):
    if db.query(User).count() > 0:
        # Setup already completed by someone else (or a page refresh raced
        # this request) - refuse rather than silently creating a second
        # admin, and don't hint whether a specific username exists.
        raise HTTPException(status_code=403, detail="Setup has already been completed. Please sign in instead.")

    user = User(
        username=payload.username.strip(),
        hashed_password=hash_password(payload.password),  # bcrypt, same as every other user
        role=Role.ADMIN,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Log them straight in so first-run goes browser -> working dashboard
    # with no extra step.
    token = create_access_token(subject=user.username, role=user.role.value)
    return Token(access_token=token, role=user.role.value)
