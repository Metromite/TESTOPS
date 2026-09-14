import os
import shutil

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import require_roles, get_current_user
from app.models.user import Role, User
from app.models.imports import RawImportRow
from app.models.analytics_facts import SapInvoiceFact, LandmarkVisitFact
from app.services.jobs import start_job
from app.services.import_jobs import run_file_import

router = APIRouter(prefix="/api/imports", tags=["imports"])

# Only Admins upload files - "no Viewer uploads, no Dispatcher uploads" per spec.
ADMIN_ONLY = require_roles(Role.ADMIN)


@router.post("/sap")
def upload_sap(file: UploadFile = File(...), user: User = Depends(ADMIN_ONLY), db: Session = Depends(get_db)):
    return _handle_upload(file, "sap", user.username)


@router.post("/landmark")
def upload_landmark(file: UploadFile = File(...), user: User = Depends(ADMIN_ONLY), db: Session = Depends(get_db)):
    return _handle_upload(file, "landmark", user.username)


def _handle_upload(file: UploadFile, source_type: str, username: str):
    os.makedirs(settings.IMPORT_FOLDER, exist_ok=True)
    dest = os.path.join(settings.IMPORT_FOLDER, file.filename)
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    job_id = start_job(
        job_type=f"{source_type}_import",
        target=run_file_import,
        created_by=username,
        filepath=dest,
        source_type=source_type,
        imported_by=username,
    )
    return {"job_id": job_id}


@router.get("/batches", dependencies=[Depends(get_current_user)])
def list_batches(db: Session = Depends(get_db)):
    """
    Every distinct upload, so an Admin can see, label, and manage what's
    been imported - not just upload blind. batch_id ties together the raw
    rows and the parsed SAP/Landmark facts from the same upload.
    """
    rows = (
        db.query(
            RawImportRow.batch_id, RawImportRow.source_type, RawImportRow.source_filename,
            RawImportRow.imported_by, RawImportRow.label,
            func.min(RawImportRow.imported_at).label("imported_at"), func.count(RawImportRow.id).label("row_count"),
        )
        .group_by(RawImportRow.batch_id, RawImportRow.source_type, RawImportRow.source_filename,
                   RawImportRow.imported_by, RawImportRow.label)
        .order_by(func.min(RawImportRow.imported_at).desc())
        .all()
    )
    result = []
    for r in rows:
        fact_count = (
            db.query(SapInvoiceFact).filter(SapInvoiceFact.batch_id == r.batch_id).count()
            if r.source_type == "sap" else
            db.query(LandmarkVisitFact).filter(LandmarkVisitFact.batch_id == r.batch_id).count()
        )
        result.append({
            "batch_id": r.batch_id, "source_type": r.source_type, "filename": r.source_filename,
            "imported_by": r.imported_by, "label": r.label, "imported_at": r.imported_at.isoformat(),
            "raw_row_count": r.row_count, "parsed_fact_count": fact_count,
        })
    return result


@router.get("/batches/{batch_id}/rows", dependencies=[Depends(get_current_user)])
def view_batch_rows(batch_id: str, limit: int = 50, offset: int = 0, db: Session = Depends(get_db)):
    """Paginated view of a batch's raw rows, for inspecting what was
    actually uploaded without needing the original file anymore."""
    q = db.query(RawImportRow).filter(RawImportRow.batch_id == batch_id).order_by(RawImportRow.row_index)
    total = q.count()
    rows = q.offset(offset).limit(min(limit, 200)).all()
    return {
        "total": total, "limit": limit, "offset": offset,
        "rows": [{"row_index": r.row_index, "data": r.row_json} for r in rows],
    }


class LabelUpdate(BaseModel):
    label: str


@router.put("/batches/{batch_id}/label", dependencies=[Depends(ADMIN_ONLY)])
def label_batch(batch_id: str, payload: LabelUpdate, db: Session = Depends(get_db)):
    """Categorize an upload (e.g. 'April SAP - corrected') for easier
    identification later - purely organizational, doesn't affect the data."""
    rows = db.query(RawImportRow).filter(RawImportRow.batch_id == batch_id).all()
    if not rows:
        raise HTTPException(404, "Batch not found")
    for r in rows:
        r.label = payload.label
    db.commit()
    return {"ok": True, "updated_rows": len(rows)}


@router.delete("/batches/{batch_id}", dependencies=[Depends(ADMIN_ONLY)])
def delete_batch(batch_id: str, db: Session = Depends(get_db)):
    """
    Removes an upload entirely - raw rows AND the parsed facts derived
    from it (both SAP and Landmark tables are checked, since only one
    will actually have matching rows for a given batch). Use this to
    clean up a bad/duplicate upload. This does NOT touch experience
    history or correlation results already derived from this data in the
    past - those are separate, already-committed records.
    """
    raw_deleted = db.query(RawImportRow).filter(RawImportRow.batch_id == batch_id).delete()
    sap_deleted = db.query(SapInvoiceFact).filter(SapInvoiceFact.batch_id == batch_id).delete()
    lm_deleted = db.query(LandmarkVisitFact).filter(LandmarkVisitFact.batch_id == batch_id).delete()
    db.commit()
    if raw_deleted == 0 and sap_deleted == 0 and lm_deleted == 0:
        raise HTTPException(404, "Batch not found")
    return {"ok": True, "raw_rows_deleted": raw_deleted, "sap_facts_deleted": sap_deleted, "landmark_facts_deleted": lm_deleted}
