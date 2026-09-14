"""
models/master_data.py
-----------------------
Master Data Learning (V2 milestone): autocomplete for Area Code/Name,
Vehicle Number, Driver, Helper, Vehicle Type, Division, Route Type is
sourced LIVE from their own authoritative tables (Area/Vehicle/Driver/
Helper/reference_data) - those are already dropdown/FK-validated per the
Areas + Vehicle DB redesign, so a newly added row is immediately available
everywhere with no extra learning step needed.

Customer and Salesman have no such authoritative table (they're free text
coming from SAP, not something a dispatcher manually maintains as a
dropdown-managed master list). LearnedValue exists ONLY for these two
categories: it's an autocomplete-suggestions cache, not an operational
table, so a typo in a SAP export can never pollute real Driver/Area/
Vehicle data - it just becomes a (harmless, low-priority) suggestion.
"""
from datetime import datetime

from sqlalchemy import String, DateTime, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class LearnedValue(Base):
    __tablename__ = "learned_values"
    __table_args__ = (
        UniqueConstraint("category", "value", name="uq_learned_value_category_value"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    category: Mapped[str] = mapped_column(String(32), index=True)  # "customer" / "salesman"
    value: Mapped[str] = mapped_column(String(255), index=True)
    first_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
