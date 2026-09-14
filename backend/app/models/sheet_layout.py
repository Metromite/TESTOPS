"""
models/sheet_layout.py
-------------------------
Persists the Route Plan Sheet's column customization (drag-to-reorder,
show/hide, resize) permanently in Postgres, so the layout survives page
refresh, closing the browser, and restarting the server - not just
browser localStorage. Singleton row (id=1), same pattern as
AppearanceConfig (models/appearance.py). One shared layout app-wide,
matching how the rest of this app's persisted settings work (e.g.
DashboardConfigRule, AppearanceConfig) - no per-user profile table exists
yet, so this deliberately doesn't invent one.

column_order / hidden_columns / column_widths are stored as JSON text
(not JSONB) to keep this consistent with the rest of the codebase, which
doesn't use Postgres JSON column types anywhere else - route_planner.py's
get_sheet_layout()/save_sheet_layout() do the json.dumps/loads.
"""
from datetime import datetime

from sqlalchemy import String, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RouteSheetLayout(Base):
    __tablename__ = "route_sheet_layout"

    id: Mapped[int] = mapped_column(primary_key=True)  # singleton row, id=1
    column_order: Mapped[str] = mapped_column(Text, default="")     # JSON list[str] of column keys
    hidden_columns: Mapped[str] = mapped_column(Text, default="")   # JSON list[str] of column keys
    column_widths: Mapped[str] = mapped_column(Text, default="")    # JSON dict[str, int] key -> px width
    updated_by: Mapped[str] = mapped_column(String(64), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
