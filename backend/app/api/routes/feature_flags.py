from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, require_roles
from app.models.user import Role, User
from app.services import feature_flags as ff

router = APIRouter(prefix="/api/feature-flags", tags=["feature-flags"])


@router.get("", dependencies=[Depends(get_current_user)])
def list_flags(db: Session = Depends(get_db)):
    return ff.all_flags(db)


class FlagUpdate(BaseModel):
    enabled: bool
    description: str = ""


@router.put("/{name}", dependencies=[Depends(require_roles(Role.ADMIN))])
def update_flag(name: str, payload: FlagUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ff.set_flag(db, name, payload.enabled, payload.description, updated_by=user.username)
    return {"ok": True}
