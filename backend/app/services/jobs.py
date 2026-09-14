"""
services/jobs.py
------------------
Minimal background-job runner. Deliberately NOT Celery/Redis/RabbitMQ -
those need extra infrastructure the user explicitly ruled out ("no Docker,
no paid cloud dependency, one company PC/server"). Instead: a plain Python
thread per job, progress written to the `jobs` Postgres table, and the API
layer streams that row's state out over Server-Sent Events. This is the
right tradeoff for "single office server, LAN users" scale; if this ever
needs to run across multiple machines, swap this module for a real queue
without touching any calling code (every caller only sees `start_job`).
"""
import json
import threading
import time
import traceback
import uuid
from datetime import datetime
from typing import Callable

from app.core.database import SessionLocal
from app.models.job import Job, JobStatus


def _update(job_id: str, **fields):
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if not job:
            return
        for k, v in fields.items():
            setattr(job, k, v)
        db.commit()
    finally:
        db.close()


def report_progress(job_id: str, processed: int, total: int, step: str, log_line: str | None = None):
    """Call this from inside a running job function to update progress.
    Also estimates remaining time from elapsed-time-so-far / progress-so-far,
    matching the 'estimated remaining time' requirement."""
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if not job:
            return
        job.processed_units = processed
        job.total_units = total
        job.progress_pct = int((processed / total) * 100) if total else 0
        job.current_step = step
        if log_line:
            job.log = (job.log or "") + f"[{datetime.utcnow().strftime('%H:%M:%S')}] {log_line}\n"
        if job.started_at and total and processed:
            elapsed = (datetime.utcnow() - job.started_at).total_seconds()
            rate = processed / elapsed if elapsed > 0 else 0
            job.estimated_seconds_remaining = int((total - processed) / rate) if rate > 0 else 0
        db.commit()
    finally:
        db.close()


def _run(job_id: str, target: Callable, kwargs: dict):
    _update(job_id, status=JobStatus.RUNNING, started_at=datetime.utcnow(), current_step="Starting")
    try:
        target(job_id=job_id, **kwargs)
        _update(
            job_id, status=JobStatus.COMPLETED, progress_pct=100,
            current_step="Completed", finished_at=datetime.utcnow(),
        )
    except Exception as exc:  # noqa: BLE001 - job errors must never crash the server
        _update(
            job_id, status=JobStatus.FAILED, error=f"{exc}\n{traceback.format_exc()}",
            current_step="Failed", finished_at=datetime.utcnow(),
        )


def start_job(job_type: str, target: Callable, created_by: str = "", **kwargs) -> str:
    """Creates a Job row and launches `target(job_id=..., **kwargs)` on a
    background thread. Returns the job_id immediately - the caller's HTTP
    request returns right away, matching 'the UI must never freeze'."""
    job_id = str(uuid.uuid4())
    db = SessionLocal()
    try:
        db.add(Job(id=job_id, job_type=job_type, status=JobStatus.QUEUED, created_by=created_by))
        db.commit()
    finally:
        db.close()

    thread = threading.Thread(target=_run, args=(job_id, target, kwargs), daemon=True)
    thread.start()
    return job_id


def get_job_snapshot(db, job_id: str) -> dict | None:
    job = db.get(Job, job_id)
    if not job:
        return None
    return {
        "id": job.id,
        "job_type": job.job_type,
        "status": job.status.value,
        "progress_pct": job.progress_pct,
        "current_step": job.current_step,
        "processed_units": job.processed_units,
        "total_units": job.total_units,
        "estimated_seconds_remaining": job.estimated_seconds_remaining,
        "log": job.log,
        "error": job.error,
    }
