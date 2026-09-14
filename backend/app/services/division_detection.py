"""
services/division_detection.py
----------------------------------
V2 milestone: Salesman Categorization / Division Detection.

For every Driver and every working day: compare Consumer invoices vs
Pharma invoices (from SapInvoiceFact, invoice-level grain - one row per
actual invoice, so this can be counted per real working day rather than
per whole imported batch/dispatch the way ExperienceHistory.sector is).
Whichever is greater is recorded as that day's division, permanently, in
DriverDailyDivision.

An invoice counts as Consumer if EITHER:
  - its own Division Description says so (division_desc contains
    "Consumer"), OR
  - its salesman (see SapInvoiceFact.salesman, import_jobs.py) has been
    permanently assigned as a Consumer Salesman (ConsumerSalesman table) -
    this is what makes Salesman Categorization actually feed into Division
    Detection, per the milestone's explicit sequencing of those two
    sections.
Same logic mirrored for Pharma. An invoice that matches neither signal is
left uncounted (ambiguous) rather than guessed at.

This is entirely NEW, additive logic - it does not modify identity_engine.py
or analytics_parsers.py's ported parsing/matching algorithms, and it does
not change route_planner.calculate_candidate_score's formula. It only
enriches the experience-cache DATA that scoring function already reads
(see route_planner.build_experience_cache).
"""
from sqlalchemy.orm import Session

from app.models.analytics_facts import SapInvoiceFact
from app.models.salesman import DriverDailyDivision, ConsumerSalesman


def _is_consumer(division_desc: str, salesman: str, consumer_salesmen: set[str]) -> bool:
    """
    ITEM PASS FIX (Experience must not simply trust SAP Division): the
    requirement is explicit - classification is driven by Salesman
    Categorization ONLY, not by the SAP file's own Division Description
    text. An invoice's salesman being in the ConsumerSalesman table is the
    sole Consumer signal now. `division_desc` is intentionally unused here
    (kept as a parameter for call-site compatibility / possible future
    diagnostic use, but no longer consulted for the classification itself).
    """
    return bool(salesman) and salesman.strip().lower() in consumer_salesmen


def _is_pharma(division_desc: str, salesman: str, consumer_salesmen: set[str]) -> bool:
    """
    Per the explicit rule: "any salesman not categorized as Consumer is
    considered Pharma." This is now a strict binary - every invoice with a
    known salesman is either Consumer or Pharma, never ambiguous, matching
    "Do NOT use a fixed arbitrary threshold" / "do not simply copy SAP
    Division". Invoices with no salesman recorded at all remain uncounted
    (there's nothing to categorize).
    """
    return bool(salesman) and salesman.strip().lower() not in consumer_salesmen


def compute_driver_daily_divisions(db: Session, person_codes: set[str] | None = None) -> int:
    """
    Recomputes DriverDailyDivision for the given driver codes (or every
    driver code with any invoice, if None) across their FULL invoice
    history - deliberately a full recompute per driver rather than an
    incremental append, since a ConsumerSalesman assignment made today
    should retroactively correct past days' division for that salesman's
    invoices too (assigning/removing a Consumer Salesman is explicitly
    "the Administrator should be able to edit these rules at any time").
    Returns the number of driver-days written.
    """
    consumer_salesmen = {s.name.strip().lower() for s in db.query(ConsumerSalesman).all()}

    q = db.query(SapInvoiceFact.driver_code, SapInvoiceFact.driver_name, SapInvoiceFact.dispatch_date,
                 SapInvoiceFact.division_desc, SapInvoiceFact.salesman)
    if person_codes:
        q = q.filter(SapInvoiceFact.driver_code.in_(person_codes))
    q = q.filter(SapInvoiceFact.driver_code != "")

    tallies: dict[tuple[str, str], dict] = {}  # (driver_code, date) -> {name, consumer, pharma}
    for driver_code, driver_name, dispatch_date, division_desc, salesman in q.all():
        if not dispatch_date:
            continue
        key = (driver_code, dispatch_date)
        t = tallies.setdefault(key, {"name": driver_name, "consumer": 0, "pharma": 0})
        if driver_name:
            t["name"] = driver_name
        if _is_consumer(division_desc, salesman, consumer_salesmen):
            t["consumer"] += 1
        elif _is_pharma(division_desc, salesman, consumer_salesmen):
            t["pharma"] += 1

    written = 0
    for (code, work_date), t in tallies.items():
        if t["consumer"] == 0 and t["pharma"] == 0:
            continue  # nothing countable either way for this day - leave no record
        division = "Consumer" if t["consumer"] > t["pharma"] else "Pharma"
        row = db.query(DriverDailyDivision).filter(
            DriverDailyDivision.person_code == code, DriverDailyDivision.work_date == work_date,
        ).first()
        if not row:
            row = DriverDailyDivision(person_code=code, work_date=work_date)
            db.add(row)
        row.person_name = t["name"]
        row.division = division
        row.consumer_invoices = t["consumer"]
        row.pharma_invoices = t["pharma"]
        written += 1
    db.commit()
    return written


def driver_overall_division_majority(db: Session) -> dict[str, dict]:
    """
    ITEM PASS ADD: aggregates DriverDailyDivision across each driver's FULL
    history (not per-day) to get the single overall Consumer-vs-Pharma
    classification the requirement describes - "count the driver's orders
    by category... determine the driver's experience based on the majority
    of their orders", explicitly with NO fixed/arbitrary order-count
    threshold. Reads the already-computed per-day tallies (themselves now
    purely salesman-driven, see _is_consumer/_is_pharma above) rather than
    re-querying SapInvoiceFact, so this stays consistent with whatever the
    daily table currently holds and is cheap to compute on request.
    """
    totals: dict[str, dict] = {}
    for row in db.query(DriverDailyDivision).all():
        t = totals.setdefault(row.person_code, {"person_name": row.person_name, "consumer": 0, "pharma": 0})
        if row.person_name:
            t["person_name"] = row.person_name
        t["consumer"] += row.consumer_invoices
        t["pharma"] += row.pharma_invoices
    out: dict[str, dict] = {}
    for code, t in totals.items():
        total = t["consumer"] + t["pharma"]
        if total == 0:
            continue
        majority = "Consumer" if t["consumer"] > t["pharma"] else "Pharma"
        out[code] = {
            "person_name": t["person_name"],
            "division": majority,
            "consumer_orders": t["consumer"],
            "pharma_orders": t["pharma"],
            "total_orders": total,
        }
    return out
