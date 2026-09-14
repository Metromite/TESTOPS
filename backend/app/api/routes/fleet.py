from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.core.database import get_db
from app.core.security import require_roles, get_current_user
from app.models.user import Role, User
from app.models.fleet import Driver, Helper, Area, Vehicle, Vacation, AreaAnchoredVehicle, VehiclePermittedArea
from app.models.area_groups import (
    AreaGroup, AreaGroupMember, VehiclePermittedAreaGroup, DriverAnchoredArea, DriverAnchoredAreaGroup,
)
from app.models import reference_data as ref
from app.schemas import schemas as s
from app.services import table_io, audit

router = APIRouter(prefix="/api", tags=["fleet"])

# Admin + Dispatcher can write; Viewer is read-only everywhere, per spec.
WRITE_ROLES = require_roles(Role.ADMIN, Role.DISPATCHER)
READ_ROLES = Depends(get_current_user)


def _crud_router(prefix: str, model, in_schema, out_schema, key_field: str, fields: list[str],
                  match_existing: bool = True, secondary_key_fields: list[str] | None = None,
                  after_write=None, before_read=None, normalizers: dict | None = None):
    """
    after_write(db, obj, payload_dict): called after create/update commits -
    for side-table writes that aren't plain columns on `model` (e.g. an
    Area's anchored_vehicle_ids, which lives in AreaAnchoredVehicle).
    before_read(db, objs): called before serializing a list of objects -
    for attaching transient (non-column) display attributes (e.g. an
    Area's `.anchored_vehicles` list for the response).
    """
    r = APIRouter(prefix=f"/{prefix}", tags=[prefix])
    entity_type = prefix.rstrip("s")  # "drivers" -> "driver", etc.

    def _model_kwargs(payload) -> dict:
        """Only pass through keys that are real columns on `model` - a
        schema (like AreaIn) may carry extra fields (like
        anchored_vehicle_ids) that are handled separately via after_write."""
        return {k: v for k, v in payload.model_dump().items() if k in fields}

    @r.get("", response_model=list[out_schema], dependencies=[READ_ROLES])
    def list_all(db: Session = Depends(get_db)):
        objs = db.query(model).all()
        if before_read:
            before_read(db, objs)
        return objs

    @r.post("", response_model=out_schema, dependencies=[Depends(WRITE_ROLES)])
    def create(payload: in_schema, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        obj = model(**_model_kwargs(payload))
        db.add(obj)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(400, f"A {entity_type} with these exact values already exists.")
        db.refresh(obj)
        if after_write:
            after_write(db, obj, payload.model_dump())
        if before_read:
            before_read(db, [obj])
        key_val = str(getattr(obj, key_field))
        audit.write_audit(db, entity_type, key_val, "create", user.username, after=payload.model_dump())
        return obj

    @r.put("/{item_id}", response_model=out_schema, dependencies=[Depends(WRITE_ROLES)])
    def update(item_id: int, payload: in_schema, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        obj = db.get(model, item_id)
        if not obj:
            raise HTTPException(404, "Not found")
        before = {f: getattr(obj, f, None) for f in fields}
        for k, v in _model_kwargs(payload).items():
            setattr(obj, k, v)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(400, f"A {entity_type} with these exact values already exists.")
        db.refresh(obj)
        if after_write:
            after_write(db, obj, payload.model_dump())
        if before_read:
            before_read(db, [obj])
        key_val = str(getattr(obj, key_field))
        audit.write_audit(db, entity_type, key_val, "update", user.username, before=before, after=payload.model_dump())
        return obj

    @r.delete("/{item_id}", dependencies=[Depends(WRITE_ROLES)])
    def delete(item_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        obj = db.get(model, item_id)
        if not obj:
            raise HTTPException(404, "Not found")
        before = {f: getattr(obj, f, None) for f in fields}
        key_val = str(getattr(obj, key_field))
        db.delete(obj)
        db.commit()
        audit.write_audit(db, entity_type, key_val, "delete", user.username, before=before)
        return {"deleted": item_id}

    @r.post("/undo-last", dependencies=[Depends(WRITE_ROLES)])
    def undo_last(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        """Reverts the most recent create/update/delete on this table,
        using the before/after snapshot captured at the time."""
        return audit.undo_last_change(db, model, entity_type, key_field, user.username)

    @r.get("/export-excel", dependencies=[READ_ROLES])
    def export_excel(db: Session = Depends(get_db)):
        """Downloads every row as an .xlsx - re-uploading the same file
        (with edits) via /import-excel updates matching rows in place."""
        rows = db.query(model).all()
        buf = table_io.export_table_to_excel(rows, fields, prefix.capitalize())
        return StreamingResponse(
            buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{prefix}.xlsx"'},
        )

    @r.post("/import-excel", dependencies=[Depends(WRITE_ROLES)])
    async def import_excel(file: UploadFile = File(...), db: Session = Depends(get_db)):
        """Bulk create/update from an uploaded .xlsx - matched by the
        table's natural key, so re-uploading a corrected sheet is safe."""
        content = await file.read()
        result = table_io.import_table_from_excel(
            db, model, key_field, fields, content,
            match_existing=match_existing, secondary_key_fields=secondary_key_fields, normalizers=normalizers,
        )
        if not result["ok"]:
            raise HTTPException(400, result["error"])
        return result

    return r


def _sync_area_anchored_vehicles(db: Session, area: Area, payload_dict: dict) -> None:
    """after_write hook: replaces an Area's anchored-vehicle set with
    whatever was submitted. Anchored vehicles are the normal assigned
    vehicle(s) for the area (not just a preference) - Route Planner tries
    these first (see services/route_planner.py, extended separately)."""
    vehicle_ids = payload_dict.get("anchored_vehicle_ids") or []
    db.query(AreaAnchoredVehicle).filter(AreaAnchoredVehicle.area_id == area.id).delete()
    for vid in vehicle_ids:
        db.add(AreaAnchoredVehicle(area_id=area.id, vehicle_id=vid))
    db.commit()


def _attach_area_anchored_vehicles(db: Session, areas: list[Area]) -> None:
    """before_read hook: attaches a transient `.anchored_vehicles` list of
    {id, number, type} dicts to each Area instance for the API response -
    not a mapped column, just populated here for serialization."""
    if not areas:
        return
    area_ids = [a.id for a in areas]
    rows = (
        db.query(AreaAnchoredVehicle, Vehicle)
        .join(Vehicle, Vehicle.id == AreaAnchoredVehicle.vehicle_id)
        .filter(AreaAnchoredVehicle.area_id.in_(area_ids))
        .all()
    )
    by_area: dict[int, list[dict]] = {}
    for aav, veh in rows:
        by_area.setdefault(aav.area_id, []).append({"id": veh.id, "number": veh.number, "type": veh.type})
    for a in areas:
        a.anchored_vehicles = by_area.get(a.id, [])


def _sync_vehicle_permitted_areas(db: Session, vehicle: Vehicle, payload_dict: dict) -> None:
    """after_write hook: Permitted Areas system - which Areas (individually
    and/or via whole Area Groups) a vehicle may operate in. No rows in
    EITHER table = no restriction (usable anywhere)."""
    area_ids = payload_dict.get("permitted_area_ids") or []
    group_ids = payload_dict.get("permitted_area_group_ids") or []
    db.query(VehiclePermittedArea).filter(VehiclePermittedArea.vehicle_id == vehicle.id).delete()
    db.query(VehiclePermittedAreaGroup).filter(VehiclePermittedAreaGroup.vehicle_id == vehicle.id).delete()
    for aid in area_ids:
        db.add(VehiclePermittedArea(vehicle_id=vehicle.id, area_id=aid))
    for gid in group_ids:
        db.add(VehiclePermittedAreaGroup(vehicle_id=vehicle.id, group_id=gid))
    db.commit()


def _attach_vehicle_permitted_areas(db: Session, vehicles: list[Vehicle]) -> None:
    """before_read hook: attaches transient `.permitted_areas` /
    `.permitted_area_groups` display lists plus the raw id lists (so the
    edit form can re-select exactly what was saved) for the API response."""
    if not vehicles:
        return
    vehicle_ids = [v.id for v in vehicles]
    area_rows = (
        db.query(VehiclePermittedArea, Area)
        .join(Area, Area.id == VehiclePermittedArea.area_id)
        .filter(VehiclePermittedArea.vehicle_id.in_(vehicle_ids))
        .all()
    )
    by_vehicle_areas: dict[int, list[dict]] = {}
    for vpa, area in area_rows:
        by_vehicle_areas.setdefault(vpa.vehicle_id, []).append({"id": area.id, "code": area.code, "name": area.name})

    group_rows = (
        db.query(VehiclePermittedAreaGroup, AreaGroup)
        .join(AreaGroup, AreaGroup.id == VehiclePermittedAreaGroup.group_id)
        .filter(VehiclePermittedAreaGroup.vehicle_id.in_(vehicle_ids))
        .all()
    )
    by_vehicle_groups: dict[int, list[dict]] = {}
    for vpag, group in group_rows:
        by_vehicle_groups.setdefault(vpag.vehicle_id, []).append({"id": group.id, "name": group.name})

    for v in vehicles:
        v.permitted_areas = by_vehicle_areas.get(v.id, [])
        v.permitted_area_groups = by_vehicle_groups.get(v.id, [])
        v.permitted_area_ids = [a["id"] for a in v.permitted_areas]
        v.permitted_area_group_ids = [g["id"] for g in v.permitted_area_groups]


def _sync_driver_anchored_areas(db: Session, driver: Driver, payload_dict: dict) -> None:
    """after_write hook: Driver Anchoring - structured multi-select
    (individual Areas and/or whole Area Groups), sibling system to Vehicle
    Permitted Areas. This is purely additive: see
    services/route_planner.py's _driver_anchor_extra_map(), which merges
    these into the SAME comma-separated `anchor_area` string the existing
    (unmodified) scoring engine already reads - the legacy free-text
    anchor_area field on Driver keeps working exactly as before."""
    area_ids = payload_dict.get("anchored_area_ids") or []
    group_ids = payload_dict.get("anchored_area_group_ids") or []
    db.query(DriverAnchoredArea).filter(DriverAnchoredArea.driver_id == driver.id).delete()
    db.query(DriverAnchoredAreaGroup).filter(DriverAnchoredAreaGroup.driver_id == driver.id).delete()
    for i, aid in enumerate(area_ids):
        db.add(DriverAnchoredArea(driver_id=driver.id, area_id=aid, sort_order=i))
    for i, gid in enumerate(group_ids):
        db.add(DriverAnchoredAreaGroup(driver_id=driver.id, group_id=gid, sort_order=i))
    db.commit()


def _attach_driver_anchored_areas(db: Session, drivers: list[Driver]) -> None:
    """before_read hook: attaches transient `.anchored_areas` /
    `.anchored_groups` display lists plus the raw id lists, ordered by the
    saved sort_order (reorderable chips in the UI)."""
    if not drivers:
        return
    driver_ids = [d.id for d in drivers]
    area_rows = (
        db.query(DriverAnchoredArea, Area)
        .join(Area, Area.id == DriverAnchoredArea.area_id)
        .filter(DriverAnchoredArea.driver_id.in_(driver_ids))
        .order_by(DriverAnchoredArea.sort_order)
        .all()
    )
    by_driver_areas: dict[int, list[dict]] = {}
    for daa, area in area_rows:
        by_driver_areas.setdefault(daa.driver_id, []).append({"id": area.id, "code": area.code, "name": area.name})

    group_rows = (
        db.query(DriverAnchoredAreaGroup, AreaGroup)
        .join(AreaGroup, AreaGroup.id == DriverAnchoredAreaGroup.group_id)
        .filter(DriverAnchoredAreaGroup.driver_id.in_(driver_ids))
        .order_by(DriverAnchoredAreaGroup.sort_order)
        .all()
    )
    by_driver_groups: dict[int, list[dict]] = {}
    for dag, group in group_rows:
        by_driver_groups.setdefault(dag.driver_id, []).append({"id": group.id, "name": group.name})

    for d in drivers:
        d.anchored_areas = by_driver_areas.get(d.id, [])
        d.anchored_groups = by_driver_groups.get(d.id, [])
        d.anchored_area_ids = [a["id"] for a in d.anchored_areas]
        d.anchored_area_group_ids = [g["id"] for g in d.anchored_groups]


router.include_router(_crud_router(
    "drivers", Driver, s.DriverIn, s.DriverOut, "code",
    ["code", "name", "veh_type", "anchor_area", "health_card", "division", "preferred_helper", "status"],
    after_write=_sync_driver_anchored_areas,
    before_read=_attach_driver_anchored_areas,
))
router.include_router(_crud_router(
    "helpers", Helper, s.HelperIn, s.HelperOut, "code",
    ["code", "name", "anchor_area", "health_card", "division", "status"],
))
router.include_router(_crud_router(
    "areas", Area, s.AreaIn, s.AreaOut, "code",
    ["code", "name", "sector", "needs_driver", "needs_helper", "route_type", "vehicle_type"],
    secondary_key_fields=["name", "sector"],
    after_write=_sync_area_anchored_vehicles,
    before_read=_attach_area_anchored_vehicles,
    normalizers={
        "needs_driver": ref.normalize_requirement, "needs_helper": ref.normalize_requirement,
        "route_type": ref.normalize_route_type, "vehicle_type": ref.normalize_vehicle_type,
    },
))
router.include_router(_crud_router(
    "vehicles", Vehicle, s.VehicleIn, s.VehicleOut, "number",
    ["number", "type", "division", "status"],
    after_write=_sync_vehicle_permitted_areas,
    before_read=_attach_vehicle_permitted_areas,
    normalizers={"type": ref.normalize_vehicle_type},
))
router.include_router(_crud_router(
    "vacations", Vacation, s.VacationIn, s.VacationOut, "person_code",
    ["person_code", "person_name", "person_type", "start_date", "end_date"],
    match_existing=False,  # person_code repeats across a person's multiple vacation periods - always append
))


@router.get("/meta/options", dependencies=[READ_ROLES])
def area_vehicle_options():
    """Canonical dropdown domains for the frontend (Areas + Vehicle DB
    redesign) - single source of truth, see models/reference_data.py."""
    return {
        "vehicle_types": ref.VEHICLE_TYPES,
        "divisions": ref.DIVISIONS,
        "division_restrictions": ref.DIVISION_RESTRICTIONS,
        "requirement_levels": ref.REQUIREMENT_LEVELS,
        "route_types": ref.ROUTE_TYPES,
    }


@router.get("/vehicles/search", dependencies=[READ_ROLES])
def search_vehicles(q: str = "", limit: int = 15, db: Session = Depends(get_db)):
    """Predictive autocomplete for anchored-vehicle selection - matches
    partial vehicle numbers, most relevant (startswith) first."""
    query = db.query(Vehicle)
    if q:
        query = query.filter(Vehicle.number.ilike(f"%{q}%"))
    rows = query.order_by(Vehicle.number).limit(200).all()
    if q:
        q_upper = q.upper()
        rows = sorted(rows, key=lambda v: 0 if v.number.upper().startswith(q_upper) else 1)
    rows = rows[:limit]
    return [{"id": v.id, "number": v.number, "type": v.type, "division": v.division} for v in rows]


@router.get("/autocomplete/{field}", dependencies=[READ_ROLES])
def autocomplete(field: str, q: str = "", limit: int = 15, db: Session = Depends(get_db)):
    """
    Unified predictive autocomplete for the fields the V2 milestone asks
    for. Area Code/Name, Vehicle Number, Driver, Helper, Vehicle Type,
    Division, Route Type are sourced LIVE from their own authoritative
    tables/reference_data - a newly added row is available immediately,
    with no separate "learning" step. Customer/Salesman come from
    LearnedValue, populated automatically on every SAP import (see
    services/master_data_learning.py).
    """
    from app.models.master_data import LearnedValue

    q_upper = q.upper()

    def rank(items: list[str]) -> list[str]:
        if q:
            items = sorted(set(items), key=lambda v: (0 if v.upper().startswith(q_upper) else 1, v))
        else:
            items = sorted(set(items))
        return items[:limit]

    if field == "area_code":
        rows = db.query(Area.code).filter(Area.code.ilike(f"%{q}%")).all() if q else db.query(Area.code).limit(200).all()
        return rank([r[0] for r in rows])
    if field == "area_name":
        rows = db.query(Area.name).filter(Area.name.ilike(f"%{q}%")).all() if q else db.query(Area.name).limit(200).all()
        return rank([r[0] for r in rows])
    if field == "vehicle_number":
        rows = db.query(Vehicle.number).filter(Vehicle.number.ilike(f"%{q}%")).all() if q else db.query(Vehicle.number).limit(200).all()
        return rank([r[0] for r in rows])
    if field == "driver":
        rows = db.query(Driver.code, Driver.name).filter(
            (Driver.code.ilike(f"%{q}%")) | (Driver.name.ilike(f"%{q}%"))
        ).limit(200).all() if q else db.query(Driver.code, Driver.name).limit(200).all()
        return rank([f"{c} - {n}" if n else c for c, n in rows])
    if field == "helper":
        rows = db.query(Helper.code, Helper.name).filter(
            (Helper.code.ilike(f"%{q}%")) | (Helper.name.ilike(f"%{q}%"))
        ).limit(200).all() if q else db.query(Helper.code, Helper.name).limit(200).all()
        return rank([f"{c} - {n}" if n else c for c, n in rows])
    if field == "vehicle_type":
        return rank([t for t in ref.VEHICLE_TYPES if not q or q_upper in t.upper()])
    if field == "division":
        return rank([d for d in ref.DIVISIONS if not q or q_upper in d.upper()])
    if field == "route_type":
        return rank([r for r in ref.ROUTE_TYPES if not q or q_upper in r.upper()])
    if field in ("salesman", "customer"):
        query = db.query(LearnedValue.value).filter(LearnedValue.category == field)
        if q:
            query = query.filter(LearnedValue.value.ilike(f"%{q}%"))
        rows = query.limit(200).all()
        return rank([r[0] for r in rows])

    raise HTTPException(400, f"Unknown autocomplete field: {field}")


@router.get("/areas/search", dependencies=[READ_ROLES])
def search_areas(q: str = "", limit: int = 15, db: Session = Depends(get_db)):
    """
    Predictive autocomplete for the Permitted Areas / Driver Anchored
    Areas multi-selects - matches partial Area Code OR Area Name, most
    relevant (startswith) first. This was previously defined without a
    route decorator (dead code, never reachable) - that missing decorator
    was the actual reason Permitted Areas required manually typing Area
    Codes instead of using this predictive search.
    """
    query = db.query(Area)
    if q:
        query = query.filter((Area.code.ilike(f"%{q}%")) | (Area.name.ilike(f"%{q}%")))
    rows = query.order_by(Area.code).limit(200).all()
    if q:
        q_upper = q.upper()
        rows = sorted(rows, key=lambda a: 0 if a.code.upper().startswith(q_upper) or a.name.upper().startswith(q_upper) else 1)
    rows = rows[:limit]
    return [{"id": a.id, "code": a.code, "name": a.name, "sector": a.sector} for a in rows]


# ---------------------------------------------------------------------------
# AREA GROUPS - new master data section. A group is just a named set of
# Areas (membership in AreaGroupMember); Permitted Areas and Driver
# Anchoring can each reference either individual Areas or whole groups
# (see _sync_vehicle_permitted_areas / _sync_driver_anchored_areas above,
# and route_planner.py's expand_permitted_area_ids / _driver_anchor_extra_map
# for how a group is "expanded" into its member Areas wherever it's used).
# ---------------------------------------------------------------------------

def _attach_group_areas(db: Session, groups: list[AreaGroup]) -> None:
    if not groups:
        return
    group_ids = [g.id for g in groups]
    rows = (
        db.query(AreaGroupMember, Area)
        .join(Area, Area.id == AreaGroupMember.area_id)
        .filter(AreaGroupMember.group_id.in_(group_ids))
        .order_by(Area.code)
        .all()
    )
    by_group: dict[int, list[dict]] = {}
    for member, area in rows:
        by_group.setdefault(member.group_id, []).append({"id": area.id, "code": area.code, "name": area.name, "sector": area.sector})
    for g in groups:
        g.areas = by_group.get(g.id, [])


@router.get("/area-groups", response_model=list[s.AreaGroupOut], dependencies=[READ_ROLES])
def list_area_groups(q: str = "", db: Session = Depends(get_db)):
    query = db.query(AreaGroup)
    if q:
        query = query.filter(AreaGroup.name.ilike(f"%{q}%"))
    groups = query.order_by(AreaGroup.name).all()
    _attach_group_areas(db, groups)
    return groups


@router.post("/area-groups", response_model=s.AreaGroupOut, dependencies=[Depends(WRITE_ROLES)])
def create_area_group(payload: s.AreaGroupIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    group = AreaGroup(name=payload.name)
    db.add(group)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, f"An Area Group named '{payload.name}' already exists.")
    db.refresh(group)
    for aid in payload.area_ids:
        db.add(AreaGroupMember(group_id=group.id, area_id=aid))
    db.commit()
    _attach_group_areas(db, [group])
    audit.write_audit(db, "area_group", str(group.id), "create", user.username, after=payload.model_dump())
    return group


@router.put("/area-groups/{group_id}", response_model=s.AreaGroupOut, dependencies=[Depends(WRITE_ROLES)])
def update_area_group(group_id: int, payload: s.AreaGroupIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    group = db.get(AreaGroup, group_id)
    if not group:
        raise HTTPException(404, "Not found")
    before = {"name": group.name, "area_ids": [m.area_id for m in db.query(AreaGroupMember).filter(AreaGroupMember.group_id == group_id).all()]}
    group.name = payload.name
    db.query(AreaGroupMember).filter(AreaGroupMember.group_id == group_id).delete()
    for aid in payload.area_ids:
        db.add(AreaGroupMember(group_id=group.id, area_id=aid))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, f"An Area Group named '{payload.name}' already exists.")
    db.refresh(group)
    _attach_group_areas(db, [group])
    audit.write_audit(db, "area_group", str(group_id), "update", user.username, before=before, after=payload.model_dump())
    return group


@router.delete("/area-groups/{group_id}", dependencies=[Depends(WRITE_ROLES)])
def delete_area_group(group_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Deleting a group also removes it from any Vehicle's Permitted Areas
    or Driver's Anchored Areas that reference it (ON DELETE CASCADE on
    VehiclePermittedAreaGroup / DriverAnchoredAreaGroup) - it does NOT
    delete the underlying Areas themselves, only the grouping."""
    group = db.get(AreaGroup, group_id)
    if not group:
        raise HTTPException(404, "Not found")
    name = group.name
    db.delete(group)
    db.commit()
    audit.write_audit(db, "area_group", str(group_id), "delete", user.username, before={"name": name})
    return {"deleted": group_id}
