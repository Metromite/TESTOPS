"""
models/job.py
--------------
Every long-running operation (SAP import, Landmark import, correlation,
customer intelligence, route intelligence, route plan generation, analytics
rebuild) creates one row here and updates it as it runs. The frontend polls
or subscribes to this via SSE (see api/routes/jobs.py) so the UI never
blocks on the request itself - it kicks the job off, gets a job_id back
immediately, and watches progress separately.
"""
import enum
from datetime import datetime

from sqlalchemy import String, DateTime, Integer, Text, Enum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class JobStatus(str, enum.Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    job_type: Mapped[str] = mapped_column(String(64))  # e.g. "sap_import", "landmark_import", "correlation"
    status: Mapped[JobStatus] = mapped_column(Enum(JobStatus), default=JobStatus.QUEUED)

    progress_pct: Mapped[int] = mapped_column(Integer, default=0)
    current_step: Mapped[str] = mapped_column(String(255), default="Queued")
    total_units: Mapped[int] = mapped_column(Integer, default=0)
    processed_units: Mapped[int] = mapped_column(Integer, default=0)

    log: Mapped[str] = mapped_column(Text, default="")  # newline-separated log lines
    error: Mapped[str] = mapped_column(Text, default="")

    created_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    estimated_seconds_remaining: Mapped[int] = mapped_column(Integer, default=0)
