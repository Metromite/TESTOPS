"""
core/security.py
------------------
JWT auth + role-based access control. This is genuinely NEW in V2 - V1 was
a single-user desktop app with no real auth. Three roles per your spec:

    Admin      - upload SAP/Landmark/master data, manage users, everything
    Dispatcher - use operational features (route planner, vacations, etc.)
    Viewer     - read-only dashboards and reports
"""
from datetime import datetime, timedelta, timezone
from typing import Optional
import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.user import User, Role

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
# auto_error=False: don't 401 before we've even checked AUTH_DISABLED -
# a request with no token at all should still work while auth is off.
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(subject: str, role: str, expires_minutes: Optional[int] = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=expires_minutes or settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    payload = {"sub": subject, "role": role, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme_optional), db: Session = Depends(get_db)) -> User:
    if settings.AUTH_DISABLED:
        # TEMPORARY passthrough - see core/config.py's AUTH_DISABLED docstring.
        # Ensures a real Admin row exists so foreign keys / "created_by"
        # fields still work normally; does not require a token at all.
        dev_user = db.query(User).filter(User.username == "_dev_admin").first()
        if not dev_user:
            dev_user = User(username="_dev_admin", hashed_password=hash_password(uuid.uuid4().hex),
                             role=Role.ADMIN, is_active=True)
            db.add(dev_user)
            db.commit()
            db.refresh(dev_user)
        return dev_user

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_exception
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.username == username).first()
    if user is None or not user.is_active:
        raise credentials_exception
    return user


def require_roles(*allowed: Role):
    """Dependency factory: require_roles(Role.ADMIN, Role.DISPATCHER)"""

    def _check(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires one of roles: {[r.value for r in allowed]}",
            )
        return user

    return _check
