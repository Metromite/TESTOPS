import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from jose import jwt, JWTError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db, SessionLocal
from app.core.security import get_current_user
from app.services.jobs import get_job_snapshot

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("/{job_id}", dependencies=[Depends(get_current_user)])
def job_status(job_id: str, db: Session = Depends(get_db)):
    snap = get_job_snapshot(db, job_id)
    if not snap:
        raise HTTPException(404, "Job not found")
    return snap


def _verify_token_or_403(token: str):
    if settings.AUTH_DISABLED:
        return
    try:
        jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        raise HTTPException(401, "Invalid token")


@router.get("/{job_id}/stream")
async def job_stream(job_id: str, token: str = Query("")):
    """
    Server-Sent Events endpoint: pushes job progress every second until the
    job reaches a terminal state, so the frontend never has to poll or ask
    the user to refresh. Token is passed as a query param (not a header)
    because the browser's native EventSource can't set Authorization headers.
    """
    _verify_token_or_403(token)

    async def event_generator():
        last_status = None
        while True:
            db = SessionLocal()
            try:
                snap = get_job_snapshot(db, job_id)
            finally:
                db.close()
            if not snap:
                yield f"data: {json.dumps({'error': 'job not found'})}\n\n"
                return
            yield f"data: {json.dumps(snap)}\n\n"
            if snap["status"] in ("completed", "failed"):
                return
            await asyncio.sleep(1)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
