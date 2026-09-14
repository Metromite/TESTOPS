from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.fleet import ExperienceHistory, Area, Vehicle
from app.models.reference_data import normalize_vehicle_type
from app.services.division_detection import driver_overall_division_majority

router = APIRouter(prefix="/api/experience", tags=["experience"])


def _days_worked(start: str, end: str) -> int | None:
    try:
        d1 = datetime.strptime(start, "%Y-%m-%d")
        d2 = datetime.strptime(end, "%Y-%m-%d")
        return (d2 - d1).days + 1
    except (ValueError, TypeError):
        return None


def _normalize_vehicle(v: str) -> str:
    import re
    return re.sub(r"[^A-Z0-9]", "", str(v or "").strip().upper())


def _vehicle_type_lookup(db: Session) -> dict[str, str]:
    """Normalized vehicle number -> current Vehicle Database type. Used to
    resolve Vehicle Type for a stint from the vehicle_number now captured on
    ExperienceHistory (see identity_engine.build_stint_updates) - the
    CURRENT type, same "best-effort against today's master data" approach
    already used for route_type/vehicle_type-by-area filtering below."""
    return {_normalize_vehicle(v.number): v.type for v in db.query(Vehicle).all()}


@router.get("", dependencies=[Depends(get_current_user)])
def list_experience(
    person_type: str = "", person_code: str = "", area: str = "",
    q: str = "", route_type: str = "", vehicle_type: str = "", division: str = "",
    db: Session = Depends(get_db),
):
    """
    Exact dates-worked-per-area tracking, built automatically from every
    SAP import (see services/identity_engine.py's stint logic, wired into
    services/import_jobs.py). `sector` here is the division (Pharma/
    Consumer/etc) recorded directly from the SAP file's own Division
    Description column for that stint - the most direct source of "what
    division were they working in" available, since it's what the actual
    dispatch was tagged with at the time.

    Predictive search (V2 milestone): `q` does an instant partial-typing
    match across Driver/Helper Code, Name, Area, Vehicle Number, Vehicle
    Type, and Division at once - the frontend calls this on every
    keystroke rather than requiring an exact field pick first. Vehicle
    Number is now captured per-stint (see identity_engine.py); Vehicle
    Type is resolved from the CURRENT Vehicle Database entry for that
    number (best-effort, same reasoning as the route_type/vehicle_type-by-
    area filters below - correct unless a vehicle's type was changed since
    that stint happened).

    `route_type`/`vehicle_type` (as query filters) still ALSO offer the
    original area-based fallback for older stints that predate vehicle_number
    capture (vehicle_number == "").
    """
    query = db.query(ExperienceHistory)
    if person_type:
        query = query.filter(ExperienceHistory.person_type == person_type)
    if person_code:
        query = query.filter(ExperienceHistory.person_code == person_code)
    if area:
        query = query.filter(ExperienceHistory.area == area)
    if division:
        query = query.filter(ExperienceHistory.sector == division)

    rows = query.order_by(ExperienceHistory.date.desc()).all()
    veh_type_by_number = _vehicle_type_lookup(db)
    # ITEM PASS ADD: Salesman-Categorization-derived majority classification
    # per driver (see services/division_detection.py) - this is what
    # actually answers "is this driver's experience Consumer or Pharma",
    # rather than trusting the SAP file's own Division Description text
    # (still returned as `sector` below, unchanged, for backward
    # compatibility with anything already reading that field).
    majority_by_code = driver_overall_division_majority(db)

    def resolved_vehicle_type(r: ExperienceHistory) -> str:
        return veh_type_by_number.get(_normalize_vehicle(r.vehicle_number), "")

    if q:
        ql = q.strip().lower()
        rows = [r for r in rows if (
            ql in (r.person_code or "").lower() or
            ql in (r.person_name or "").lower() or
            ql in (r.area or "").lower() or
            ql in (r.sector or "").lower() or
            ql in (r.vehicle_number or "").lower() or
            ql in resolved_vehicle_type(r).lower()
        )]

    if route_type or vehicle_type:
        # Best-effort join to today's Area configuration (for stints with no
        # captured vehicle_number) OR today's Vehicle Database (for stints
        # that do have one) - see docstring.
        area_lookup = {
            (a.name.strip().lower(), a.sector.strip().lower()): a
            for a in db.query(Area).all()
        }
        def area_matches(r: ExperienceHistory) -> bool:
            a = area_lookup.get((r.area.strip().lower(), r.sector.strip().lower()))
            if vehicle_type:
                if r.vehicle_number:
                    if normalize_vehicle_type(resolved_vehicle_type(r)) != vehicle_type:
                        return False
                elif not a or a.vehicle_type != vehicle_type:
                    return False
            if route_type and (not a or a.route_type != route_type):
                return False
            return True
        rows = [r for r in rows if area_matches(r)]

    out = []
    for r in rows:
        maj = majority_by_code.get(r.person_code)
        out.append({
            "id": r.id, "person_code": r.person_code, "person_name": r.person_name,
            "person_type": r.person_type, "area": r.area, "sector": r.sector,
            "start_date": r.date, "end_date": r.end_date, "days_worked": _days_worked(r.date, r.end_date),
            "vehicle_number": r.vehicle_number, "vehicle_type": resolved_vehicle_type(r),
            # Salesman-Categorization-derived overall classification (majority of
            # this driver's total order history) - the authoritative Consumer vs
            # Pharma answer per the requirement; None if no invoice/salesman data
            # exists yet for this driver.
            "experience_division": maj["division"] if maj else None,
            "experience_division_consumer_orders": maj["consumer_orders"] if maj else None,
            "experience_division_pharma_orders": maj["pharma_orders"] if maj else None,
        })
    return out


