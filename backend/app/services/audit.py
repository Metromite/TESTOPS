import json
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLogEntry


def write_audit(db: Session, entity_type: str, entity_key: str, action: str, actor: str,
                 before: dict | None = None, after: dict | None = None,
                 success: bool = True, error_message: str = "", duration_ms: int = 0):
    entry = AuditLogEntry(
        entity_type=entity_type, entity_key=entity_key, action=action, actor=actor,
        before_state_json=json.dumps(before) if before is not None else "",
        after_state_json=json.dumps(after) if after is not None else "",
        success=success, error_message=error_message, duration_ms=duration_ms,
    )
    db.add(entry)
    db.commit()
    return entry.id


def get_recent_audit(db: Session, entity_type: str = "", limit: int = 100) -> list[dict]:
    q = db.query(AuditLogEntry)
    if entity_type:
        q = q.filter(AuditLogEntry.entity_type == entity_type)
    rows = q.order_by(AuditLogEntry.timestamp.desc()).limit(limit).all()
    return [{
        "id": r.id, "entity_type": r.entity_type, "entity_key": r.entity_key, "action": r.action,
        "actor": r.actor, "success": r.success, "error_message": r.error_message,
        "undone": r.undone, "timestamp": r.timestamp.isoformat(),
    } for r in rows]


def get_action_stats(db: Session) -> dict:
    """Per-entity-type call counts and failure counts, computed from the
    real audit log - matching V1's own principle of one source of truth
    rather than tracking stats separately."""
    stats: dict = {}
    for r in db.query(AuditLogEntry).all():
        s = stats.setdefault(r.entity_type, {"total_calls": 0, "failures": 0, "last_run": None})
        s["total_calls"] += 1
        if not r.success:
            s["failures"] += 1
        ts = r.timestamp.isoformat()
        if s["last_run"] is None or ts > s["last_run"]:
            s["last_run"] = ts
    return stats


def undo_last_change(db: Session, model, entity_type: str, key_field: str, actor: str) -> dict:
    """
    Reverts the most recent non-undone change for this entity type, using
    the before/after snapshot captured at the time - a genuine per-table
    undo, not a placeholder. Marks the entry as undone so it can't be
    undone twice.
    """
    entry = (
        db.query(AuditLogEntry)
        .filter(AuditLogEntry.entity_type == entity_type, AuditLogEntry.undone == False)  # noqa: E712
        .order_by(AuditLogEntry.timestamp.desc())
        .first()
    )
    if not entry:
        return {"ok": False, "error": "No recent change to undo for this table."}

    if entry.action == "update":
        before = json.loads(entry.before_state_json)
        row = db.query(model).filter(getattr(model, key_field) == entry.entity_key).first()
        if not row:
            return {"ok": False, "error": "The record no longer exists - can't undo an edit to something that's been deleted."}
        for k, v in before.items():
            if hasattr(row, k):
                setattr(row, k, v)
    elif entry.action == "create":
        row = db.query(model).filter(getattr(model, key_field) == entry.entity_key).first()
        if row:
            db.delete(row)
    elif entry.action == "delete":
        before = json.loads(entry.before_state_json)
        db.add(model(**before))

    entry.undone = True
    db.commit()
    return {"ok": True, "undid_action": entry.action, "entity_key": entry.entity_key}
