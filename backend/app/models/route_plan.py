"""
models/route_plan.py
----------------------
The output of the 3-month route assignment engine (services/route_planner.py).
One row per assignment: driver + helper + vehicle + area + date range +
the scoring engine's reason string + any restrictions considered - matching
the output shape your spec calls for exactly:

    Driver / Helper / Vehicle / Area assignment / Date range /
    Experience reason / Restrictions considered

ROUND 3 EXTENSION (Route Planning split + assignment/vacation logic):
`plan_role` ("driver" or "helper") makes the Driver and Helper Route Plans
genuinely independent - generating one filters/replaces only rows with its
own plan_role, never touching the other's rows (per your explicit rule that
Helpers stay on the old driver assignments for ~1 month after a new driver
plan goes out). Existing `driver_code`/`helper_code`/`status` columns are
left as-is (availability.py and logi_rag.py already read them) - a
plan_role="driver" row populates driver_code and leaves helper_code blank,
and vice versa, which both existing readers already handle gracefully
since they treat a blank code the same as "not assigned".
"""
from datetime import datetime

from sqlalchemy import String, DateTime, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RouteAssignment(Base):
    __tablename__ = "route_assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_batch_id: Mapped[str] = mapped_column(String(64), index=True)  # groups one generated plan run
    plan_role: Mapped[str] = mapped_column(String(16), default="driver", index=True)  # "driver" or "helper" - independent planners

    area_code: Mapped[str] = mapped_column(String(32))
    area_name: Mapped[str] = mapped_column(String(128))
    sector: Mapped[str] = mapped_column(String(32))
    route_type: Mapped[str] = mapped_column(String(32), default="Main Route")
    driver_requirement: Mapped[str] = mapped_column(String(16), default="Mandatory")
    helper_requirement: Mapped[str] = mapped_column(String(16), default="Optional")

    driver_code: Mapped[str] = mapped_column(String(32), default="")
    driver_name: Mapped[str] = mapped_column(String(128), default="")
    helper_code: Mapped[str] = mapped_column(String(32), default="")
    helper_name: Mapped[str] = mapped_column(String(128), default="")
    vehicle_number: Mapped[str] = mapped_column(String(32), default="")
    vehicle_type: Mapped[str] = mapped_column(String(32), default="")
    anchored_vehicle_number: Mapped[str] = mapped_column(String(32), default="")  # this area's configured anchored vehicle, if any
    vehicle_assignment_reason: Mapped[str] = mapped_column(Text, default="")     # why this vehicle was picked (anchored vs fallback + reason)

    start_date: Mapped[str] = mapped_column(String(10))
    end_date: Mapped[str] = mapped_column(String(10))

    driver_score: Mapped[int] = mapped_column(default=0)
    driver_reason: Mapped[str] = mapped_column(Text, default="")
    helper_score: Mapped[int] = mapped_column(default=0)
    helper_reason: Mapped[str] = mapped_column(Text, default="")

    assignment_reason: Mapped[str] = mapped_column(Text, default="")   # why this row looks the way it does this generation (kept / changed + why)
    restrictions_considered: Mapped[str] = mapped_column(Text, default="")

    is_vacation_replacement: Mapped[bool] = mapped_column(Boolean, default=False)
    original_person_code: Mapped[str] = mapped_column(String(32), default="")
    original_person_name: Mapped[str] = mapped_column(String(128), default="")
    vacation_start_date: Mapped[str] = mapped_column(String(10), default="")
    vacation_end_date: Mapped[str] = mapped_column(String(10), default="")
    vacation_replacement_reason: Mapped[str] = mapped_column(Text, default="")

    is_manually_edited: Mapped[bool] = mapped_column(Boolean, default=False)  # manual edits are preserved across regenerations of the OTHER role, and across page refresh always
    status: Mapped[str] = mapped_column(String(16), default="Pending")  # Pending / Confirmed / Shortage
    sort_order: Mapped[int] = mapped_column(default=0)  # manual Route Plan Sheet row arrangement - see api/routes/route_plan.py's /reorder endpoint

    created_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
