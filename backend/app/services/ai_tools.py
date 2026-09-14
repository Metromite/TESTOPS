"""
services/ai_tools.py
------------------------
Gives the AI assistant real task-execution capability - not just Q&A.
This is the scoped version of V1's action_framework.py "AI Operations
Agent" (session/plan/confirm/event-bus) that was previously flagged as
deliberately deferred: same safety principle (propose -> human confirms
-> execute -> audit), simpler mechanism (no separate session/event-bus
tables - reuses the audit log already built for manual edits).

Every mutating tool here writes through audit.write_audit() with the
actor set to "AI Assistant (<username> confirmed)" - so an AI-driven
change shows up in the same Audit Log page as a manual edit, and can be
reverted with the exact same "Undo Last Change" button. No parallel
undo system for AI actions - it's the same one.

SCOPE: Fleet CRUD (drivers/helpers/vehicles/areas/vacations) + triggering
route plan generation. Not included: bulk/destructive operations (mass
delete, database restore) - those stay behind their own explicit UI, not
a chat command, since a natural-language typo shouldn't be able to wipe
a table.
"""
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.fleet import Driver, Helper, Vehicle, Area, Vacation
from app.services import audit


def _actor_label(username: str) -> str:
    return f"AI Assistant ({username} confirmed)"


def _create(db: Session, model, entity_type: str, key_field: str, username: str, fields: dict) -> dict:
    obj = model(**fields)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    key_val = str(getattr(obj, key_field))
    audit.write_audit(db, entity_type, key_val, "create", _actor_label(username), after=fields)
    return {"ok": True, "created": key_val}


def _update(db: Session, model, entity_type: str, key_field: str, username: str, key_val: str, fields: dict) -> dict:
    obj = db.query(model).filter(getattr(model, key_field) == key_val).first()
    if not obj:
        return {"ok": False, "error": f"No {entity_type} found with {key_field}='{key_val}'"}
    before = {f: getattr(obj, f, None) for f in fields}
    for k, v in fields.items():
        if v is not None and hasattr(obj, k):
            setattr(obj, k, v)
    db.commit()
    audit.write_audit(db, entity_type, key_val, "update", _actor_label(username), before=before, after=fields)
    return {"ok": True, "updated": key_val}


def _delete(db: Session, model, entity_type: str, key_field: str, username: str, key_val: str) -> dict:
    obj = db.query(model).filter(getattr(model, key_field) == key_val).first()
    if not obj:
        return {"ok": False, "error": f"No {entity_type} found with {key_field}='{key_val}'"}
    fields = [c.name for c in model.__table__.columns]
    before = {f: getattr(obj, f, None) for f in fields}
    db.delete(obj)
    db.commit()
    audit.write_audit(db, entity_type, key_val, "delete", _actor_label(username), before=before)
    return {"ok": True, "deleted": key_val}


def create_driver(db, username, code, name, veh_type="", anchor_area="", health_card="No", division="", preferred_helper=""):
    return _create(db, Driver, "driver", "code", username, {
        "code": code, "name": name, "veh_type": veh_type, "anchor_area": anchor_area,
        "health_card": health_card, "division": division, "preferred_helper": preferred_helper, "status": "Active",
    })


def update_driver(db, username, code, **fields):
    return _update(db, Driver, "driver", "code", username, code, fields)


def delete_driver(db, username, code):
    return _delete(db, Driver, "driver", "code", username, code)


def create_helper(db, username, code, name, anchor_area="", health_card="No", division=""):
    return _create(db, Helper, "helper", "code", username, {
        "code": code, "name": name, "anchor_area": anchor_area, "health_card": health_card,
        "division": division, "status": "Active",
    })


def update_helper(db, username, code, **fields):
    return _update(db, Helper, "helper", "code", username, code, fields)


def delete_helper(db, username, code):
    return _delete(db, Helper, "helper", "code", username, code)


def create_vehicle(db, username, number, type="VAN", division=""):
    return _create(db, Vehicle, "vehicle", "number", username, {"number": number, "type": type, "division": division, "status": "Active"})


def update_vehicle(db, username, number, **fields):
    return _update(db, Vehicle, "vehicle", "number", username, number, fields)


def delete_vehicle(db, username, number):
    return _delete(db, Vehicle, "vehicle", "number", username, number)


