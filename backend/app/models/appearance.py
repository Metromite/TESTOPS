"""
models/appearance.py
-----------------------
Stores the light-mode and dark-mode background images as uploaded files
(saved to disk, path stored here) - lets someone change the app's
background at any time from Settings without needing a code change or
redeploy. Falls back to the default ambient gradient (index.css) when no
custom image has been set for that mode.
"""
from datetime import datetime

from sqlalchemy import String, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AppearanceConfig(Base):
    __tablename__ = "appearance_config"

    id: Mapped[int] = mapped_column(primary_key=True)  # singleton row, id=1
    light_bg_path: Mapped[str] = mapped_column(String(500), default="")
    dark_bg_path: Mapped[str] = mapped_column(String(500), default="")
    updated_by: Mapped[str] = mapped_column(String(64), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
