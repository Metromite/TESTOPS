"""add area groups, route sheet layout, salesman categorization, division detection

Revision ID: c2b1f3a6d002
Revises: b1a0e2f5c001
Create Date: 2026-08-01 09:00:00.000000

Schema changes introduced by three recent feature milestones, kept
together in one migration since they landed as one verification pass but
are each independently identifiable below:

Route Plan Sheet column layout persistence:
  - NEW TABLE route_sheet_layout (column order/hidden/widths, singleton row)

Area Groups / Permitted Area Groups / Driver Anchoring:
  - NEW TABLE area_groups
  - NEW TABLE area_group_members (Area <-> Area Group membership)
  - NEW TABLE vehicle_permitted_area_groups (Vehicle <-> Area Group, sibling
    to the pre-existing vehicle_permitted_areas individual-area table)
  - NEW TABLE driver_anchored_areas (Driver <-> individual Area)
  - NEW TABLE driver_anchored_area_groups (Driver <-> Area Group)

Salesman Categorization / Division Detection:
  - NEW TABLE consumer_salesmen (permanent Consumer Salesman assignments)
  - NEW TABLE driver_daily_divisions (per driver/day Consumer-vs-Pharma
    invoice-count comparison result)
  - NEW COLUMN sap_invoice_facts.salesman (+ index) - best-effort captured
    at import time
  - NEW COLUMN experience_history.vehicle_number - captured per stint,
    enables Vehicle Number/Type search in the Experience Database
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c2b1f3a6d002"
down_revision: Union[str, None] = "b1a0e2f5c001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### new tables from the three recent feature milestones ###
    op.create_table(
        "route_sheet_layout",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("column_order", sa.Text(), nullable=False),
        sa.Column("hidden_columns", sa.Text(), nullable=False),
        sa.Column("column_widths", sa.Text(), nullable=False),
        sa.Column("updated_by", sa.String(length=64), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "area_groups",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_area_groups_name"), "area_groups", ["name"], unique=True)

    op.create_table(
        "area_group_members",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.Column("area_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["area_id"], ["areas.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["area_groups.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("group_id", "area_id", name="uq_area_group_member"),
    )
    op.create_index(op.f("ix_area_group_members_area_id"), "area_group_members", ["area_id"], unique=False)
    op.create_index(op.f("ix_area_group_members_group_id"), "area_group_members", ["group_id"], unique=False)

    op.create_table(
        "driver_anchored_areas",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("driver_id", sa.Integer(), nullable=False),
        sa.Column("area_id", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["area_id"], ["areas.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["driver_id"], ["drivers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("driver_id", "area_id", name="uq_driver_anchored_area"),
    )
    op.create_index(op.f("ix_driver_anchored_areas_area_id"), "driver_anchored_areas", ["area_id"], unique=False)
    op.create_index(op.f("ix_driver_anchored_areas_driver_id"), "driver_anchored_areas", ["driver_id"], unique=False)

    op.create_table(
        "driver_anchored_area_groups",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("driver_id", sa.Integer(), nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["driver_id"], ["drivers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["area_groups.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("driver_id", "group_id", name="uq_driver_anchored_area_group"),
    )
    op.create_index(op.f("ix_driver_anchored_area_groups_driver_id"), "driver_anchored_area_groups", ["driver_id"], unique=False)
    op.create_index(op.f("ix_driver_anchored_area_groups_group_id"), "driver_anchored_area_groups", ["group_id"], unique=False)

    op.create_table(
        "vehicle_permitted_area_groups",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("vehicle_id", sa.Integer(), nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["group_id"], ["area_groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["vehicle_id"], ["vehicles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("vehicle_id", "group_id", name="uq_vehicle_permitted_area_group"),
    )
    op.create_index(op.f("ix_vehicle_permitted_area_groups_group_id"), "vehicle_permitted_area_groups", ["group_id"], unique=False)
    op.create_index(op.f("ix_vehicle_permitted_area_groups_vehicle_id"), "vehicle_permitted_area_groups", ["vehicle_id"], unique=False)

    op.create_table(
        "driver_daily_divisions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("person_code", sa.String(length=32), nullable=False),
        sa.Column("person_name", sa.String(length=128), nullable=False),
        sa.Column("work_date", sa.String(length=10), nullable=False),
        sa.Column("division", sa.String(length=16), nullable=False),
        sa.Column("consumer_invoices", sa.Integer(), nullable=False),
        sa.Column("pharma_invoices", sa.Integer(), nullable=False),
        sa.Column("computed_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("person_code", "work_date", name="uq_driver_daily_division"),
    )
    op.create_index(op.f("ix_driver_daily_divisions_person_code"), "driver_daily_divisions", ["person_code"], unique=False)
    op.create_index(op.f("ix_driver_daily_divisions_work_date"), "driver_daily_divisions", ["work_date"], unique=False)

    op.create_table(
        "consumer_salesmen",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("assigned_by", sa.String(length=64), nullable=False),
        sa.Column("assigned_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_consumer_salesmen_name"), "consumer_salesmen", ["name"], unique=True)

    # ### new columns on pre-existing tables ###
    op.add_column("experience_history", sa.Column("vehicle_number", sa.String(length=32), nullable=False, server_default=""))
    op.add_column("sap_invoice_facts", sa.Column("salesman", sa.String(length=128), nullable=False, server_default=""))
    op.create_index(op.f("ix_sap_invoice_facts_salesman"), "sap_invoice_facts", ["salesman"], unique=False)
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### drop new columns first ###
    op.drop_index(op.f("ix_sap_invoice_facts_salesman"), table_name="sap_invoice_facts")
    op.drop_column("sap_invoice_facts", "salesman")
    op.drop_column("experience_history", "vehicle_number")

    # ### drop new tables (reverse creation order) ###
    op.drop_index(op.f("ix_consumer_salesmen_name"), table_name="consumer_salesmen")
    op.drop_table("consumer_salesmen")

    op.drop_index(op.f("ix_driver_daily_divisions_work_date"), table_name="driver_daily_divisions")
    op.drop_index(op.f("ix_driver_daily_divisions_person_code"), table_name="driver_daily_divisions")
    op.drop_table("driver_daily_divisions")

    op.drop_index(op.f("ix_vehicle_permitted_area_groups_vehicle_id"), table_name="vehicle_permitted_area_groups")
    op.drop_index(op.f("ix_vehicle_permitted_area_groups_group_id"), table_name="vehicle_permitted_area_groups")
    op.drop_table("vehicle_permitted_area_groups")

    op.drop_index(op.f("ix_driver_anchored_area_groups_group_id"), table_name="driver_anchored_area_groups")
    op.drop_index(op.f("ix_driver_anchored_area_groups_driver_id"), table_name="driver_anchored_area_groups")
    op.drop_table("driver_anchored_area_groups")

    op.drop_index(op.f("ix_driver_anchored_areas_area_id"), table_name="driver_anchored_areas")
    op.drop_index(op.f("ix_driver_anchored_areas_driver_id"), table_name="driver_anchored_areas")
    op.drop_table("driver_anchored_areas")

    op.drop_index(op.f("ix_area_group_members_group_id"), table_name="area_group_members")
    op.drop_index(op.f("ix_area_group_members_area_id"), table_name="area_group_members")
    op.drop_table("area_group_members")

    op.drop_index(op.f("ix_area_groups_name"), table_name="area_groups")
    op.drop_table("area_groups")

    op.drop_table("route_sheet_layout")
    # ### end Alembic commands ###
