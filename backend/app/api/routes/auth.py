from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import (
    hash_password, verify_password, create_access_token, require_roles
)
from app.models.user import User, Role
from app.schemas.schemas import Token, UserCreate, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    username = form.username.strip()
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")
    token = create_access_token(subject=user.username, role=user.role.value)
    return Token(access_token=token, role=user.role.value)


@router.post("/users", response_model=UserOut, dependencies=[Depends(require_roles(Role.ADMIN))])
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    """Admin-only: create a new user with a role. Matches the spec's
    Admin/Dispatcher/Viewer role system - only Admins provision accounts."""
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    user = User(
        username=payload.username,
        hashed_password=hash_password(payload.password),
        role=Role(payload.role),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