def create_area(db, username, code, name, sector="Pharma", region="", needs_driver="Yes", needs_helper="No", route_type="Main"):
    return _create(db, Area, "area", "code", username, {
        "code": code, "name": name, "sector": sector, "region": region,
        "needs_driver": needs_driver, "needs_helper": needs_helper, "route_type": route_type,
    })


def update_area(db, username, code, **fields):
    return _update(db, Area, "area", "code", username, code, fields)


def delete_area(db, username, code):
    return _delete(db, Area, "area", "code", username, code)


def add_vacation(db, username, person_code, person_name, start_date, end_date):
    return _create(db, Vacation, "vacation", "person_code", username, {
        "person_code": person_code, "person_name": person_name, "start_date": start_date, "end_date": end_date,
    })


def generate_route_plan(db, username, target_date=""):
    from app.services import route_planner
    td = datetime.strptime(target_date, "%Y-%m-%d") if target_date else datetime.utcnow()
    result = route_planner.generate_route_plan_candidates(db, td)
    audit.write_audit(db, "route_plan", td.strftime("%Y-%m-%d"), "create", _actor_label(username),
                       after={"areas_planned": len(result["areas"])})
    top_picks = [
        f"{a['area_name']}: {a['ranked_drivers'][0]['name']}" if a["ranked_drivers"] else f"{a['area_name']}: no candidate"
        for a in result["areas"][:8]
    ]
    return {"ok": True, "areas_planned": len(result["areas"]), "fleet_errors": result["fleet_errors"], "top_picks": top_picks}


TOOL_REGISTRY = {
    "create_driver": {"fn": create_driver, "requires": ["code", "name"], "description": "Add a new driver. Params: code, name, veh_type, anchor_area, health_card (Yes/No), division (Pharma/Consumer), preferred_helper"},
    "update_driver": {"fn": update_driver, "requires": ["code"], "description": "Edit an existing driver by code. Params: code, plus any of name/veh_type/anchor_area/health_card/division/preferred_helper/status to change"},
    "delete_driver": {"fn": delete_driver, "requires": ["code"], "description": "Remove a driver by code. Params: code"},
    "create_helper": {"fn": create_helper, "requires": ["code", "name"], "description": "Add a new helper. Params: code, name, anchor_area, health_card, division"},
    "update_helper": {"fn": update_helper, "requires": ["code"], "description": "Edit an existing helper by code. Params: code, plus fields to change"},
    "delete_helper": {"fn": delete_helper, "requires": ["code"], "description": "Remove a helper by code. Params: code"},
    "create_vehicle": {"fn": create_vehicle, "requires": ["number"], "description": "Add a new vehicle. Params: number, type (VAN/PICK-UP/BUS/2-8 VAN/2-8 PICK-UP), division"},
    "update_vehicle": {"fn": update_vehicle, "requires": ["number"], "description": "Edit a vehicle by number. Params: number, plus fields to change (type/division/status)"},
    "delete_vehicle": {"fn": delete_vehicle, "requires": ["number"], "description": "Remove a vehicle by number. Params: number"},
    "create_area": {"fn": create_area, "requires": ["code", "name"], "description": "Add a new area/route. Params: code, name, sector (Pharma/Consumer/Govt/Pick-Up), region, needs_driver, needs_helper, route_type (Main/Replacement)"},
    "update_area": {"fn": update_area, "requires": ["code"], "description": "Edit an area by code. Params: code, plus fields to change"},
    "delete_area": {"fn": delete_area, "requires": ["code"], "description": "Remove an area by code. Params: code"},
    "add_vacation": {"fn": add_vacation, "requires": ["person_code", "person_name", "start_date", "end_date"], "description": "Add a vacation period for a driver/helper. Params: person_code, person_name, start_date (YYYY-MM-DD), end_date (YYYY-MM-DD)"},
    "generate_route_plan": {"fn": generate_route_plan, "requires": [], "description": "Run the route planning engine for a date. Params: target_date (YYYY-MM-DD, optional - defaults to today)"},
}


def describe_tools_for_prompt() -> str:
    return "\n".join(f"- {name}: {info['description']}" for name, info in TOOL_REGISTRY.items())


def execute_tool(db: Session, username: str, tool: str, params: dict) -> dict:
    info = TOOL_REGISTRY.get(tool)
    if not info:
        return {"ok": False, "error": f"Unknown tool '{tool}'"}
    missing = [p for p in info["requires"] if not params.get(p)]
    if missing:
        return {"ok": False, "error": f"Missing required parameter(s): {', '.join(missing)}"}
    try:
        return info["fn"](db, username, **params)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
