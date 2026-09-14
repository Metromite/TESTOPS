"""
models/feature_flags.py
--------------------------
Direct port of feature_flags.py's philosophy: an unknown or unset flag
defaults to OFF, never crashes anything, and hiding an unfinished feature
is always the safe failure mode. Storage moved from a local YAML file to
a shared Postgres table, since multiple Admins now manage one shared
instance instead of one person editing a file on their own machine.
"""
from datetime import datetime

from sqlalchemy import String, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class FeatureFlag(Base):
    __tablename__ = "feature_flags"

    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    description: Mapped[str] = mapped_column(String(255), default="")
    updated_by: Mapped[str] = mapped_column(String(64), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
