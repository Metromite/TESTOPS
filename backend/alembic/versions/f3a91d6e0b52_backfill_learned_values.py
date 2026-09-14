"""DATA BACKFILL: populate LearnedValue from existing SapInvoiceFact rows

services/master_data_learning.py's learn_from_sap_import() only runs at
IMPORT time - it populates learned_values (the table backing Salesman
Categorization's and Customer's predictive autocomplete) from each new
SAP Export as it's uploaded. It never runs retroactively. If your real
data was imported before this feature existed (or by any path that
didn't go through learn_from_sap_import), learned_values.salesman would
still be empty even though sap_invoice_facts.salesman/customer_name are
already fully populated per-row - which is exactly why the autocomplete
showed no suggestions at all: there was nothing in learned_values to
suggest, regardless of the frontend/keyboard-handling code being correct.

This is a one-time, idempotent backfill: DISTINCT salesman/customer_name
values already sitting in sap_invoice_facts get inserted into
learned_values, skipping anything already there (ON CONFLICT DO
NOTHING, matching the (category, value) unique constraint). Purely
additive - never touches sap_invoice_facts, never removes anything from
learned_values, safe to run against any existing database regardless of
how much data is already backfilled.

Revision ID: f3a91d6e0b52
Revises: e7b2c4f8a315
Create Date: 2026-08-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision: str = "f3a91d6e0b52"
down_revision: Union[str, None] = "e7b2c4f8a315"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("""
        INSERT INTO learned_values (category, value, first_seen, last_seen)
        SELECT 'salesman', v, now(), now()
        FROM (
            SELECT DISTINCT trim(salesman) AS v
            FROM sap_invoice_facts
            WHERE salesman IS NOT NULL AND trim(salesman) <> ''
        ) s
        ON CONFLICT (category, value) DO NOTHING
    """))
    conn.execute(text("""
        INSERT INTO learned_values (category, value, first_seen, last_seen)
        SELECT 'customer', v, now(), now()
        FROM (
            SELECT DISTINCT trim(customer_name) AS v
            FROM sap_invoice_facts
            WHERE customer_name IS NOT NULL AND trim(customer_name) <> ''
        ) c
        ON CONFLICT (category, value) DO NOTHING
    """))


def downgrade() -> None:
    # Deliberately a no-op: this is a one-way backfill of suggestion data
    # only (never operational data - see models/master_data.py's
    # docstring on why LearnedValue is a harmless cache, not a source of
    # truth). Reversing it would mean guessing which learned_values rows
    # came from this backfill vs. a real import that happened afterward,
    # which isn't reliably determinable - and there's no correctness
    # reason to remove autocomplete suggestions on downgrade anyway.
    pass
