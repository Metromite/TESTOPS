"""
models/analytics_facts.py
----------------------------
V1's analytics_parsers.py docstring says persisting its output was
"analytics_db.py's job" - that file wasn't part of your upload, so these
two tables are NEW, designed to store parse_sap_invoice_facts() and
parse_landmark_visit_facts() output in Postgres. The columns mirror those
functions' output dicts field-for-field, so nothing about the parsing
logic itself needed to change to fit this schema.
"""
from datetime import datetime

from sqlalchemy import String, DateTime, Integer, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SapInvoiceFact(Base):
    __tablename__ = "sap_invoice_facts"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(36), index=True)

    invoice_date: Mapped[str] = mapped_column(String(10), default="", index=True)
    dispatch_date: Mapped[str] = mapped_column(String(10), default="", index=True)
    dispatch_num: Mapped[str] = mapped_column(String(64), default="")
    invoice_no: Mapped[str] = mapped_column(String(64), index=True)
    driver_code: Mapped[str] = mapped_column(String(16), default="", index=True)
    driver_name: Mapped[str] = mapped_column(String(128), default="", index=True)
    helper_code: Mapped[str] = mapped_column(String(16), default="")
    helper_name: Mapped[str] = mapped_column(String(128), default="")
    vehicle_num: Mapped[str] = mapped_column(String(32), default="")
    vehicle_key: Mapped[str] = mapped_column(String(32), default="", index=True)
    customer_name: Mapped[str] = mapped_column(String(255), default="")
    customer_name_source: Mapped[str] = mapped_column(String(16), default="")
    remarks: Mapped[str] = mapped_column(Text, default="")
    address: Mapped[str] = mapped_column(Text, default="")
    area: Mapped[str] = mapped_column(String(128), default="", index=True)
    boxes: Mapped[int] = mapped_column(Integer, default=0)
    normal_boxes: Mapped[int] = mapped_column(Integer, default=0)
    freezer_boxes: Mapped[int] = mapped_column(Integer, default=0)
    not_supplied_reason: Mapped[str] = mapped_column(String(255), default="")
    division_desc: Mapped[str] = mapped_column(String(128), default="", index=True)
    txn_code: Mapped[str] = mapped_column(String(32), default="")
    facility_type: Mapped[str] = mapped_column(String(32), default="", index=True)
    vehicle_type: Mapped[str] = mapped_column(String(16), default="")
    salesman: Mapped[str] = mapped_column(String(128), default="", index=True)  # best-effort captured, see import_jobs.py
    box_entry_time: Mapped[str] = mapped_column(String(16), default="")
    source_file: Mapped[str] = mapped_column(String(255), default="")
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class LandmarkVisitFact(Base):
    __tablename__ = "landmark_visit_facts"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(36), index=True)

    driver_name: Mapped[str] = mapped_column(String(128), default="")
    customer_name: Mapped[str] = mapped_column(String(255), default="")
    vehicle_raw: Mapped[str] = mapped_column(String(64), default="")
    vehicle_key: Mapped[str] = mapped_column(String(32), default="", index=True)
    arrival: Mapped[str] = mapped_column(String(32), default="")
    departure: Mapped[str] = mapped_column(String(32), default="")
    duration: Mapped[str] = mapped_column(String(16), default="")
    minutes: Mapped[int] = mapped_column(Integer, default=0)
    is_delivery: Mapped[bool] = mapped_column(Boolean, default=False)
    is_passthrough: Mapped[bool] = mapped_column(Boolean, default=False)
    is_depot: Mapped[bool] = mapped_column(Boolean, default=False)
    source_file: Mapped[str] = mapped_column(String(255), default="")
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class VehicleDriverManualMapping(Base):
    """
    V1 kept manual vehicle->SAP-driver override mappings (dashboard.html's
    `manualMappings` object) in browser JS memory only - lost on refresh,
    and invisible to any other person looking at the same dashboard. This
    persists them in the shared database instead, since multiple
    Dispatchers/Admins now use the same V2 instance and need to see the
    same override state.
    """
    __tablename__ = "vehicle_driver_manual_mappings"

    vehicle_key: Mapped[str] = mapped_column(String(32), primary_key=True)
    sap_driver: Mapped[str] = mapped_column(String(128))
    updated_by: Mapped[str] = mapped_column(String(64), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
