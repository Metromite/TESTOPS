"""
api/routes/control_center.py
------------------------------
Shared backend store for the Operations Control Center's config
(playlists, scheduler, branding, display assignments) - see
models/control_center.py. Any authenticated user/display can read it;
only Admins can write it, same split as appearance.py's
upload/reset-vs-get pattern.

The frontend (pages/ControlCenter.tsx) still keeps a localStorage copy as
an offline fallback and still supports manual JSON export/import - this
endpoint is the primary path, not a replacement that removes the old one,
since a TV that briefly loses network shouldn't go blank.

round -10 additions:
  - Optimistic locking: PUT must include the `version` the client last
    saw. If it doesn't match the current row's version, the write is
    rejected with 409 and the current server config/version, instead of
    silently overwriting whatever another admin/display just saved.
    Deliberately NOT a field-level merge - the loser's edit is dropped and
    the frontend adopts the server's latest copy. That's a real, honest
    limitation for two admins editing at literally the same moment, but it
    replaces silent data loss with a visible, correct outcome.
  - A WebSocket broadcast (`/ws`) so every connected display refreshes the
    instant any other display/admin saves, instead of waiting for its own
    next debounce timer or manual refresh. This is scoped specifically to
    Control Center config - it is NOT the general "only update changed
    dashboard data" websocket layer the original spec described for every
    KPI/chart; that remains unbuilt (see ControlCenter.tsx's header
    comment).
  - No auth on the websocket: browsers can't attach an Authorization
    header to a WebSocket handshake, and everything it broadcasts is the
    same data the authenticated GET already returns (matching how
    appearance.py's image endpoint is public for the same reason). If
    AUTH_DISABLED is ever turned off, revisit this - a token-in-query-param
    scheme (like jobs.py's SSE stream) would be the next step, not shipped
    here since AUTH_DISABLED is still True project-wide.
"""
import json
from typing import Optional

from fastapi import APIRouter, Depends, Body, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.core.database import get_db, SessionLocal
from app.core.security import get_current_user, require_roles
from app.models.user import Role, User
from app.models.control_center import ControlCenterConfig

router = APIRouter(prefix="/api/control-center", tags=["control-center"])


def _get_row(db: Session) -> ControlCenterConfig:
    cfg = db.get(ControlCenterConfig, 1)
    if not cfg:
        cfg = ControlCenterConfig(id=1, config_json="", version=1)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def _serialize(row: ControlCenterConfig) -> dict:
    config = None
    if row.config_json:
        try:
            config = json.loads(row.config_json)
        except (json.JSONDecodeError, TypeError):
            config = None  # corrupt/legacy row - report "no config" rather than 500
    return {
        "config": config,
        "version": row.version,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "updated_by": row.updated_by,
    }


@router.get("/config", dependencies=[Depends(get_current_user)])
def get_config(db: Session = Depends(get_db)):
    return _serialize(_get_row(db))


@router.put("/config", dependencies=[Depends(require_roles(Role.ADMIN))])
def put_config(
    body: dict = Body(...),
    expected_version: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _get_row(db)
    if expected_version is not None and expected_version != row.version:
        # Someone else saved since this client last loaded - refuse the
        # write and hand back the current state so the client can adopt it
        # instead of the two writers silently clobbering each other.
        raise HTTPException(status_code=409, detail=_serialize(row))

    row.config_json = json.dumps(body)
    row.version = row.version + 1
    row.updated_by = user.username
    db.commit()
    db.refresh(row)
    payload = _serialize(row)
    try:
        _broadcast(payload)
    except Exception:
        pass  # a broadcast hiccup should never fail the actual save
    return payload


# ---- WebSocket broadcast: push the new config to every connected display
# the moment anyone saves, instead of each display waiting on its own poll
# interval. In-process connection list - only fans out within a single
# backend process/worker; a multi-worker deployment would need a shared
# pub/sub (e.g. Postgres LISTEN/NOTIFY or Redis) to reach displays
# connected to a different worker. Not built - this app runs a single
# uvicorn worker today (see start_server scripts), so it wasn't needed to
# make this actually work, but it's a real limit if that ever changes.
_connections: list[WebSocket] = []


def _broadcast(payload: dict):
    import anyio

    async def _send_all():
        dead = []
        for ws in _connections:
            try:
                await ws.send_json({"type": "config_update", **payload})
            except Exception:
                dead.append(ws)
        for ws in dead:
            if ws in _connections:
                _connections.remove(ws)

    try:
        anyio.from_thread.run(_send_all)
    except RuntimeError:
        # put_config runs inside the same event loop (FastAPI route, not a
        # separate thread) in the normal request path, so call directly.
        import asyncio
        asyncio.get_event_loop().create_task(_send_all())


@router.websocket("/ws")
async def config_ws(websocket: WebSocket):
    await websocket.accept()
    _connections.append(websocket)
    try:
        # Send the current state immediately on connect, so a display that
        # was offline and just reconnected doesn't wait for someone else's
        # next save to catch up.
        db = SessionLocal()
        try:
            await websocket.send_json({"type": "config_update", **_serialize(_get_row(db))})
        finally:
            db.close()
        while True:
            # We don't expect the client to send anything - just keep the
            # connection open and detect disconnects via the exception.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in _connections:
            _connections.remove(websocket)
