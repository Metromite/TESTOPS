import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_roles
from app.models.user import Role
from app.models.customer import CorrelationResult
from app.services.jobs import start_job
from app.services.correlation_job import run_correlation

router = APIRouter(prefix="/api/correlation", tags=["correlation"])


class RunRequest(BaseModel):
    sap_batch_id: str
    landmark_batch_id: str


@router.post("/run", dependencies=[Depends(require_roles(Role.ADMIN, Role.DISPATCHER))])
def run(payload: RunRequest):
    result_batch_id = str(uuid.uuid4())
    job_id = start_job(
        job_type="correlation",
        target=run_correlation,
        sap_batch_id=payload.sap_batch_id,
        landmark_batch_id=payload.landmark_batch_id,
        result_batch_id=result_batch_id,
    )
    return {"job_id": job_id, "result_batch_id": result_batch_id}


@router.get("/results", dependencies=[Depends(require_roles(Role.ADMIN, Role.DISPATCHER))])
def results(
    batch_id: str,
    needs_review: bool | None = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """Paginated per the 'never reload entire datasets' requirement -
    default page size 50, hard cap 200."""
    q = db.query(CorrelationResult).filter(CorrelationResult.batch_id == batch_id)
    if needs_review is not None:
        q = q.filter(CorrelationResult.needs_review == needs_review)
    total = q.count()
    rows = q.order_by(CorrelationResult.id).offset(offset).limit(limit).all()
    return {
        "total": total, "limit": limit, "offset": offset,
        "items": [{
            "id": r.id, "invoice_no": r.invoice_no, "sap_customer_name": r.sap_customer_name,
            "matched_landmark_name": r.matched_landmark_name, "confidence": r.confidence,
            "needs_review": r.needs_review, "review_reason": r.review_reason,
            "driver_name": r.driver_name, "date": r.date,
        } for r in rows],
    }
