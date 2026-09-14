"""
services/route_reconstruction.py
------------------------------------
DIRECT PORT of V1's route_reconstruction.py - Pass 1 and Pass 2 only, per
V1's own explicit scope note: "Pass 1 and Pass 2 should only build the raw
Driver-Day Route. Do not implement learning yet. Do not optimize yet."
Passes 3-8 (anchors, segmentation, elimination, confidence, persistence)
were not in V1 and are not invented here either.

Pass 1: build_sap_route()      - complete SAP invoice sequence for one
                                   driver's one day, ordered by real Box
                                   Entry Time (falling back to file order
                                   only when no timestamp exists)
Pass 2: build_landmark_route() - complete Landmark GPS stop sequence for
                                   the same driver-day

STORAGE NOTE: V1's route_intelligence_db.py was its own separate SQLite
file specifically so raw facts could survive independently of the
reconstruction algorithm. That's exactly what sap_invoice_facts /
landmark_visit_facts (models/analytics_facts.py, built in Phase 2) already
are in Postgres - same "never mutated, always re-derivable from" design.
So this port reads from those tables directly rather than standing up a
second, redundant raw-storage layer.
"""
import re
from dataclasses import dataclass, field
from datetime import time as dt_time
from typing import Optional

from sqlalchemy.orm import Session

from app.models.analytics_facts import SapInvoiceFact, LandmarkVisitFact


# ---------------------------------------------------------------------------
# Pass 1: build the complete SAP route for one driver-day
# ---------------------------------------------------------------------------

@dataclass
class SapRouteStop:
    invoice_no: str
    customer_name: str
    customer_name_source: Optional[str]
    box_entry_time: Optional[str]
    sequence_position: int
    boxes: int
    vehicle_key: str
    area: str


@dataclass
class SapRoute:
    driver_name: str
    date: str
    stops: list[SapRouteStop]
    stops_missing_time: int  # how many stops had no Box Entry Time (ordered by fallback, not real evidence)


def _parse_time_str(t) -> Optional[dt_time]:
    if not t or t in ("None", "NaT", ""):
        return None
    s = str(t).strip()
    m = re.match(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", s)
    if not m:
        return None
    h, mi, se = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    try:
        return dt_time(h, mi, se)
    except ValueError:
        return None


def _is_administrative_not_a_stop(r: SapInvoiceFact) -> bool:
    """Verified against real V1 data: rows with zero boxes, a placeholder
    00:00:00 timestamp, AND a customer name that came from the Remarks
    fallback (not the real Customer Name column) are internal logistics
    notes, not delivery stops. Zero-box rows WITH a real timestamp are
    kept - those are genuine stops where nothing happened to be delivered."""
    boxes = (r.boxes or 0) + (r.normal_boxes or 0) + (r.freezer_boxes or 0)
    time_str = str(r.box_entry_time or "")
    return boxes == 0 and time_str in ("00:00:00", "", "None") and r.customer_name_source == "remarks"


def build_sap_route(db: Session, driver_name: str, date: str) -> SapRoute:
    """Pass 1. Orders every SAP invoice for this driver+date by real Box
    Entry Time - a much more reliable ordering signal than invoice number
    or file row order. Invoices with no usable time go at the end, in
    their original order, counted separately so the caller knows how much
    of the ordering is real evidence vs. fallback."""
    raw_rows = (
        db.query(SapInvoiceFact)
        .filter(SapInvoiceFact.driver_name == driver_name, SapInvoiceFact.dispatch_date == date)
        .all()
    )
    raw_rows = [r for r in raw_rows if not _is_administrative_not_a_stop(r)]

    timed, untimed = [], []
    for r in raw_rows:
        t = _parse_time_str(r.box_entry_time)
        (timed if t else untimed).append((t, r))

    timed.sort(key=lambda x: x[0])
    ordered_rows = [r for _, r in timed] + [r for _, r in untimed]

    stops = [
        SapRouteStop(
            invoice_no=r.invoice_no or "",
            customer_name=r.customer_name or "",
            customer_name_source=r.customer_name_source,
            box_entry_time=str(r.box_entry_time) if r.box_entry_time else None,
            sequence_position=i,
            boxes=r.boxes or 0,
            vehicle_key=r.vehicle_key or "",
            area=r.area or "",
        )
        for i, r in enumerate(ordered_rows)
    ]
    return SapRoute(driver_name=driver_name, date=date, stops=stops, stops_missing_time=len(untimed))


# ---------------------------------------------------------------------------
# Pass 2: build the complete Landmark route for the same driver-day
# ---------------------------------------------------------------------------

@dataclass
class LandmarkRouteStop:
    customer_name: str
    vehicle_key: str
    arrival: str
    departure: str
    duration_minutes: float
    sequence_position: int
    is_passthrough: bool
    is_depot: bool


@dataclass
class LandmarkRoute:
    driver_name: str
    date: str
    all_stops: list[LandmarkRouteStop]       # every row, kept for explainability
    delivery_stops: list[LandmarkRouteStop]  # all_stops minus passthrough/depot


_MONTHS = {"JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
           "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12}


def _extract_date(arrival_str) -> str:
    """Same logic as correlation_engine._extract_date, kept duplicated
    intentionally - matches V1's own note that route_reconstruction.py is
    meant to become the canonical home for this once the older correlation
    path is retired in favor of this pipeline."""
    if not arrival_str:
        return ""
    s = str(arrival_str).strip()
    m = re.match(r"(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})", s)
    if m:
        d, mon_str, y = m.groups()
        mo = _MONTHS.get(mon_str.upper()[:3])
        if mo:
            return f"{y}-{mo:02d}-{int(d):02d}"
    m2 = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m2:
        d, mo, y = m2.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    m3 = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m3:
        y, mo, d = m3.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    return ""


def _arrival_sort_key(arrival_str):
    if not arrival_str:
        return (0, 0, 0)
    s = str(arrival_str).strip()
    m = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$", s)
    if not m:
        return (0, 0, 0)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))


