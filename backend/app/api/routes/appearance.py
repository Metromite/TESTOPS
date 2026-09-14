import os
import uuid

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user, require_roles
from app.models.user import Role, User
from app.models.appearance import AppearanceConfig

router = APIRouter(prefix="/api/appearance", tags=["appearance"])

_BG_DIR = os.path.join(settings.IMPORT_FOLDER, "..", "backgrounds")


def _get_config(db: Session) -> AppearanceConfig:
    cfg = db.get(AppearanceConfig, 1)
    if not cfg:
        cfg = AppearanceConfig(id=1)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


@router.get("", dependencies=[Depends(get_current_user)])
def get_appearance(db: Session = Depends(get_db)):
    cfg = _get_config(db)
    return {
        "light_bg_url": "/api/appearance/image/light" if cfg.light_bg_path else None,
        "dark_bg_url": "/api/appearance/image/dark" if cfg.dark_bg_path else None,
    }


@router.get("/image/{mode}")
def get_background_image(mode: str, db: Session = Depends(get_db)):
    """Public (no auth) - this is loaded directly as an <img>/CSS
    background-image src by the browser, which can't attach an
    Authorization header to that kind of request."""
    if mode not in ("light", "dark"):
        raise HTTPException(404, "Unknown mode")
    cfg = _get_config(db)
    path = cfg.light_bg_path if mode == "light" else cfg.dark_bg_path
    if not path or not os.path.isfile(path):
        raise HTTPException(404, "No background image set for this mode yet")
    return FileResponse(path)


@router.post("/upload/{mode}", dependencies=[Depends(require_roles(Role.ADMIN))])
async def upload_background(mode: str, file: UploadFile = File(...), user: User = Depends(get_current_user),
                             db: Session = Depends(get_db)):
    """Admin-only: change the light or dark mode background image at any
    time - no code change or redeploy needed."""
    if mode not in ("light", "dark"):
        raise HTTPException(400, "mode must be 'light' or 'dark'")

    os.makedirs(_BG_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1] or ".jpg"
    dest = os.path.join(_BG_DIR, f"{mode}_{uuid.uuid4().hex}{ext}")
    with open(dest, "wb") as f:
        f.write(await file.read())

    cfg = _get_config(db)
    old_path = cfg.light_bg_path if mode == "light" else cfg.dark_bg_path
    if mode == "light":
        cfg.light_bg_path = dest
    else:
        cfg.dark_bg_path = dest
    cfg.updated_by = user.username
    db.commit()

    if old_path and os.path.isfile(old_path):
        try:
            os.remove(old_path)
        except OSError:
            pass

    return {"ok": True, "mode": mode}


@router.delete("/reset/{mode}", dependencies=[Depends(require_roles(Role.ADMIN))])
def reset_background(mode: str, db: Session = Depends(get_db)):
    """Removes the custom background, falling back to the default ambient gradient."""
    if mode not in ("light", "dark"):
        raise HTTPException(400, "mode must be 'light' or 'dark'")
    cfg = _get_config(db)
    path = cfg.light_bg_path if mode == "light" else cfg.dark_bg_path
    if mode == "light":
        cfg.light_bg_path = ""
    else:
        cfg.dark_bg_path = ""
    db.commit()
    if path and os.path.isfile(path):
        try:
            os.remove(path)
        except OSError:
            pass
    return {"ok": True}
