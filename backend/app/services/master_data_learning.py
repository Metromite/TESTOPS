"""
services/master_data_learning.py
-----------------------------------
Master Data Learning (V2 milestone): whenever SAP data is imported, learn
new Customer and Salesman values for autocomplete, without duplicates.
See models/master_data.py's docstring for why this only covers
Customer/Salesman and not Driver/Helper/Area/Vehicle (those already come
live from their own authoritative, dropdown-managed tables).
"""
import pandas as pd
from sqlalchemy.orm import Session

from app.models.master_data import LearnedValue

# SAP exports vary in exact header naming - match case-insensitively against
# any of these for the "salesman" column, since there's no fixed schema for
# it the way there is for the columns analytics_parsers.py already parses.
#
# BUGFIX (Predictive Salesman Names still missing): inspected the actual
# export file structure (Weekly Dispatch export - see the raw, pre-Lead-
# Time-columns layout of its "Dispatch Records" sheet) to confirm which
# field Column J actually is, per your explicit "do not guess the column"
# instruction. Column-by-column: A Invoice Date, B TXN Code, C Invoice No,
# D Dispatch Date, E Dispatch Number, F Customer Code, G Customer Name,
# H Invoice Amount, I Salesman Code, J = "Salesman Name". This list used to
# contain only the bare word "salesman" (plus a few unrelated synonyms like
# "sales rep") - `detect_salesman_column` below does an EXACT match of the
# lowercased header against this list, so a real header literally named
# "Salesman Name" (Column J) never matched "salesman" and this whole
# feature silently found nothing, every import, forever - not a fluke, a
# guaranteed miss on the real column name. "Salesman Code" (Column I) is
# deliberately NOT added here - that column holds codes, not names, and
# the task is specifically to source *names* from Column J.
_SALESMAN_COLUMN_CANDIDATES = [
    "salesman name", "salesman", "sales rep", "sales rep name", "sales person", "sales person name",
    "sales representative", "sales employee",
]


def _upsert_learned(db: Session, category: str, values: set[str]) -> int:
    if not values:
        return 0
    existing = {
        v for (v,) in db.query(LearnedValue.value).filter(
            LearnedValue.category == category, LearnedValue.value.in_(values)
        ).all()
    }
    new_values = values - existing
    for v in new_values:
        db.add(LearnedValue(category=category, value=v))
    if new_values:
        db.commit()
    return len(new_values)


def detect_salesman_column(df: pd.DataFrame):
    """Best-effort column detection, reused by both master-data learning
    (distinct values for autocomplete) and import_jobs.py (per-row value
    stamped onto SapInvoiceFact.salesman). Iterates candidates in priority
    order (most specific/likely first - "salesman name" before the bare
    "salesman") rather than in whatever order the file's own columns
    happen to appear, so a file with both a "Salesman" and a "Salesman
    Name" column deterministically prefers the more specific one."""
    lower_to_col = {str(col).strip().lower(): col for col in df.columns}
    for candidate in _SALESMAN_COLUMN_CANDIDATES:
        if candidate in lower_to_col:
            return lower_to_col[candidate]
    return None


def learn_from_sap_import(db: Session, df: pd.DataFrame, facts: list[dict]) -> int:
    """Returns the count of genuinely new values learned (for progress reporting)."""
    learned_count = 0

    # Customer: already extracted by analytics_parsers.py into each fact dict.
    customers = {f.get("customer_name", "").strip() for f in facts if f.get("customer_name", "").strip()}
    learned_count += _upsert_learned(db, "customer", customers)

    # Salesman: no existing parser for this - best-effort column detection
    # on the raw uploaded sheet, since column naming isn't standardized.
    salesman_col = detect_salesman_column(df)
    if salesman_col is not None:
        salesmen = {
            str(v).strip() for v in df[salesman_col].dropna().unique()
            if str(v).strip() and str(v).strip().lower() not in ("nan", "none", "n/a")
        }
        learned_count += _upsert_learned(db, "salesman", salesmen)

    return learned_count
