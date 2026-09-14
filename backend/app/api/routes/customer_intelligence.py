from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, require_roles
from app.models.user import Role
from app.services import correlation_engine as ce

router = APIRouter(prefix="/api/customer-intelligence", tags=["customer-intelligence"])


@router.get("/stats", dependencies=[Depends(get_current_user)])
def stats(db: Session = Depends(get_db)):
    return ce.get_alias_stats(db)


@router.get("/aliases", dependencies=[Depends(get_current_user)])
def aliases(search: str = "", db: Session = Depends(get_db)):
    return ce.list_aliases(db, search=search)


@router.delete("/aliases", dependencies=[Depends(require_roles(Role.ADMIN, Role.DISPATCHER))])
def reject_alias(sap_name_normalized: str, landmark_name_normalized: str, db: Session = Depends(get_db)):
    """Matches V1's 'Reject this alias' button - future correlation runs
    re-evaluate this pair from scratch instead of trusting the rejected mapping."""
    deleted = ce.delete_alias(db, sap_name_normalized, landmark_name_normalized)
    return {"deleted": deleted}
