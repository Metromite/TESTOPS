"""ITEM 15: expand dashboard_config_rules for the rule-engine expansion

Adds operator/negate/logic columns to dashboard_config_rules and widens
rule_type to comfortably fit the new values (driver/vehicle_type/
route_type/invoice_range/setting) alongside the existing ones. See the
docstring in app/models/dashboard_config.py for what each new column
means and why.

Revision ID: d4e8f1a9c210
Revises: 9f2e6b7d1a03
Create Date: 2026-08-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d4e8f1a9c210"
down_revision: Union[str, None] = "9f2e6b7d1a03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("dashboard_config_rules", sa.Column("operator", sa.String(16), nullable=False, server_default="contains"))
    op.add_column("dashboard_config_rules", sa.Column("negate", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("dashboard_config_rules", sa.Column("logic", sa.String(3), nullable=False, server_default="OR"))
    # rule_type was already String(32) - every new value (driver,
    # vehicle_type, route_type, invoice_range, setting,
    # exclude_negative_lead_times, fleet_only_drivers) fits within 32
    # chars, so no width change needed there.


def downgrade() -> None:
    op.drop_column("dashboard_config_rules", "logic")
    op.drop_column("dashboard_config_rules", "negate")
    op.drop_column("dashboard_config_rules", "operator")
