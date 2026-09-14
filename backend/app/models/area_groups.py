"""
models/area_groups.py
-------------------------
V2 milestone: Area Groups + structured multi-area selection for Driver
Anchoring and Vehicle Permitted Areas.

EXTENDS the existing single-area association tables in models/fleet.py
(VehiclePermittedArea, AreaAnchoredVehicle) rather than replacing them:
  - VehiclePermittedArea (individual areas)        <- already existed
  - VehiclePermittedAreaGroup (whole groups)        <- new, this file
  - DriverAnchoredArea (individual areas)           <- new, this file
  - DriverAnchoredAreaGroup (whole groups)          <- new, this file

A Vehicle's/Driver's effective area set is always the UNION of its
individual-area rows and every area belonging to any of its group rows
(expanded at read/scoring time - see services/route_planner.py's
expand_permitted_area_ids() and _driver_anchor_extra_map()). The group
itself is never "flattened" into individual rows, so editing a group
(add/remove an Area) automatically updates every Vehicle/Driver that
references that group - no re-saving needed.

Helpers intentionally do NOT get structured anchoring in this milestone
(the spec only asks to extend Drivers - "Apply the same concept used for
Vehicle Permitted Areas to Drivers"); Helper.anchor_area keeps its
existing free-text behavior, untouched.
"""
from sqlalchemy import String, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AreaGroup(Base):
    """A named logical grouping of Areas (e.g. 'Dubai' containing Jabal
    Ali, Al Quoz, Mirdif, ...). Membership lives in AreaGroupMember, not
    here, so a group can contain any number of Areas."""
    __tablename__ = "area_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)


class AreaGroupMember(Base):
    __tablename__ = "area_group_members"
    __table_args__ = (
        UniqueConstraint("group_id", "area_id", name="uq_area_group_member"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("area_groups.id", ondelete="CASCADE"), index=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("areas.id", ondelete="CASCADE"), index=True)


class VehiclePermittedAreaGroup(Base):
    """A whole Area Group granted as Permitted Areas for a vehicle -
    sibling table to fleet.VehiclePermittedArea (individual areas). See
    module docstring for how the two combine."""
    __tablename__ = "vehicle_permitted_area_groups"
    __table_args__ = (
        UniqueConstraint("vehicle_id", "group_id", name="uq_vehicle_permitted_area_group"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("area_groups.id", ondelete="CASCADE"), index=True)


class DriverAnchoredArea(Base):
    """A Driver's structured Anchored Areas - individual areas. `sort_order`
    preserves the dispatcher's chosen display/preference order (reorderable
    chips in the UI); it has no effect on scoring (see
    calculate_candidate_score, unchanged)."""
    __tablename__ = "driver_anchored_areas"
    __table_args__ = (
        UniqueConstraint("driver_id", "area_id", name="uq_driver_anchored_area"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id", ondelete="CASCADE"), index=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("areas.id", ondelete="CASCADE"), index=True)
    sort_order: Mapped[int] = mapped_column(default=0)


class DriverAnchoredAreaGroup(Base):
    """A Driver's structured Anchored Areas - whole Area Groups."""
    __tablename__ = "driver_anchored_area_groups"
    __table_args__ = (
        UniqueConstraint("driver_id", "group_id", name="uq_driver_anchored_area_group"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("area_groups.id", ondelete="CASCADE"), index=True)
    sort_order: Mapped[int] = mapped_column(default=0)
