"""
models/control_center.py
--------------------------
Persists the Operations Control Center's config (playlists, scheduler
entries, branding, display assignments) permanently in Postgres, replacing
the frontend's localStorage-only version from round -7 with a real shared
source of truth every display can read.

Singleton row (id=1), same established pattern as AppearanceConfig
(models/appearance.py) and RouteSheetLayout (models/sheet_layout.py).
config_json is stored as Text (not JSONB), matching RouteSheetLayout's
documented reasoning: nothing else in this codebase uses Postgres's native
JSON column types, so this doesn't introduce a one-off pattern - the
frontend does JSON.stringify/JSON.parse, exactly like it already does for
column_order/hidden_columns/column_widths in RouteSheetLayout.

`version` (round -10): a plain integer, incremented on every successful
write - not a full CRDT/merge system, just enough for the API to detect
"someone else saved since you loaded" and refuse a stale write with 409
instead of silently overwriting it (see api/routes/control_center.py).
"""
from datetime import datetime

from sqlalchemy import String, DateTime, Text, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ControlCenterConfig(Base):
    __tablename__ = "control_center_config"

    id: Mapped[int] = mapped_column(primary_key=True)  # singleton row, id=1
    config_json: Mapped[str] = mapped_column(Text, default="")  # JSON-serialized GlobalConfig (see frontend ControlCenter.tsx)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_by: Mapped[str] = mapped_column(String(64), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
