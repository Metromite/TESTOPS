"""
models/dashboard_config.py
----------------------------
Dashboard Configuration (V2 milestone): permanent, admin-editable rules
that exclude certain data from every Dashboard computation, applied
automatically to every future import (see services/dashboard_kpis.py's
apply_dashboard_config_exclusions()).

All rule types now have a matching column on SapInvoiceFact and are
enforced: invoice_prefix, area, customer, facility (facility_type),
salesman (salesman - captured best-effort at import time, see
services/import_jobs.py / master_data_learning.py). `invoice_type` and
`custom` remain SAVED here (so nothing is lost if a matching column gets
added later) but are not yet enforced - there's no invoice_type column
anywhere in SapInvoiceFact, and "custom" has no fixed shape to match on.

ITEM 15 (Dashboard Configuration rule engine expansion) added:
  - New rule_types: `driver` (SapInvoiceFact.driver_name), `vehicle_type`
    (resolved via the current Areas Database, same join
    apply_global_filters already uses for route_type/vehicle_type
    slicers - kept consistent with that existing convention rather than
    matching the row's own vehicle_type column directly), `route_type`
    (same Areas Database join), `invoice_range` (numeric range on
    invoice_no, value format "START-END"; only ever matches rows whose
    invoice_no is purely numeric - non-numeric invoice numbers can't be
    range-compared and are simply never matched by this rule type,
    they're not errored on).
  - `operator`: how `value` is matched against the target column -
    "contains" (default, same substring behavior every existing rule
    already had), "starts_with", "ends_with", "exact", "regex" (Postgres
    `~`; this app is Postgres-only, see core/config.py's DATABASE_URL),
    "gt"/"lt" (invoice_range and the `lead_time` setting below only).
  - `negate`: NOT logic. False (default) = "exclude rows where this
    matches" (identical to every rule's behavior before this change).
    True = "exclude rows where this does NOT match" (i.e. an allow-list:
    only keep rows matching this condition).
  - `logic`: "OR" (default) or "AND", governing how multiple rules of
    the SAME rule_type combine. OR = today's behavior (any one matching
    value excludes a row). AND = every rule of that type must match the
    same row for it to be excluded (a compound condition within one
    type, e.g. Area starts_with "D" AND NOT regex "^DXB").
    NOTE: this AND/OR grouping is within a single rule_type only, not
    across different types (Area rules vs Salesman rules are always
    still combined with AND between the two TYPES, same as before) -
    combining across types would need a "rule group" concept this table
    doesn't have; documented here rather than silently guessed at.
  - Two global toggles, stored as rule_type="setting" rows (value =
    the setting's name, presence = enabled - no rule value/operator
    needed for these two, they're plain on/off switches, not
    value-matching rules):
      - "exclude_negative_lead_times": drops invoice/dispatch date pairs
        where dispatch_date < invoice_date from Lead Time tab
        calculations (see compute_lead_time_tab).
      - "fleet_only_drivers": restricts every dashboard computation to
        driver_name values that exist in the Fleet Database's Driver
        table (see build_filtered_sap_query).
"""
from datetime import datetime

from sqlalchemy import String, DateTime, Boolean, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

ENFORCED_RULE_TYPES = {"invoice_prefix", "area", "customer", "facility", "salesman",
                        "driver", "vehicle_type", "route_type", "invoice_range"}
ALL_RULE_TYPES = ENFORCED_RULE_TYPES | {"invoice_type", "custom", "setting"}
OPERATORS = {"contains", "starts_with", "ends_with", "exact", "regex", "gt", "lt"}
SETTING_NAMES = {"exclude_negative_lead_times", "fleet_only_drivers"}


class DashboardConfigRule(Base):
    __tablename__ = "dashboard_config_rules"
    __table_args__ = (
        UniqueConstraint("rule_type", "value", name="uq_dashboard_config_rule"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    rule_type: Mapped[str] = mapped_column(String(32), index=True)  # see ALL_RULE_TYPES
    value: Mapped[str] = mapped_column(String(255))
    note: Mapped[str] = mapped_column(String(255), default="")
    operator: Mapped[str] = mapped_column(String(16), default="contains")  # see OPERATORS
    negate: Mapped[bool] = mapped_column(Boolean, default=False)  # NOT logic
    logic: Mapped[str] = mapped_column(String(3), default="OR")  # "AND"/"OR" vs siblings of same rule_type
    created_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
