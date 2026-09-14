"""
services/availability.py
----------------------------
Direct port of V1's "Today's Availability" section (app.py, ~line 2427).
Same 5 metrics, same math, same fallback behavior:

  - Total Drivers/Helpers Available (vs vacation)
  - Extra Drivers/Helpers (Surplus) - available people not currently
    assigned to any route
  - Staff Shortage - current + future (replacement) shortage counts

V1 read from committed `draft_routes`/`active_routes` tables when they
existed, falling back to a simpler "mandatory areas vs available people"
calculation when they didn't. V2's route plan generation is
candidates-for-review only (nothing auto-commits - see
route_planner.py's own docstring), so RouteAssignment rows with a
"Confirmed"/"Pending" status may or may not exist yet. This checks for
them first (matching V1's primary path exactly) and falls back to V1's
own fallback math otherwise - not a new behavior, V1's own code already
had this exact fallback for when no routes were committed yet.
"""
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.fleet import Driver, Helper, Area
from app.models.route_plan import RouteAssignment
from app.services.route_planner import build_vacation_cache, is_on_vacation, unify_text

_NON_REAL_CODES = {"UNASSIGNED", "N/A", "SHORTAGE", "OPTIONAL", "PENDING_OPTIONAL", "", "None"}


def compute_today_availability(db: Session) -> dict:
    today = datetime.utcnow()
    vac_cache = build_vacation_cache(db)

    all_drivers = db.query(Driver).all()
    all_helpers = db.query(Helper).all()

    vac_d = [f"[{d.code}] {d.name}" for d in all_drivers if is_on_vacation(d.code, today, vac_cache)]
    avail_d = [f"[{d.code}] {d.name}" for d in all_drivers if not is_on_vacation(d.code, today, vac_cache)]
    vac_h = [f"[{h.code}] {h.name}" for h in all_helpers if is_on_vacation(h.code, today, vac_cache)]
    avail_h = [f"[{h.code}] {h.name}" for h in all_helpers if not is_on_vacation(h.code, today, vac_cache)]

    mandatory_d_areas = [unify_text(a.name) for a in db.query(Area).filter(Area.needs_driver == "Mandatory").all()]
    mandatory_h_areas = [unify_text(a.name) for a in db.query(Area).filter(Area.needs_helper == "Mandatory").all()]

    assignments = db.query(RouteAssignment).filter(RouteAssignment.status.in_(["Confirmed", "Pending"])).all()

    if assignments:
        driver_codes = [a.driver_code or "" for a in assignments]
        helper_codes = [a.helper_code or "" for a in assignments]
        curr_d_short = driver_codes.count("SHORTAGE")
        curr_h_short = helper_codes.count("SHORTAGE")
        fut_d_short = 0  # V2 has no separate replacement-code column on RouteAssignment yet
        fut_h_short = 0
        assigned_d_primary = [c for c in driver_codes if c not in _NON_REAL_CODES]
        assigned_h_primary = [c for c in helper_codes if c not in _NON_REAL_CODES]
    else:
        # V1's own fallback path when no routes are committed yet - not new behavior.
        curr_d_short = max(0, len(mandatory_d_areas) - len(avail_d))
        fut_d_short = 0
        curr_h_short = max(0, len(mandatory_h_areas) - len(avail_h))
        fut_h_short = 0
        assigned_d_primary = []
        assigned_h_primary = []

    extra_d = [n for n in avail_d if n.split("]")[0][1:] not in assigned_d_primary]
    extra_h = [n for n in avail_h if n.split("]")[0][1:] not in assigned_h_primary]

    return {
        "drivers": {
            "available_count": len(avail_d), "total_count": len(all_drivers),
            "available_names": avail_d, "on_vacation_names": vac_d,
        },
        "helpers": {
            "available_count": len(avail_h), "total_count": len(all_helpers),
            "available_names": avail_h, "on_vacation_names": vac_h,
        },
        "extra_drivers": {"count": len(extra_d), "names": extra_d},
        "extra_helpers": {"count": len(extra_h), "names": extra_h},
        "shortage": {
            "current_driver_shortage": curr_d_short, "future_driver_shortage": fut_d_short,
            "current_helper_shortage": curr_h_short, "future_helper_shortage": fut_h_short,
            "has_shortage": (curr_d_short + fut_d_short + curr_h_short + fut_h_short) > 0,
        },
    }