@router.get("/suggestions", dependencies=[Depends(get_current_user)])
def experience_suggestions(q: str = "", limit: int = 12, db: Session = Depends(get_db)):
    """
    Predictive autocomplete (V2 milestone) for the Experience Database
    search bar - suggestions drawn from the Experience Database itself
    (Driver/Helper Code+Name, Area, Vehicle Number/Type, Division actually
    seen in stint history) plus imported master data (the live Areas
    Database, for Area Code/Name even if no stint mentions it yet).
    Each suggestion is labeled so the UI can show what kind of match it is.
    """
    if not q or not q.strip():
        return []
    ql = q.strip().lower()
    out: list[dict] = []
    seen: set[tuple] = set()

    def add(label: str, value: str, kind: str):
        key = (kind, value.lower())
        if value and ql in value.lower() and key not in seen:
            seen.add(key)
            out.append({"label": label, "value": value, "kind": kind})

    for r in db.query(ExperienceHistory).all():
        add(f"{r.person_code} — {r.person_name} ({r.person_type} Code)", r.person_code, "person_code")
        add(f"{r.person_name} ({r.person_type} Name)", r.person_name, "person_name")
        add(f"{r.area} (Area)", r.area, "area")
        add(f"{r.sector} (Division)", r.sector, "division")
        if r.vehicle_number:
            add(f"{r.vehicle_number} (Vehicle Number)", r.vehicle_number, "vehicle_number")
        if len(out) >= limit * 4:  # cap the scan once we have plenty of raw candidates
            break

    for a in db.query(Area).all():
        add(f"{a.code} — {a.name} (Area Code)", a.code, "area_code")
        add(f"{a.name} (Area Name)", a.name, "area_name")

    for v in db.query(Vehicle).all():
        add(f"{v.number} (Vehicle Number)", v.number, "vehicle_number")
        add(f"{v.type} (Vehicle Type)", v.type, "vehicle_type")

    return out[:limit]


@router.get("/summary", dependencies=[Depends(get_current_user)])
def experience_summary(db: Session = Depends(get_db)):
    """Per-person totals: total distinct areas worked, total days across
    all stints, most recent area - a quick-glance view before drilling
    into the full history."""
    rows = db.query(ExperienceHistory).all()
    by_person: dict[str, dict] = {}
    for r in rows:
        key = (r.person_type, r.person_code)
        p = by_person.setdefault(key, {
            "person_code": r.person_code, "person_name": r.person_name, "person_type": r.person_type,
            "areas": set(), "total_days": 0, "most_recent_area": "", "most_recent_end": "",
        })
        p["areas"].add(r.area)
        days = _days_worked(r.date, r.end_date) or 0
        p["total_days"] += days
        if r.end_date > p["most_recent_end"]:
            p["most_recent_end"] = r.end_date
            p["most_recent_area"] = r.area

    return sorted(
        [{
            "person_code": p["person_code"], "person_name": p["person_name"], "person_type": p["person_type"],
            "distinct_areas": len(p["areas"]), "total_days": p["total_days"],
            "most_recent_area": p["most_recent_area"], "most_recent_end": p["most_recent_end"],
        } for p in by_person.values()],
        key=lambda x: -x["total_days"],
    )
