from datetime import datetime
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_roles, get_current_user
from app.models.user import Role, User
from app.models.route_plan import RouteAssignment
from app.schemas.schemas import RoutePlanRequest, RoutePlanResponse, ReplacementForecastRow, RouteAssignmentEdit, RouteAssignmentOut
from app.services import route_planner, excel_export
from app.services import audit

router = APIRouter(prefix="/api/route-plan", tags=["route-plan"])
WRITE_ROLES = require_roles(Role.ADMIN, Role.DISPATCHER)


class SheetLayoutRequest(BaseModel):
    """Route Plan Sheet column customization - order, which columns are
    hidden, and pixel widths. See route_planner.save_sheet_layout()."""
    column_order: list[str]
    hidden_columns: list[str] = []
    column_widths: dict[str, int] = {}


@router.post("/generate", response_model=RoutePlanResponse,
             dependencies=[Depends(require_roles(Role.ADMIN, Role.DISPATCHER))])
def generate_plan(payload: RoutePlanRequest, db: Session = Depends(get_db)):
    """
    Runs the ported V1 scoring engine (services/route_planner.py) for the
    given target date and returns ranked candidates per area, for review -
    it does NOT auto-commit assignments, matching V1's review-then-confirm
    flow rather than silently assigning routes.
    """
    target_date = datetime.strptime(payload.target_date, "%Y-%m-%d")
    result = route_planner.generate_route_plan_candidates(db, target_date)
    return result


@router.get("/vacation-status/{person_code}", dependencies=[Depends(get_current_user)])
def vacation_status(person_code: str, db: Session = Depends(get_db)):
    vac_cache = route_planner.build_vacation_cache(db)
    return {"person_code": person_code, "status": route_planner.get_vac_status(person_code, vac_cache, datetime.utcnow())}


@router.get("/replacement-forecast", response_model=list[ReplacementForecastRow],
            dependencies=[Depends(get_current_user)])
def replacement_forecast(target_date: str = "", db: Session = Depends(get_db)):
    """
    Who's currently the top candidate for each route, whether they have an
    upcoming vacation, and who the next-ranked replacement would be -
    computed from the same scoring engine as route plan generation, so the
    replacement suggestion follows the identical rules (anchor area,
    experience, health-card logic) as the original assignment.
    """
    td = datetime.strptime(target_date, "%Y-%m-%d") if target_date else datetime.utcnow()
    return route_planner.compute_replacement_forecast(db, td)


# NOTE (V2 verification pass - duplicate logic removal): the old GET
# "/sheet" endpoint (an ephemeral, non-persisted preview built from
# generate_route_plan_candidates + build_route_plan_sheet) was removed
# here - it had no remaining frontend caller (superseded by
# GET "/combined-sheet", the persisted, always-in-sync Route Plan Sheet -
# see RoutePlanSheet.tsx's own comment on this exact history) and was
# confirmed dead by searching the whole frontend for any reference to it.
# build_route_plan_sheet() in route_planner.py was removed alongside it
# for the same reason (its only caller was this endpoint).


# ---------------------------------------------------------------------------
# ROUND 3 - persisted, independent Driver/Helper Route Plans. Generating one
# role never touches the other's saved rows (services/route_planner.py).
# ---------------------------------------------------------------------------

