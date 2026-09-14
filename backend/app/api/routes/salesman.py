from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_roles, get_current_user
from app.models.user import Role, User
from app.models.master_data import LearnedValue
from app.models.salesman import ConsumerSalesman
from app.services import audit
from app.services.division_detection import compute_driver_daily_divisions, driver_overall_division_majority

router = APIRouter(prefix="/api/salesmen", tags=["salesmen"])
WRITE_ROLES = require_roles(Role.ADMIN, Role.DISPATCHER)


@router.get("/candidates", dependencies=[Depends(get_current_user)])
def salesman_candidates(q: str = "", limit: int = 15, db: Session = Depends(get_db)):
    """
    Predictive autocomplete while categorizing Salesmen (V2 milestone) -
    candidates are salesman names auto-collected from every imported SAP
    Export file (see services/master_data_learning.py, already wired into
    the import pipeline), each flagged with whether it's already assigned
    as a Consumer Salesman.
    """
    query = db.query(LearnedValue.value).filter(LearnedValue.category == "salesman")
    if q:
        query = query.filter(LearnedValue.value.ilike(f"%{q}%"))
    names = [r[0] for r in query.order_by(LearnedValue.value).limit(limit).all()]
    consumer_names = {c.name for c in db.query(ConsumerSalesman).all()}
    return [{"name": n, "is_consumer": n in consumer_names} for n in names]


@router.get("/driver-majority", dependencies=[Depends(get_current_user)])
def driver_division_majority(db: Session = Depends(get_db)):
    """
    ITEM PASS ADD: per-driver overall Consumer-vs-Pharma classification,
    based on the majority of that driver's total order/invoice history
    (see services/division_detection.driver_overall_division_majority) -
    driven entirely by Salesman Categorization, not SAP Division text.
    Used by the Experience Database UI and available for Route Planning.
    """
    return driver_overall_division_majority(db)


@router.get("/consumer", dependencies=[Depends(get_current_user)])
def list_consumer_salesmen(db: Session = Depends(get_db)):
    return [{"id": c.id, "name": c.name, "assigned_by": c.assigned_by, "assigned_at": c.assigned_at.isoformat()}
            for c in db.query(ConsumerSalesman).order_by(ConsumerSalesman.name).all()]


@router.post("/consumer", dependencies=[Depends(WRITE_ROLES)])
def assign_consumer_salesman(payload: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    name = str(payload.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "name is required")
    row = ConsumerSalesman(name=name, assigned_by=user.username, assigned_at=datetime.utcnow())
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, f"'{name}' is already assigned as a Consumer Salesman.")
    db.refresh(row)
    audit.write_audit(db, "consumer_salesman", str(row.id), "create", user.username, after={"name": name})

    # Retroactive: today's assignment can change which past days were
    # Consumer vs Pharma for any driver whose invoices this salesman
    # handled - see division_detection.py's docstring.
    written = compute_driver_daily_divisions(db)
    return {"id": row.id, "name": row.name, "driver_days_recomputed": written}


@router.delete("/consumer/{salesman_id}", dependencies=[Depends(WRITE_ROLES)])
def unassign_consumer_salesman(salesman_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(ConsumerSalesman, salesman_id)
    if not row:
        raise HTTPException(404, "Not found")
    name = row.name
    db.delete(row)
    db.commit()
    audit.write_audit(db, "consumer_salesman", str(salesman_id), "delete", user.username, before={"name": name})
    written = compute_driver_daily_divisions(db)
    return {"deleted": salesman_id, "driver_days_recomputed": written}
