from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.security import require_roles
from app.models.user import Role, User
from app.services import backup_manager as bm
from app.services.jobs import start_job, report_progress

router = APIRouter(prefix="/api/backup", tags=["backup"])

# Backup/restore touches the whole database - Admin-only, no exceptions.
ADMIN_ONLY = require_roles(Role.ADMIN)


def _run_create_backup(job_id: str, label: str, created_by: str):
    report_progress(job_id, 0, 1, "Running pg_dump", "This can take a while for a large database")
    manifest = bm.create_backup(label=label)
    ok = all(f.get("error") is None for f in manifest["files"])
    report_progress(job_id, 1, 1, "Done", f"Backup {manifest['backup_id']} {'succeeded' if ok else 'FAILED - see files list'}")
    if not ok:
        raise RuntimeError(f"Backup failed: {manifest['files']}")


def _run_restore_backup(job_id: str, backup_id: str, restored_by: str):
    report_progress(job_id, 0, 1, "Verifying backup integrity")
    result = bm.restore_backup(backup_id, create_safety_checkpoint=True)
    if not result["ok"]:
        report_progress(job_id, 1, 1, "Failed", str(result))
        raise RuntimeError(str(result))
    report_progress(job_id, 1, 1, "Done",
                     f"Restored {backup_id}. Safety checkpoint created first: {result.get('safety_checkpoint_id')}")


@router.post("/create")
def create_backup(label: str = "", user: User = Depends(ADMIN_ONLY)):
    job_id = start_job(job_type="backup_create", target=_run_create_backup, created_by=user.username,
                        label=label, created_by_name=user.username)
    return {"job_id": job_id}


@router.get("/list", dependencies=[Depends(ADMIN_ONLY)])
def list_backups():
    return bm.list_backups()


@router.get("/stats", dependencies=[Depends(ADMIN_ONLY)])
def backup_stats():
    return bm.get_backup_stats()


@router.get("/verify/{backup_id}", dependencies=[Depends(ADMIN_ONLY)])
def verify_backup(backup_id: str):
    return bm.verify_backup(backup_id)


class RestoreRequest(BaseModel):
    backup_id: str
    confirm: bool = False


@router.post("/restore")
def restore_backup(payload: RestoreRequest, user: User = Depends(ADMIN_ONLY)):
    if not payload.confirm:
        raise HTTPException(
            status_code=400,
            detail="This overwrites the live database. Resubmit with confirm=true once you're sure "
                   "(a safety checkpoint of current state is still created automatically either way).",
        )
    job_id = start_job(job_type="backup_restore", target=_run_restore_backup, created_by=user.username,
                        backup_id=payload.backup_id, restored_by=user.username)
    return {"job_id": job_id}
