"""PERFORMANCE: index the SapInvoiceFact columns every dashboard filters on

driver_name, area, division_desc, facility_type, invoice_date, and
dispatch_date are filtered (via .in_(), date-range comparisons, or
grouping) on essentially every Dashboard/Experience/Route Planner query
(see apply_global_filters and every compute_*_tab function in
services/dashboard_kpis.py) - but none of them had a database index,
meaning every one of those filters was a full sequential scan over the
entire sap_invoice_facts table. At the reported ~45,800+ rows this is a
real, concrete, plausible contributor to slow first-load times.

Purely additive (CREATE INDEX only) - no data changes, no risk to
existing rows. On Postgres, building 6 btree indexes over ~46k rows
takes seconds, not an outage-risk operation.

Revision ID: e7b2c4f8a315
Revises: d4e8f1a9c210
Create Date: 2026-08-07
"""
from typing import Sequence, Union

from alembic import op

revision: str = "e7b2c4f8a315"
down_revision: Union[str, None] = "d4e8f1a9c210"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "sap_invoice_facts"
COLUMNS = ["driver_name", "area", "division_desc", "facility_type", "invoice_date", "dispatch_date"]


def upgrade() -> None:
    for col in COLUMNS:
        op.create_index(f"ix_{TABLE}_{col}", TABLE, [col])


def downgrade() -> None:
    for col in COLUMNS:
        op.drop_index(f"ix_{TABLE}_{col}", table_name=TABLE)
