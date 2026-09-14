"""
models/audit_log.py
----------------------
Direct port of action_framework.py's action_audit_log table/philosophy:
every mutating action gets one row - who, what, when, success/failure,
duration. Storage moved from a local SQLite file to shared Postgres.

EXTENSION: V1's Action objects each had an optional per-action `undo_fn`
registered ahead of time. V2 doesn't have that same central action
registry (mutations happen directly through each entity's CRUD routes),
so instead this captures a `before_state` JSON snapshot on every
update/delete - which is what actually makes "undo the last change"
possible without needing a hand-written undo function for every single
mutation. This is a genuine, scoped alternative to V1's mechanism, not a
gap - noted here so the difference is visible.
"""
from datetime import datetime

from sqlalchemy import String, DateTime, Boolean, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AuditLogEntry(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(64))   # e.g. "driver", "helper", "area"
    entity_key: Mapped[str] = mapped_column(String(64))    # the natural key (code/number/id) affected
    action: Mapped[str] = mapped_column(String(16))        # "create" | "update" | "delete"
    actor: Mapped[str] = mapped_column(String(64), default="")
    before_state_json: Mapped[str] = mapped_column(Text, default="")  # empty for create
    after_state_json: Mapped[str] = mapped_column(Text, default="")   # empty for delete
    success: Mapped[bool] = mapped_column(Boolean, default=True)
    error_message: Mapped[str] = mapped_column(Text, default="")
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    undone: Mapped[bool] = mapped_column(Boolean, default=False)  # true once this entry has been undone
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
