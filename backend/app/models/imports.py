"""
models/imports.py
-------------------
Immutable raw storage for SAP/Landmark file imports, matching V1's
route_intelligence_db.py design principle: imported rows are never
mutated, only ever appended to. Everything derived (customer intelligence,
correlation, analytics) is reconstructed FROM these rows rather than
overwriting them - so a bad derived computation can always be re-run
without any risk of having already destroyed the source data.
"""
from datetime import datetime

from sqlalchemy import String, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RawImportRow(Base):
    __tablename__ = "raw_import_rows"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_type: Mapped[str] = mapped_column(String(16))  # "sap" | "landmark"
    batch_id: Mapped[str] = mapped_column(String(36), index=True)  # groups one upload/job together
    source_filename: Mapped[str] = mapped_column(String(255), default="")
    row_index: Mapped[int] = mapped_column(default=0)
    row_json: Mapped[str] = mapped_column(Text)  # raw row, stored as JSON text - untouched, unmutated
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    imported_by: Mapped[str] = mapped_column(String(64), default="")
    label: Mapped[str] = mapped_column(String(64), default="")  # optional category/label, editable after upload