@router.post("/{plan_role}/generate", dependencies=[Depends(WRITE_ROLES)])
def generate_persisted_plan(plan_role: str, payload: RoutePlanRequest,
                             user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if plan_role not in ("driver", "helper"):
        raise HTTPException(404, "plan_role must be 'driver' or 'helper'")
    result = route_planner.generate_route_plan(db, plan_role, payload.target_date, created_by=user.username)
    audit.write_audit(db, f"route_plan_{plan_role}", result["batch_id"], "generate", user.username, after=result)
    return result


# ---------------------------------------------------------------------------
# IMPORTANT - ROUTE ORDERING BUG FIX:
# FastAPI/Starlette match routes in the order they were registered. All
# single-path-segment GET routes below (e.g. "/combined-sheet",
# "/sheet-layout") MUST be declared BEFORE the generic GET "/{plan_role}"
# route, or a request to e.g. GET /api/route-plan/combined-sheet gets
# swallowed by "/{plan_role}" first (plan_role="combined-sheet"), which
# then 404s with "plan_role must be 'driver' or 'helper'" - this was the
# exact root cause of the Route Plan Sheet failing to load. Any NEW
# single-segment GET route added under this router must also go above
# "/{plan_role}".
# ---------------------------------------------------------------------------

@router.get("/combined-sheet", dependencies=[Depends(get_current_user)])
def combined_sheet(db: Session = Depends(get_db)):
    """
    ROUTE PLANNER INTEGRATION FIX: the unified Route Plan Sheet - one row
    per area merging the current Driver plan + current Helper plan,
    reflecting whatever was last generated for either role with no
    separate "run" step. See route_planner.get_combined_route_plan_sheet()
    for exactly how the merge and row ordering work.
    """
    return route_planner.get_combined_route_plan_sheet(db)


@router.get("/sheet-layout", dependencies=[Depends(get_current_user)])
def get_sheet_layout(db: Session = Depends(get_db)):
    """Returns the dispatcher's saved Route Plan Sheet column layout
    (order/visibility/widths), or the built-in default if nothing has
    been saved yet. Persists permanently in Postgres - survives refresh,
    browser close, and server restart."""
    return route_planner.get_sheet_layout(db)


@router.put("/sheet-layout", dependencies=[Depends(WRITE_ROLES)])
def put_sheet_layout(payload: SheetLayoutRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Saves the dispatcher's column arrangement/visibility/widths for the
    Route Plan Sheet. Single shared layout (app-wide), same pattern as
    AppearanceConfig - a singleton row updated in place."""
    return route_planner.save_sheet_layout(
        db, column_order=payload.column_order, hidden_columns=payload.hidden_columns,
        column_widths=payload.column_widths, updated_by=user.username,
    )


@router.get("/{plan_role}", response_model=list[RouteAssignmentOut], dependencies=[Depends(get_current_user)])
def get_persisted_plan(plan_role: str, db: Session = Depends(get_db)):
    """Returns the CURRENT saved plan for this role - persists across
    refresh/reopen/restart since it's just a normal DB read, no
    regeneration happens here."""
    if plan_role not in ("driver", "helper"):
        raise HTTPException(404, "plan_role must be 'driver' or 'helper'")
    current_batch = (
        db.query(RouteAssignment.plan_batch_id)
        .filter(RouteAssignment.plan_role == plan_role)
        .order_by(RouteAssignment.created_at.desc())
        .first()
    )
    if not current_batch:
        return []
    return (
        db.query(RouteAssignment)
        .filter(RouteAssignment.plan_role == plan_role, RouteAssignment.plan_batch_id == current_batch[0])
        .order_by(RouteAssignment.area_code, RouteAssignment.start_date)
        .all()
    )


@router.put("/row/{row_id}", response_model=RouteAssignmentOut, dependencies=[Depends(WRITE_ROLES)])
def edit_plan_row(row_id: int, payload: RouteAssignmentEdit,
                   user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Manual edit - saved permanently and flagged so it survives future
    regenerations of this same role (see route_planner.generate_route_plan's
    "Manual edits are sticky" handling)."""
    row = db.get(RouteAssignment, row_id)
    if not row:
        raise HTTPException(404, "Not found")
    before = {c.name: getattr(row, c.name) for c in RouteAssignment.__table__.columns}
    changes = payload.model_dump(exclude_none=True)
    for k, v in changes.items():
        setattr(row, k, v)
    row.is_manually_edited = True
    row.assignment_reason = "Manually edited by dispatcher"
    db.commit()
    db.refresh(row)
    audit.write_audit(db, f"route_plan_{row.plan_role}_row", str(row_id), "update", user.username, before=before, after=changes)
    return row


class ReorderRequest(BaseModel):
    area_codes: list[str]


@router.put("/reorder", dependencies=[Depends(WRITE_ROLES)])
def reorder_sheet(payload: ReorderRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    ROUTE PLAN SHEET REARRANGEMENT: saves a dispatcher's manual drag-and-
    drop row order, permanently - survives regeneration of either plan
    (see route_planner.generate_route_plan's sort_order preservation) and
    refresh/restart (it's just a normal DB column).
    """
    route_planner.reorder_route_plan_sheet(db, payload.area_codes)
    audit.write_audit(db, "route_plan_sheet", "reorder", "update", user.username, after={"order": payload.area_codes})
    return {"ok": True}


@router.get("/export/excel", dependencies=[Depends(get_current_user)])
def export_plan_excel(plan_role: str = "", db: Session = Depends(get_db)):
    """Professional-formatted export (colors/headers/borders/branding).
    plan_role="" exports both Driver and Helper plans as separate sheets;
    plan_role="combined" exports the single unified Route Plan Sheet in
    the exact column order requested (S/N, Division, Driver Code, Driver
    Name, Area, Helper Code, Helper Name, Vehicle Type, Vehicle Number,
    Route Type, Assignment Reason, Score)."""
    if plan_role == "combined":
        buf = excel_export.export_combined_route_plan_sheet(db)
    else:
        buf = excel_export.export_route_plan_workbook(db, plan_role or None)
    filename = f"RoutePlan_{plan_role or 'All'}_{datetime.utcnow():%Y%m%d}.xlsx"
    return StreamingResponse(
        buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
