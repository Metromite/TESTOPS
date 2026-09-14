"""
models/fleet.py
-----------------
Direct port of V1's Drivers / Helpers / Areas / Vehicles tabs
(app.py tab1-tab4, ~line 4081) into real tables. Field names match V1's
column names 1:1 so the ported route_planner.py service logic (which reads
candidate['code'], candidate['veh_type'], candidate['anchor_area'],
candidate['health_card'], etc.) needs no translation layer.
"""
from datetime import datetime

from sqlalchemy import String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Driver(Base):
    __tablename__ = "drivers"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    veh_type: Mapped[str] = mapped_column(String(255), default="")     # may be "VAN / PICK-UP" etc - V1's own convention for "can drive either"; optional. Was VARCHAR(32)/(64), too narrow to hold more than one selected type - widened for the same reason and to the same width as vehicles.type, see migration 7a3f9c1e2b44 and its follow-up for this column
    anchor_area: Mapped[str] = mapped_column(String(255), default="")   # comma-separated, per V1
    health_card: Mapped[str] = mapped_column(String(8), default="No")   # "Yes" / "No" per V1
    division: Mapped[str] = mapped_column(String(16), default="")       # "Pharma" / "Consumer" / "" (optional, not required)
    preferred_helper: Mapped[str] = mapped_column(String(32), default="")  # optional helper code this driver is usually paired with
    status: Mapped[str] = mapped_column(String(32), default="Active")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Helper(Base):
    __tablename__ = "helpers"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    anchor_area: Mapped[str] = mapped_column(String(255), default="")
    health_card: Mapped[str] = mapped_column(String(8), default="No")
    division: Mapped[str] = mapped_column(String(16), default="")       # "Pharma" / "Consumer" / "" (optional)
    status: Mapped[str] = mapped_column(String(32), default="Active")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Area(Base):
    """
    NOTE on the Area Code uniqueness rule (Priority-1 bug fix):
    Area Code alone must NOT be globally unique - the same code can
    legitimately exist under a different Division (e.g. "JA" for Pharma
    AND "JA" for Consumer). The old single-column unique index
    (`ix_areas_code`) rejected that combination outright. The correct
    rule is: the same Area Code + Area Name may not repeat within the
    same Division. `code` keeps a plain (non-unique) index for lookup
    speed; true uniqueness now lives on the composite constraint below.
    See core/auto_migrate.py's `_migrate_area_uniqueness()` for the
    one-time step that drops the old constraint/index on an existing
    database without losing data.

    NOTE on `region`: the V2 milestone spec asks to remove Region from
    Areas. The column is kept here (not dropped) so no existing data is
    destroyed, but it's excluded from AreaIn/AreaOut and the frontend
    form/table entirely - functionally removed from the app even though
    the column stays on disk as a harmless, unused leftover.

    NOTE on `needs_driver`/`needs_helper`: values now read "Mandatory" /
    "Optional" instead of "Yes" / "No" (same columns, new value domain -
    see reference_data.REQUIREMENT_LEVELS and auto_migrate's data
    migration for existing rows). `route_type` now uses the 4-value
    domain in reference_data.ROUTE_TYPES instead of "Main"/"Replacement".
    """
    __tablename__ = "areas"
    __table_args__ = (
        UniqueConstraint("code", "name", "sector", name="uq_areas_code_name_division"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(String(128))
    sector: Mapped[str] = mapped_column(String(32), default="Pharma")   # Division: Pharma / Consumer
    region: Mapped[str] = mapped_column(String(64), default="")        # kept for data preservation only - not exposed (see note above)
    needs_driver: Mapped[str] = mapped_column(String(16), default="Mandatory")  # Driver Requirement: Mandatory / Optional
    needs_helper: Mapped[str] = mapped_column(String(16), default="Optional")   # Helper Requirement: Mandatory / Optional
    route_type: Mapped[str] = mapped_column(String(32), default="Main Route")  # Main Route / Second Trip / Urgent & Government / Fleet
    vehicle_type: Mapped[str] = mapped_column(String(32), default="Van")       # references Vehicle Database's type domain - dropdown only, not free text


class VehiclePermittedArea(Base):
    """
    Permitted Areas system: which Areas a vehicle is allowed to operate in.
    No rows for a vehicle = no restriction (can be used anywhere). This is
    used by the Route Planner's vehicle-assignment step (extended, not
    replaced - see services/route_planner.py) to prefer vehicles whose
    permitted areas include the area being planned.
    """
    __tablename__ = "vehicle_permitted_areas"
    __table_args__ = (
        UniqueConstraint("vehicle_id", "area_id", name="uq_vehicle_permitted_area"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id", ondelete="CASCADE"), index=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("areas.id", ondelete="CASCADE"), index=True)


class AreaAnchoredVehicle(Base):
    """
    An anchored vehicle is the normal assigned vehicle for an Area - not
    just a preference. An Area can have one or several anchored vehicles
    (hence a separate association table rather than a single FK column on
    Area). The Route Planner tries these first before falling back to
    another suitable vehicle (see services/route_planner.py).
    """
    __tablename__ = "area_anchored_vehicles"
    __table_args__ = (
        UniqueConstraint("area_id", "vehicle_id", name="uq_area_anchored_vehicle"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("areas.id", ondelete="CASCADE"), index=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id", ondelete="CASCADE"), index=True)


class Vehicle(Base):
    __tablename__ = "vehicles"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    type: Mapped[str] = mapped_column(String(255), default="VAN")  # VAN / PICK-UP / BUS / 2-8 VAN / 2-8 PICK-UP (multi-select, " / "-joined - was VARCHAR(32), too narrow to hold more than one selected type; widened generously for future vehicle types too, see migration 7a3f9c1e2b44
    division: Mapped[str] = mapped_column(String(16), default="")  # "Pharma" / "Consumer" / "" (optional)
    status: Mapped[str] = mapped_column(String(32), default="Active")  # "Under Service" excludes it, per V1


class Vacation(Base):
    """Direct port of V1's vacations table + is_on_vacation/vacation_within_3_months logic."""
    __tablename__ = "vacations"

    id: Mapped[int] = mapped_column(primary_key=True)
    person_code: Mapped[str] = mapped_column(String(32), index=True)
    person_name: Mapped[str] = mapped_column(String(128), default="")
    person_type: Mapped[str] = mapped_column(String(16), default="Driver")  # "Driver" / "Helper" - see migration 9f2e6b7d1a03
    start_date: Mapped[str] = mapped_column(String(10))  # YYYY-MM-DD, matches V1's string-date convention
    end_date: Mapped[str] = mapped_column(String(10))


class ExperienceHistory(Base):
    """
    Direct port of V1's 'history' table - the record build_experience_cache()
    reads to compute last-worked-area / last-worked-sector per driver/helper.
    Never mutated after write, per V1's immutable-history convention.
    """
    __tablename__ = "experience_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    person_code: Mapped[str] = mapped_column(String(32), index=True)
    person_name: Mapped[str] = mapped_column(String(128), default="")
    person_type: Mapped[str] = mapped_column(String(16), default="Driver")  # Driver / Helper
    area: Mapped[str] = mapped_column(String(128))
    sector: Mapped[str] = mapped_column(String(32), default="Pharma")
    date: Mapped[str] = mapped_column(String(10))       # start date, YYYY-MM-DD
    end_date: Mapped[str] = mapped_column(String(10), default="")
    vehicle_number: Mapped[str] = mapped_column(String(32), default="")  # most recent vehicle used during this stint
