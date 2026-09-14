from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_roles
from app.models.user import Role
from app.services import audit

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("", dependencies=[Depends(require_roles(Role.ADMIN))])
def list_audit(entity_type: str = "", limit: int = 100, db: Session = Depends(get_db)):
    return audit.get_recent_audit(db, entity_type=entity_type, limit=limit)


@router.get("/stats", dependencies=[Depends(require_roles(Role.ADMIN))])
def audit_stats(db: Session = Depends(get_db)):
    return audit.get_action_stats(db)