def build_landmark_route(db: Session, driver_name: str, date: str, vehicle_key: str = "") -> LandmarkRoute:
    """Pass 2. Pulls every Landmark GPS visit for this driver (falling back
    to vehicle if the driver name has no rows - Landmark's own driver-name
    field is sometimes 'Unknown') on this date, chronologically ordered.
    Passthrough/depot rows stay in all_stops (for explainability later)
    but delivery_stops is the pre-filtered list real matching passes use."""
    raw_rows = db.query(LandmarkVisitFact).filter(LandmarkVisitFact.driver_name == driver_name).all()
    if not raw_rows and vehicle_key:
        raw_rows = db.query(LandmarkVisitFact).filter(LandmarkVisitFact.vehicle_key == vehicle_key).all()

    day_rows = [r for r in raw_rows if _extract_date(r.arrival) == date]
    day_rows.sort(key=lambda r: _arrival_sort_key(r.arrival))

    all_stops = [
        LandmarkRouteStop(
            customer_name=r.customer_name or "", vehicle_key=r.vehicle_key or "",
            arrival=r.arrival or "", departure=r.departure or "",
            duration_minutes=r.minutes or 0, sequence_position=i,
            is_passthrough=bool(r.is_passthrough), is_depot=bool(r.is_depot),
        )
        for i, r in enumerate(day_rows)
    ]
    delivery_stops = [s for s in all_stops if not s.is_passthrough and not s.is_depot]
    for i, s in enumerate(delivery_stops):
        s.sequence_position = i

    return LandmarkRoute(driver_name=driver_name, date=date, all_stops=all_stops, delivery_stops=delivery_stops)


def get_distinct_driver_dates(db: Session) -> list[tuple]:
    """New convenience query (V1 had this in route_intelligence_db.py) -
    lets the frontend offer a picker instead of requiring the user to
    already know a valid driver name + date to reconstruct."""
    rows = (
        db.query(SapInvoiceFact.driver_name, SapInvoiceFact.dispatch_date)
        .filter(SapInvoiceFact.driver_name != "", SapInvoiceFact.dispatch_date != "")
        .distinct()
        .order_by(SapInvoiceFact.dispatch_date.desc())
        .limit(200)
        .all()
    )
    return rows
