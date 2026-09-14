"""
models/customer.py
--------------------
V1 kept customer_aliases and driver_aliases as two small standalone SQLite
files (visit_correlation_engine.py's own _alias_conn/_driver_alias_conn).
Per the "database first" requirement (everything in one Postgres database,
no per-feature SQLite files), both become real Postgres tables here -
same columns, same primary-key shape, just one shared database instead of
two separate local files.
"""
from datetime import datetime

from sqlalchemy import String, DateTime, Integer, Float, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CustomerAlias(Base):
    """Direct port of V1's customer_aliases SQLite table."""
    __tablename__ = "customer_aliases"

    sap_name_normalized: Mapped[str] = mapped_column(String(255), primary_key=True)
    landmark_name_normalized: Mapped[str] = mapped_column(String(255), primary_key=True)
    sap_name_original: Mapped[str] = mapped_column(String(255), default="")
    landmark_name_original: Mapped[str] = mapped_column(String(255), default="")
    times_confirmed: Mapped[int] = mapped_column(Integer, default=1)
    best_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    first_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DriverAlias(Base):
    """Direct port of V1's driver_aliases SQLite table."""
    __tablename__ = "driver_aliases"

    sap_driver_normalized: Mapped[str] = mapped_column(String(255), primary_key=True)
    sap_driver_original: Mapped[str] = mapped_column(String(255), default="")
    landmark_driver_name: Mapped[str] = mapped_column(String(255), default="")
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    times_confirmed: Mapped[int] = mapped_column(Integer, default=1)
    first_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class IdentityReviewItem(Base):
    """
    New table (V1 held these only in Streamlit session state, which can't
    survive a server restart or multiple concurrent users). Persists
    identity_engine.py's 'review' status rows - a SAP driver/helper code
    that couldn't be auto-resolved against master data - so a Dispatcher
    can review them in the browser without racing another user's session.
    """
    __tablename__ = "identity_review_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(36), index=True)
    role: Mapped[str] = mapped_column(String(16))       # Driver | Helper
    sap_code: Mapped[str] = mapped_column(String(32))
    sap_name: Mapped[str] = mapped_column(String(128))
    area: Mapped[str] = mapped_column(String(128), default="")
    date: Mapped[str] = mapped_column(String(10), default="")
    vehicle: Mapped[str] = mapped_column(String(32), default="")
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    reason: Mapped[str] = mapped_column(Text, default="")
    suggested_code: Mapped[str] = mapped_column(String(32), default="")
    suggested_name: Mapped[str] = mapped_column(String(128), default="")
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | linked | new | skipped
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CorrelationResult(Base):
    """
    New table: V1's own docstring admitted correlation results weren't
    persisted per-record yet (session-only). This closes that acknowledged
    gap - one row per SAP invoice, matched or not, with the full evidence
    dict kept as JSON text so nothing about the scoring is lost.
    """
    __tablename__ = "correlation_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(36), index=True)
    invoice_no: Mapped[str] = mapped_column(String(64), default="")
    sap_customer_name: Mapped[str] = mapped_column(String(255), default="")
    matched_landmark_name: Mapped[str] = mapped_column(String(255), default="")
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    needs_review: Mapped[bool] = mapped_column(default=False)
    review_reason: Mapped[str] = mapped_column(String(64), default="")
    evidence_json: Mapped[str] = mapped_column(Text, default="{}")
    driver_name: Mapped[str] = mapped_column(String(128), default="")
    date: Mapped[str] = mapped_column(String(10), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
