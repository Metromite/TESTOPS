"""
models/salesman.py
----------------------
V2 milestone: Salesman Categorization + Division Detection.

ConsumerSalesman - the Administrator's permanent, editable list of which
salesmen count as "Consumer Division" salesmen (predictive autocomplete
draws candidates from models.master_data.LearnedValue(category="salesman"),
which is already auto-collected from every SAP import - see
services/master_data_learning.py).

DriverDailyDivision - for every Driver and every working day, whichever of
Consumer invoices vs Pharma invoices is greater becomes that day's
division (see services/division_detection.py for the comparison itself,
computed from SapInvoiceFact - richer than the single per-dispatch
Division Description ExperienceHistory already stores, since invoice-level
data lets this be counted per actual working day rather than per whole
imported batch). Stored permanently; feeds the Route Planning scoring
engine via route_planner.build_experience_cache(), which already computes
sector-recency bonuses from real data - this only enriches which sector
recency records exist, the scoring formula itself is untouched.
"""
from datetime import datetime

from sqlalchemy import String, DateTime, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ConsumerSalesman(Base):
    __tablename__ = "consumer_salesmen"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    assigned_by: Mapped[str] = mapped_column(String(64), default="")
    assigned_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DriverDailyDivision(Base):
    __tablename__ = "driver_daily_divisions"
    __table_args__ = (
        UniqueConstraint("person_code", "work_date", name="uq_driver_daily_division"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    person_code: Mapped[str] = mapped_column(String(32), index=True)
    person_name: Mapped[str] = mapped_column(String(128), default="")
    work_date: Mapped[str] = mapped_column(String(10), index=True)  # YYYY-MM-DD
    division: Mapped[str] = mapped_column(String(16), default="Pharma")  # "Consumer" or "Pharma" - whichever won
    consumer_invoices: Mapped[int] = mapped_column(Integer, default=0)
    pharma_invoices: Mapped[int] = mapped_column(Integer, default=0)
    computed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
