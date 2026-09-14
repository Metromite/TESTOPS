"""
services/dashboard_kpis.py
------------------------------
DIRECT PORT of the Home Dashboard tab from V1's dashboard.html (a 4,033-
line client-side JS file, previously unread - see CHANGELOG_V2.md's own
Milestone 10 note about needing a real inventory before building any
dashboard logic, which this port follows through on).

Ported functions and their JS originals:
  gatherKpis()            -> the raw KPI numbers
  renderDashboard()        -> the 13-card Home KPI set + Driver Overview table
  buildDriverPerf()        -> per-driver aggregation (invoices/boxes/freezer/etc.)
  buildLmRouteMap()        -> per-vehicle route start/end/duration from GPS,
                              used for the "Avg Route Hours" KPI
  renderMainCharts()       -> the 4 Home dashboard charts

SCOPE, stated honestly: this is the HOME tab only. dashboard.html has
several more tabs (Driver Performance detail, Lead Time, Order Summary,
Area Analytics, Not Supplied, Driver Mapping Review, Weekly Summary) that
have NOT been read or ported yet - each has its own render function
of comparable size, and guessing at their exact calculations instead of
reading the real logic is exactly the "zero functional differences"
mistake V1's own author refused to make. Treat those as still-placeholder
until they get the same read-first treatment this tab got.

The depot-detection keyword ("CITY PHARMACY" + "IND") is copied exactly
from V1 - it's a literal piece of this company's business data (their own
depot's name in the Landmark system), not a generic algorithm.
"""
import re
from datetime import datetime, date as date_cls
from typing import Optional

from sqlalchemy.orm import Session

from app.models.analytics_facts import SapInvoiceFact, LandmarkVisitFact

DEPOT_KEYWORD = "IND"

_MONTHS = {"JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
           "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12}


def _parse_arrival_datetime(arrival_str) -> Optional[datetime]:
    """Combines analytics_parsers' date-extraction pattern with a time
    regex to get a real sortable/comparable datetime - V1's JS `parseDateTime`
    does this natively via the Date constructor; Python needs it built
    from the two pieces explicitly."""
    if not arrival_str:
        return None
    s = str(arrival_str).strip()

    d = None
    m = re.match(r"(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})", s)
    if m:
        dd, mon_str, y = m.groups()
        mo = _MONTHS.get(mon_str.upper()[:3])
        if mo:
            d = date_cls(int(y), mo, int(dd))
    if d is None:
        m2 = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
        if m2:
            dd, mo, y = m2.groups()
            d = date_cls(int(y), int(mo), int(dd))
    if d is None:
        m3 = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
        if m3:
            y, mo, dd = m3.groups()
            d = date_cls(int(y), int(mo), int(dd))
    if d is None:
        return None

    tm = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$", s)
    h, mi, se = (int(tm.group(1)), int(tm.group(2)), int(tm.group(3) or 0)) if tm else (0, 0, 0)
    try:
        return datetime(d.year, d.month, d.day, h, mi, se)
    except ValueError:
        return None


def _is_depot_landmark(customer_name: str) -> bool:
    up = (customer_name or "").upper()
    return "CITY PHARMACY" in up and DEPOT_KEYWORD in up


def _build_driver_perf(sap_rows: list[SapInvoiceFact]) -> dict:
    """Direct port of buildDriverPerf() - per-driver invoice/box aggregation."""
    driver_map: dict[str, dict] = {}
    for r in sap_rows:
        name = r.driver_name or "Unknown"
        d = driver_map.setdefault(name, {
            "driver_name": name, "helper_name": r.helper_name, "vehicle_num": r.vehicle_num,
            "vehicle_key": r.vehicle_key, "vehicle_type": r.vehicle_type,
            "invoices": 0, "boxes": 0, "normal": 0, "freezer": 0,
        })
        d["invoices"] += 1
        d["boxes"] += r.boxes or 0
        d["normal"] += r.normal_boxes or 0
        d["freezer"] += r.freezer_boxes or 0
    return driver_map


def _build_lm_route_map(lm_rows: list[LandmarkVisitFact]) -> dict:
    """Direct port of buildLmRouteMap() - per-vehicle route start (depot
    departure) to end (last delivery stop departure), for Avg Route Hours."""
    by_vehicle: dict[str, list[LandmarkVisitFact]] = {}
    for r in lm_rows:
        if not r.vehicle_key:
            continue
        by_vehicle.setdefault(r.vehicle_key, []).append(r)

    route_map = {}
    for vkey, rows in by_vehicle.items():
        rows_sorted = sorted(rows, key=lambda r: _parse_arrival_datetime(r.arrival) or datetime.min)

        depot_rows = [r for r in rows_sorted if _is_depot_landmark(r.customer_name)]
        stop_rows = [r for r in rows_sorted if not r.is_passthrough and not r.is_depot
                     and not _is_depot_landmark(r.customer_name)]

        route_start = None
        departing_depot = next((r for r in depot_rows if r.departure and r.departure != "-"), None)
        if departing_depot:
            route_start = _parse_arrival_datetime(departing_depot.departure)

        route_end = _parse_arrival_datetime(stop_rows[-1].departure) if stop_rows else None

        route_duration = (
            round((route_end - route_start).total_seconds() / 60)
            if route_start and route_end and route_end > route_start else 0
        )
        route_map[vkey] = {"route_duration_minutes": route_duration, "stops": len(stop_rows)}
    return route_map


def get_dashboard_config_rules(db: Session) -> dict:
    """Grouped view of every saved Dashboard Configuration rule, split into
    enforced (has a real matching column) vs saved-only (no such column
    exists on SapInvoiceFact yet) - used by the config admin page so it's
    honest about which rules actually do something."""
    from app.models.dashboard_config import DashboardConfigRule, ENFORCED_RULE_TYPES
    rows = db.query(DashboardConfigRule).all()
    grouped: dict = {}
    for r in rows:
        grouped.setdefault(r.rule_type, []).append({
            "id": r.id, "value": r.value, "note": r.note,
            "operator": r.operator, "negate": r.negate, "logic": r.logic,
        })
    return {"rules": grouped, "enforced_types": sorted(ENFORCED_RULE_TYPES)}


def apply_dashboard_config_exclusions(db: Session, q):
    """Applies every saved, enforceable Dashboard Configuration rule to a
    SapInvoiceFact query - called unconditionally so it's respected by
    every dashboard computation and every future import's numbers, per
    the "these filters become permanent Dashboard rules" requirement.

    ITEM 15 (rule engine expansion): see app/models/dashboard_config.py's
    module docstring for the full operator/negate/logic/new-rule-type
    reference. Short version: each ENFORCED_RULE_TYPES value maps to a
    column (or, for vehicle_type/route_type, to a join against the
    current Areas Database - same join apply_global_filters already uses
    for those two, kept consistent with it). `operator` picks how `value`
    is matched, `negate` flips "exclude if matches" into "exclude if
    does NOT match" (an allow-list), and `logic` says whether multiple
    rules of the SAME rule_type must ALL match together (AND) or any one
    of them is enough (OR, the original/default behavior) to trigger
    exclusion. Rules of DIFFERENT types are still always AND-ed together,
    same as before this change.
    """
    from app.models.dashboard_config import DashboardConfigRule
    from sqlalchemy import and_, or_, cast, Integer

    rows = db.query(DashboardConfigRule).filter(DashboardConfigRule.rule_type != "setting").all()

    def _condition(column, r: "DashboardConfigRule"):
        """One rule -> one boolean SQL condition testing whether `column`
        MATCHES this rule (negate is applied by the caller, not here, so
        this function always answers "does it match", never "should it
        be excluded")."""
        v = r.value
        if r.operator == "starts_with":
            cond = column.startswith(v)
        elif r.operator == "ends_with":
            cond = column.endswith(v)
        elif r.operator == "exact":
            cond = column == v
        elif r.operator == "regex":
            # Postgres-only app (see core/config.py DATABASE_URL) - `~` is
            # Postgres's regex-match operator.
            cond = column.op("~")(v)
        else:  # "contains" - default, same substring behavior every rule had before item 15
            cond = column.contains(v)
        return cond

    def _condition_signed(column, r: "DashboardConfigRule"):
        cond = _condition(column, r)
        return ~cond if r.negate else cond

    def _apply(q, column, rule_type):
        rows_for_type = [r for r in rows if r.rule_type == rule_type]
        if not rows_for_type:
            return q
        and_rows = [r for r in rows_for_type if r.logic == "AND"]
        or_rows = [r for r in rows_for_type if r.logic != "AND"]
        clauses = []
        if and_rows:
            clauses.append(and_(*[_condition_signed(column, r) for r in and_rows]))
        clauses.extend(_condition_signed(column, r) for r in or_rows)
        match_expr = or_(*clauses) if len(clauses) > 1 else clauses[0]
        return q.filter(~match_expr)

    q = _apply(q, SapInvoiceFact.invoice_no, "invoice_prefix")
    q = _apply(q, SapInvoiceFact.area, "area")
    q = _apply(q, SapInvoiceFact.customer_name, "customer")
    q = _apply(q, SapInvoiceFact.facility_type, "facility")
    q = _apply(q, SapInvoiceFact.salesman, "salesman")
    q = _apply(q, SapInvoiceFact.driver_name, "driver")

    # invoice_range: numeric range on invoice_no, value format "START-END".
    # Only ever matches rows whose invoice_no is purely numeric (checked
    # via regex before casting, so non-numeric invoice numbers are simply
    # never matched here rather than raising a cast error).
    range_rows = [r for r in rows if r.rule_type == "invoice_range"]
    if range_rows:
        numeric_no = cast(SapInvoiceFact.invoice_no, Integer)
        is_numeric = SapInvoiceFact.invoice_no.op("~")(r"^\d+$")
        clauses = []
        for r in range_rows:
            try:
                lo_s, hi_s = r.value.split("-", 1)
                lo, hi = int(lo_s.strip()), int(hi_s.strip())
            except (ValueError, AttributeError):
                continue  # malformed "START-END" value - skip rather than error
            in_range = and_(is_numeric, numeric_no >= lo, numeric_no <= hi)
            clauses.append(~in_range if r.negate else in_range)
        if clauses:
            match_expr = or_(*clauses) if len(clauses) > 1 else clauses[0]
            q = q.filter(~match_expr)

    # vehicle_type / route_type: no direct, reliable column to filter on
    # for this purpose - resolved via the current Areas Database, same
    # join apply_global_filters uses for its vehicle_type/route_type
    # slicers, kept consistent with that existing, documented limitation
    # (reflects TODAY's Area config, not necessarily what applied when
    # each invoice was created).
    vt_rows = [r for r in rows if r.rule_type == "vehicle_type"]
    rt_rows = [r for r in rows if r.rule_type == "route_type"]
    if vt_rows or rt_rows:
        from app.models.fleet import Area
        areas = db.query(Area).all()
        excluded_area_names = set()
        for r in vt_rows:
            hit = {a.name for a in areas if _python_match(a.vehicle_type or "", r)}
            excluded_area_names |= (set(a.name for a in areas) - hit) if r.negate else hit
        for r in rt_rows:
            hit = {a.name for a in areas if _python_match(a.route_type or "", r)}
            excluded_area_names |= (set(a.name for a in areas) - hit) if r.negate else hit
        if excluded_area_names:
            q = q.filter(~SapInvoiceFact.area.in_(excluded_area_names))

    return q


def _python_match(value: str, rule) -> bool:
    """Same matching semantics as _condition() above, done in Python for
    the vehicle_type/route_type Area-join case (Area rows are small in
    number and already fully loaded into memory there, unlike
    SapInvoiceFact, so there's no SQL-portability upside to doing this
    one in SQL too)."""
    import re
    v, needle = value, rule.value
    if rule.operator == "starts_with":
        return v.startswith(needle)
    if rule.operator == "ends_with":
        return v.endswith(needle)
    if rule.operator == "exact":
        return v == needle
    if rule.operator == "regex":
        try:
            return bool(re.search(needle, v))
        except re.error:
            return False
    return needle in v  # "contains" default


def dashboard_config_settings(db: Session) -> dict:
    """The two "setting"-type DashboardConfigRule rows (see
    app/models/dashboard_config.py's SETTING_NAMES) - historically a pair
    of admin-togglable on/off switches. As of the CRITICAL CORRECTION PASS
    (items 1 & 7), both behaviors they used to gate are mandatory and
    always enforced directly in build_filtered_sap_query()/
    compute_lead_time_tab() instead, so this function is no longer called
    from the filtering path. Left in place (rather than deleted) since the
    underlying "setting" rows are still valid, still readable/writable via
    /dashboard/config-rules, and a future genuinely-optional setting could
    reuse this same read helper.
    """
    from app.models.dashboard_config import DashboardConfigRule
    enabled = {r.value for r in db.query(DashboardConfigRule).filter(DashboardConfigRule.rule_type == "setting").all()}
    return {
        "exclude_negative_lead_times": "exclude_negative_lead_times" in enabled,
        "fleet_only_drivers": "fleet_only_drivers" in enabled,
    }


def apply_global_filters(db: Session, q, drivers: str = "", areas: str = "", division: str = "",
                          route_type: str = "", vehicle_type: str = "", facility_type: str = "", salesman: str = ""):
    """
    Dashboard Global Filters (V2 milestone) - Power-BI-style slicers applied
    on top of whatever date-range/single-driver filter the calling tab
    function already does. Every slicer (`drivers`, `areas`, `division`,
    `route_type`, `vehicle_type`, `facility_type`, `salesman`) accepts a
    comma-separated list for multi-selection - same convention throughout.
    `route_type`/`vehicle_type` aren't columns on SapInvoiceFact, so
    they're applied via a best-effort join to the CURRENT Areas Database
    configuration for that area+division - same documented limitation as
    Experience search's route_type/vehicle_type filters (reflects today's
    Area config, not necessarily what applied historically).
    """
    if drivers:
        driver_list = [d.strip() for d in drivers.split(",") if d.strip()]
        if driver_list:
            q = q.filter(SapInvoiceFact.driver_name.in_(driver_list))
    if areas:
        area_list = [a.strip() for a in areas.split(",") if a.strip()]
        if area_list:
            q = q.filter(SapInvoiceFact.area.in_(area_list))
    if division:
        division_list = [d.strip() for d in division.split(",") if d.strip()]
        if division_list:
            q = q.filter(SapInvoiceFact.division_desc.in_(division_list))
    if facility_type:
        facility_list = [f.strip() for f in facility_type.split(",") if f.strip()]
        if facility_list:
            q = q.filter(SapInvoiceFact.facility_type.in_(facility_list))
    if salesman:
        salesman_list = [s.strip() for s in salesman.split(",") if s.strip()]
        if salesman_list:
            q = q.filter(SapInvoiceFact.salesman.in_(salesman_list))

    if route_type or vehicle_type:
        from app.models.fleet import Area
        route_types = {r.strip() for r in route_type.split(",") if r.strip()}
        vehicle_types = {v.strip() for v in vehicle_type.split(",") if v.strip()}
        area_lookup = {
            (a.name.strip().lower(), a.sector.strip().lower()): a for a in db.query(Area).all()
        }
        matching_area_names = [
            a.name for (name, sector), a in area_lookup.items()
            if (not route_types or a.route_type in route_types) and (not vehicle_types or a.vehicle_type in vehicle_types)
        ]
        q = q.filter(SapInvoiceFact.area.in_(matching_area_names)) if matching_area_names else q.filter(False)
    return q


def build_filtered_sap_query(db: Session, start_date: str = "", end_date: str = "", driver: str = "",
                              drivers: str = "", areas: str = "", division: str = "",
                              route_type: str = "", vehicle_type: str = "", facility_type: str = "", salesman: str = ""):
    """Shared filter-building logic (date range + driver + Global Filters +
    Dashboard Configuration exclusions) - used by compute_home_dashboard()
    for the KPI numbers themselves AND by get_home_detail_rows() for the
    Dashboard Detail Windows, so a detail window's rows always match
    exactly what the KPI card counted, by construction."""
    q = db.query(SapInvoiceFact)
    if start_date:
        q = q.filter(SapInvoiceFact.dispatch_date >= start_date)
    if end_date:
        q = q.filter(SapInvoiceFact.dispatch_date <= end_date)
    if driver:
        q = q.filter(SapInvoiceFact.driver_name == driver)
    q = apply_global_filters(db, q, drivers, areas, division, route_type, vehicle_type, facility_type, salesman)
    q = apply_dashboard_config_exclusions(db, q)
    # CRITICAL CORRECTION PASS item 1/4/5/6: the Fleet Database Drivers
    # table is the single authoritative driver list for every Dashboard
    # driver-level computation. This used to be gated behind the
    # "fleet_only_drivers" toggle (default OFF), which let SAP-only names
    # (customers, "OTHERS", department names, ex-drivers, typos, etc.)
    # leak into Driver Overview/Performance/charts/cards/KPIs. It is no
    # longer optional: every caller of build_filtered_sap_query - i.e.
    # every Dashboard tab - is restricted to Fleet Database drivers by
    # construction, so there is exactly one place this rule lives instead
    # of six components each re-implementing their own driver list.
    from app.models.fleet import Driver
    fleet_names = {d.name for d in db.query(Driver.name).all() if d.name}
    if fleet_names:
        q = q.filter(SapInvoiceFact.driver_name.in_(fleet_names))

    # item 8: Area Database is the authoritative area list the same way
    # Fleet Database is for drivers - an area that doesn't exist in Area
    # Database must not appear in Area Analytics (or anywhere else area
    # is grouped/charted), so this lives in the one shared query builder
    # rather than being re-filtered per-component.
    from app.models.fleet import Area
    valid_areas = {a.name for a in db.query(Area.name).all() if a.name}
    if valid_areas:
        q = q.filter(SapInvoiceFact.area.in_(valid_areas))
    return q


def get_dashboard_eligible_drivers(db: Session, drivers: str = "", areas: str = "", division: str = "",
                                    route_type: str = "", vehicle_type: str = "", facility_type: str = "",
                                    salesman: str = "") -> list[str]:
    """Single reusable driver-eligibility function (item 5): Fleet Database
    Drivers table, intersected with whatever Dashboard Global Filters are
    active, minus Dashboard Configuration exclusions. Used to populate the
    Driver slicer's option list so it only ever offers drivers that could
    actually appear in the filtered dataset, and available for any future
    component that needs "the current authoritative driver set" without
    re-deriving it from sap_rows itself."""
    from app.models.fleet import Driver
    fleet_names = {d.name for d in db.query(Driver.name).all() if d.name}
    if not fleet_names:
        return []
    q = db.query(SapInvoiceFact.driver_name).filter(SapInvoiceFact.driver_name.in_(fleet_names)).distinct()
    q = apply_global_filters(db, q, drivers, areas, division, route_type, vehicle_type, facility_type, salesman)
    q = apply_dashboard_config_exclusions(db, q)
    return sorted({r[0] for r in q.all() if r[0]})


# Dashboard Detail Windows (V2 milestone): what "the underlying rows" means
# for each clickable KPI card. Distinct-count metrics (active_drivers,
# unique_customers, active_vehicles) get a per-entity summary row instead
# of one row per invoice, since that's what's actually meaningful to look
# at for a "how many distinct X" number.
_DETAIL_ROW_LIMIT = 2000  # bounded for now - see the Dashboard Performance note in api/routes/dashboard.py


def get_home_detail_rows(db: Session, metric: str, **filters) -> dict:
    """
    Returns the actual rows behind a Home tab KPI card, Dashboard
    Configuration exclusions and Global Filters already applied identically
    to the KPI computation itself. Bounded to _DETAIL_ROW_LIMIT rows - see
    the Dashboard Performance limitation already flagged elsewhere; a truly
    unbounded "millions of records, no lag" detail window needs the same
    materialized/paginated architecture the KPI cards themselves still need.
    """
    q = build_filtered_sap_query(db, **filters)

    if metric == "not_supplied":
        q = q.filter(SapInvoiceFact.not_supplied_reason != "")
    elif metric == "freezer_boxes":
        q = q.filter(SapInvoiceFact.freezer_boxes > 0)
    elif metric == "normal_boxes":
        q = q.filter(SapInvoiceFact.normal_boxes > 0)

    if metric in ("active_drivers", "unique_customers", "active_vehicles"):
        rows = q.all()
        key_fn = {
            "active_drivers": lambda r: r.driver_name,
            "unique_customers": lambda r: r.customer_name,
            "active_vehicles": lambda r: r.vehicle_key,
        }[metric]
        agg: dict[str, dict] = {}
        for r in rows:
            k = key_fn(r)
            if not k:
                continue
            e = agg.setdefault(k, {"name": k, "invoices": 0, "boxes": 0, "not_supplied": 0})
            e["invoices"] += 1
            e["boxes"] += r.boxes or 0
            e["not_supplied"] += 1 if r.not_supplied_reason else 0
        entity_rows = sorted(agg.values(), key=lambda e: -e["invoices"])[:_DETAIL_ROW_LIMIT]
        columns = ["name", "invoices", "boxes", "not_supplied"]
        return {"metric": metric, "columns": columns, "rows": entity_rows, "truncated": len(agg) > _DETAIL_ROW_LIMIT, "total_matching": len(agg)}

    total_matching = q.count()
    rows = q.order_by(SapInvoiceFact.dispatch_date.desc()).limit(_DETAIL_ROW_LIMIT).all()
    columns = ["invoice_no", "dispatch_date", "invoice_date", "driver_name", "helper_name",
               "vehicle_num", "area", "division_desc", "customer_name", "boxes", "normal_boxes",
               "freezer_boxes", "not_supplied_reason"]
    row_dicts = [{c: getattr(r, c) for c in columns} for r in rows]
    return {"metric": metric, "columns": columns, "rows": row_dicts, "truncated": total_matching > _DETAIL_ROW_LIMIT, "total_matching": total_matching}


def _valid_vehicle_keys(db: Session) -> set[str]:
    """DATABASE-AUTHORITATIVE FILTERING (vehicles): the set of normalized
    vehicle identities that actually exist in the Fleet/Vehicle Database,
    for restricting vehicle-identity OUTPUTS (active_vehicles KPI, any
    future vehicle-number listing) to real, currently-registered vehicles
    - the same rule Drivers/Areas already get in build_filtered_sap_query.

    Deliberately NOT applied as a row-level `.filter(...in_(...))` inside
    build_filtered_sap_query the way Driver/Area are: unlike driver_name
    (the primary entity Driver Overview/KPIs are about) or area (ditto for
    Area Analytics), a SAP invoice row's vehicle number is a secondary
    attribute of an order - excluding the entire row/order/box count just
    because ITS vehicle text didn't cleanly match the Vehicle Database
    would corrupt Total Orders/Boxes/Driver Overview for reasons that have
    nothing to do with those KPIs. That vehicle-number matching is
    genuinely unreliable in this data is exactly why services/
    vehicle_matching.py exists as a whole separate fuzzy-matching
    subsystem (manual override -> exact key -> fuzzy name-token, in that
    order) for Driver Performance - hard-filtering every row here would
    silently and drastically undercount orders. So this only restricts
    which vehicle identities get reported as "active"/listed, using the
    same normalize_vehicle() used to build vehicle_key in the first place
    so formatting differences (spaces, dashes, case) between the SAP feed
    and Fleet Database don't cause false negatives.
    """
    from app.models.fleet import Vehicle
    from app.services import identity_engine as ie
    return {ie.normalize_vehicle(n) for (n,) in db.query(Vehicle.number).all() if n}


def compute_home_kpis_fast(db: Session, start_date: str = "", end_date: str = "", driver: str = "",
                            drivers: str = "", areas: str = "", division: str = "",
                            route_type: str = "", vehicle_type: str = "",
                            facility_type: str = "", salesman: str = "") -> dict:
    """
    ITEM PASS 6 (Dashboard Part 1 - progressive loading): a fast subset of
    compute_home_dashboard() below, for the Overview tab to paint its KPI
    row immediately instead of waiting for the full response.

    The single biggest cost in compute_home_dashboard is NOT the KPI
    arithmetic itself (that's cheap, in-memory summing over already-
    fetched rows) - it's the two DB round-trips: `build_filtered_sap_query
    (...).all()` and, more importantly, `db.query(LandmarkVisitFact).all()`
    which fetches that ENTIRE table unconditionally (see
    compute_home_dashboard's own comment on `lm_rows`). This function
    skips the LandmarkVisitFact fetch entirely, because exactly ONE KPI
    (`avg_route_hours`) depends on it - every other KPI only needs
    `sap_rows`. `avg_route_hours` is simply omitted from this fast
    payload (returned as None) and gets filled in by the normal, full
    `/dashboard/home` response shortly after, which the frontend merges
    in once it arrives (see HomeTab.tsx) - the KPI tile just shows a
    brief placeholder for that one tile, not for the whole page.

    IMPORTANT: this duplicates the KPI arithmetic from
    compute_home_dashboard() verbatim (not reimplemented/reinterpreted)
    for every field it computes, specifically so there is no risk of this
    "fast" path ever disagreeing with the real one. `build_filtered_sap_
    query` itself - the actual filtering/business-rule logic - is called
    unchanged, not duplicated.
    """
    q = build_filtered_sap_query(db, start_date, end_date, driver, drivers, areas, division,
                                  route_type, vehicle_type, facility_type, salesman)
    sap_rows = q.all()

    total_invoices = len(sap_rows)
    total_boxes = sum(r.boxes or 0 for r in sap_rows)
    total_normal = sum(r.normal_boxes or 0 for r in sap_rows)
    total_freezer = sum(r.freezer_boxes or 0 for r in sap_rows)
    active_drivers = len({r.driver_name for r in sap_rows if r.driver_name})
    not_supplied_count = sum(1 for r in sap_rows if r.not_supplied_reason)
    unique_customers = len({r.customer_name for r in sap_rows if r.customer_name})
    # DATABASE-AUTHORITATIVE FILTERING (vehicles): only count vehicle
    # keys that match a real Fleet/Vehicle Database entry - see
    # _valid_vehicle_keys()'s docstring for why this is scoped to just
    # this KPI rather than a row-level filter in build_filtered_sap_query.
    valid_vehicle_keys = _valid_vehicle_keys(db)
    active_vehicles = len({r.vehicle_key for r in sap_rows if r.vehicle_key and r.vehicle_key in valid_vehicle_keys})

    day_diffs = []
    for r in sap_rows:
        if r.invoice_date and r.dispatch_date:
            try:
                d1 = datetime.strptime(r.invoice_date, "%Y-%m-%d")
                d2 = datetime.strptime(r.dispatch_date, "%Y-%m-%d")
                diff = (d2 - d1).days
                # item 7: negative lead time (dispatch before invoice date)
                # is a bad/invalid record and must never enter any lead
                # time average, here or anywhere else - not optional.
                if diff >= 0:
                    day_diffs.append(diff)
            except ValueError:
                pass
    avg_lead_time_days = round(sum(day_diffs) / len(day_diffs), 1) if day_diffs else None

    return {
        "valid_invoices": total_invoices,
        "total_boxes": total_boxes,
        "freezer_boxes": total_freezer,
        "normal_boxes": total_normal,
        "active_drivers": active_drivers,
        "avg_boxes_per_driver": round(total_boxes / active_drivers, 1) if active_drivers else 0,
        "not_supplied": not_supplied_count,
        "avg_lead_time_days": avg_lead_time_days,
        "unique_customers": unique_customers,
        "avg_route_hours": None,  # deliberately omitted - see docstring; filled in by the full /dashboard/home response
        "orders_per_driver": round(total_invoices / active_drivers, 1) if active_drivers else 0,
        "active_vehicles": active_vehicles,
    }


def compute_home_dashboard(db: Session, start_date: str = "", end_date: str = "", driver: str = "",
                            drivers: str = "", areas: str = "", division: str = "",
                            route_type: str = "", vehicle_type: str = "",
                            facility_type: str = "", salesman: str = "", sap_rows: list | None = None) -> dict:
    """Direct port of gatherKpis() + renderDashboard() + renderMainCharts(),
    extended with Dashboard Configuration exclusions (always applied) and
    Dashboard Global Filters (applied on top, only when the person picks
    them - see apply_global_filters() above)."""
    if sap_rows is None:
        q = build_filtered_sap_query(db, start_date, end_date, driver, drivers, areas, division,
                                      route_type, vehicle_type, facility_type, salesman)
        sap_rows = q.all()

    lm_q = db.query(LandmarkVisitFact)
    lm_rows = lm_q.all()  # V1's lmRows isn't independently date-filtered by this same range in the reviewed code path

    total_invoices = len(sap_rows)
    total_boxes = sum(r.boxes or 0 for r in sap_rows)
    total_normal = sum(r.normal_boxes or 0 for r in sap_rows)
    total_freezer = sum(r.freezer_boxes or 0 for r in sap_rows)
    active_drivers = len({r.driver_name for r in sap_rows if r.driver_name})
    not_supplied_count = sum(1 for r in sap_rows if r.not_supplied_reason)
    unique_customers = len({r.customer_name for r in sap_rows if r.customer_name})
    # DATABASE-AUTHORITATIVE FILTERING (vehicles): only count vehicle
    # keys that match a real Fleet/Vehicle Database entry - see
    # _valid_vehicle_keys()'s docstring for why this is scoped to just
    # this KPI rather than a row-level filter in build_filtered_sap_query.
    valid_vehicle_keys = _valid_vehicle_keys(db)
    active_vehicles = len({r.vehicle_key for r in sap_rows if r.vehicle_key and r.vehicle_key in valid_vehicle_keys})

    day_diffs = []
    for r in sap_rows:
        if r.invoice_date and r.dispatch_date:
            try:
                d1 = datetime.strptime(r.invoice_date, "%Y-%m-%d")
                d2 = datetime.strptime(r.dispatch_date, "%Y-%m-%d")
                diff = (d2 - d1).days
                # item 7: same mandatory negative-lead-time exclusion as
                # compute_home_kpis_fast, so the fast-path KPI and this
                # full path never disagree.
                if diff >= 0:
                    day_diffs.append(diff)
            except ValueError:
                pass
    avg_lead_time_days = round(sum(day_diffs) / len(day_diffs), 1) if day_diffs else None

    route_map = _build_lm_route_map(lm_rows)
    durations = [r["route_duration_minutes"] for r in route_map.values() if r["route_duration_minutes"] > 0]
    avg_route_hours = round(sum(durations) / len(durations) / 60, 1) if durations else None

    kpis = {
        "valid_invoices": total_invoices,
        "total_boxes": total_boxes,
        "freezer_boxes": total_freezer,
        "normal_boxes": total_normal,
        "active_drivers": active_drivers,
        "avg_boxes_per_driver": round(total_boxes / active_drivers, 1) if active_drivers else 0,
        "not_supplied": not_supplied_count,
        "avg_lead_time_days": avg_lead_time_days,
        "unique_customers": unique_customers,
        "avg_route_hours": avg_route_hours,
        "orders_per_driver": round(total_invoices / active_drivers, 1) if active_drivers else 0,
        "active_vehicles": active_vehicles,
    }

    # --- Driver Overview table (renderDashboard's table) ---
    driver_perf = _build_driver_perf(sap_rows)
    ns_by_driver: dict[str, int] = {}
    for r in sap_rows:
        if r.not_supplied_reason:
            ns_by_driver[r.driver_name] = ns_by_driver.get(r.driver_name, 0) + 1

    driver_overview = sorted(
        [{
            "driver_name": d["driver_name"], "vehicle_num": d["vehicle_num"] or "-",
            "vehicle_type": d["vehicle_type"], "orders": d["invoices"], "boxes": d["boxes"],
            "freezer": d["freezer"], "not_supplied": ns_by_driver.get(d["driver_name"], 0),
        } for d in driver_perf.values()],
        key=lambda x: -x["boxes"],
    )

    # --- 4 main charts (renderMainCharts) ---
    # BUGFIX (Driver Overview / Boxes by Driver showing only some
    # drivers): this used to be `sorted(...)[:15]`, silently dropping
    # every driver past the top 15 by boxes from the chart data itself -
    # not just visually, the JSON payload never contained them, so no
    # frontend fix could have surfaced them. The chart's own container
    # already scales its height to the row count (see
    # widgets/homeWidgets.tsx's `Math.max(280, driverBoxesData.length *
    # 30)`), so there's no rendering reason to cap this - removed the
    # slice entirely. Every driver present in the current filtered
    # `sap_rows` now appears in both this chart AND `driver_overview`
    # above (which was never truncated).
    top_drivers = sorted(driver_perf.values(), key=lambda d: -d["boxes"])
    driver_boxes_chart = {"labels": [d["driver_name"] for d in top_drivers],
                           "values": [d["boxes"] for d in top_drivers]}

    facility_counts: dict[str, int] = {}
    for r in sap_rows:
        facility_counts[r.facility_type] = facility_counts.get(r.facility_type, 0) + 1
    facility_chart = {"labels": list(facility_counts.keys()), "values": list(facility_counts.values())}

    vantype_normal: dict[str, int] = {}
    vantype_freezer: dict[str, int] = {}
    for r in sap_rows:
        vantype_normal[r.vehicle_type] = vantype_normal.get(r.vehicle_type, 0) + (r.normal_boxes or 0)
        vantype_freezer[r.vehicle_type] = vantype_freezer.get(r.vehicle_type, 0) + (r.freezer_boxes or 0)
    van_types = sorted(set(vantype_normal) | set(vantype_freezer))
    vantype_chart = {
        "labels": van_types,
        "normal": [vantype_normal.get(v, 0) for v in van_types],
        "freezer": [vantype_freezer.get(v, 0) for v in van_types],
    }

    returns_chart = {"delivered": total_invoices, "not_supplied": not_supplied_count}

    return {
        "kpis": kpis,
        "driver_overview": driver_overview,
        "charts": {
            "driver_boxes": driver_boxes_chart,
            "facility": facility_chart,
            "vantype": vantype_chart,
            "returns": returns_chart,
        },
    }


_LEAD_TIME_BAND_LABELS = ["0 Days", "1 Day", "2 Days", "3 Days", "4 Days", "5 Days", "More than 5 Days"]


def _lead_time_band(days: float) -> str:
    """Excel-authoritative bucketing (Weekly Dispatch Lead Time workbook,
    'Dispatch Records'!Lead Time Band column - a nested IF on the exact
    integer day count): 0/1/2/3/4/5 each get their own exact-match band,
    and everything above 5 collapses into "More than 5 Days". Excel's
    formula compares the *unrounded* day count to these integers (a
    fractional value, which shouldn't occur for whole calendar-day
    subtraction, would fall through to "More than 5 Days" same as here)."""
    d = round(days)
    if 0 <= d <= 5:
        return _LEAD_TIME_BAND_LABELS[d]
    return "More than 5 Days"


def compute_lead_time_tab(db: Session, start_date: str = "", end_date: str = "", driver: str = "",
                           drivers: str = "", areas: str = "", division: str = "", route_type: str = "",
                           vehicle_type: str = "", facility_type: str = "", salesman: str = "",
                           lead_time_band: str = "", classification: str = "",
                           sap_rows: list | None = None) -> dict:
    """Lead Time Dashboard (Excel parity pass): ported against the
    'Weekly_Dispatch_Lead_Time' workbook's 'Dispatch Records' / 'Dashboard
    Source' / 'Dashboard' sheets, which are the authority for this tab's
    eligibility rule, Lead Time calculation, Lead Time Band, and
    Classification - see the eligibility/classification notes below for
    exactly what was and wasn't reproducible from the app's existing SAP
    import (services/analytics_parsers.py -> models/analytics_facts.py).

    Dashboard Filter Improvements (V2 milestone, unchanged): uses the same
    shared build_filtered_sap_query() as the Overview tab, so every
    existing slicer (Driver, Division, Area, Vehicle Type, Facility Type,
    Salesman, Route Type, Date Range - Date Range already accepts single
    dispatch dates, since start_date/end_date are plain 'YYYY-MM-DD'
    equality/range comparisons, not month buckets) AND Dashboard
    Configuration exclusions apply here too.

    LEAD TIME DASHBOARD ELIGIBILITY (Excel 'Dashboard Eligible' column,
    'Dispatch Records'!BA - see workbook formula quoted in full in this
    PR's notes): a row counts toward every Lead Time KPI/chart/table below
    only if ALL of:
      - No of Boxes > 0                                  -> SapInvoiceFact.boxes > 0
      - Invoice Date and Dispatch Date are both present   -> both non-blank
      - Division Description is present, not "0", and
        not (case/whitespace-insensitively) "Unclassified" -> SapInvoiceFact.division_desc
      - Dispatch Type <> "Resupply Orders"
    The first four conditions map onto columns this app's SAP import
    actually captures (models/analytics_facts.py's SapInvoiceFact.boxes /
    invoice_date / dispatch_date / division_desc) and are enforced below.
    The "Dispatch Type <> Resupply Orders" condition is NOT enforced here:
    in the workbook, "Dispatch Type" is populated by matching each row's
    Invoice Number against a separate 'Resupply Orders' sheet (a
    Not-Supplied invoice that reappears on a later dispatch) - that
    matching input has no equivalent captured anywhere in this app's SAP
    import today (no resupply/original-dispatch-date linkage is parsed by
    analytics_parsers.py or stored on SapInvoiceFact), so it genuinely
    cannot be reproduced from the existing data source without a schema/
    importer change, which is out of this task's scope ("do not create a
    second database"). This is a known, documented gap versus Excel, not
    a silently-invented approximation.

    CLASSIFICATION (Excel 'Dashboard Source'!Classification column =
    Division Description Clean, defaulting to "Unclassified" when blank):
    grouped by SapInvoiceFact.division_desc, NOT facility_type (facility_type
    is a different, app-internal keyword-classifier field used elsewhere on
    the dashboard - Excel's Classification is Division Description, so this
    tab now matches that rather than facility_type, which is what it read
    from before this pass).

    LEAD TIME BAND: exact Excel band labels (0 Days/1 Day/2 Days/3 Days/
    4 Days/5 Days/More than 5 Days), not the previous 0-7 numeric-bin
    scheme (which mislabeled "6" and "7+" as if 6 and 7 were their own
    bands - Excel has no such bands; everything above 5 is one band).

    item 7 (unchanged, unrelated to this pass): negative lead times
    (dispatch before invoice - a data-entry issue) are still dropped at
    the data layer so they can never win "fastest_days" or skew any
    number below.
    """
    if sap_rows is None:
        q = build_filtered_sap_query(db, start_date, end_date, driver, drivers, areas, division,
                                      route_type, vehicle_type, facility_type, salesman)
        sap_rows = q.all()

    def _clean_division(r) -> str:
        d = (r.division_desc or "").strip()
        if not d or d == "0" or d.lower() == "unclassified":
            return ""
        return d

    # Lead Time Dashboard eligibility (see docstring) - boxes>0, both
    # dates present, and a real (non-blank/non-"0"/non-"Unclassified")
    # division. This is intentionally scoped to THIS function only (not
    # build_filtered_sap_query), since it's a Lead-Time-Dashboard-specific
    # rule from the Excel workbook, not a dashboard-wide exclusion.
    rows = [r for r in sap_rows
            if r.invoice_date and r.dispatch_date and (r.boxes or 0) > 0 and _clean_division(r)]

    lead_times = []
    for r in rows:
        try:
            d1 = datetime.strptime(r.invoice_date, "%Y-%m-%d")
            d2 = datetime.strptime(r.dispatch_date, "%Y-%m-%d")
            lead_times.append((r, (d2 - d1).total_seconds() / 86400))
        except ValueError:
            pass

    # item 7: drop pairs where dispatch_date fell before invoice_date (a
    # negative lead time - a data-entry issue, never a real delivery).
    # This used to be gated behind the "exclude_negative_lead_times"
    # toggle (default OFF); it's mandatory now, at the data layer, so a
    # negative record can never win "fastest_days" or skew the average -
    # applies to the KPI, the chart, the histogram, the per-facility
    # breakdown, and the fastest/longest detail rows below, since they
    # all derive from this same `lead_times` list.
    lead_times = [(r, lt) for r, lt in lead_times if lt >= 0]

    # Lead Time Dashboard filters (Lead Time Band / Classification): the
    # dropdown option lists are drawn from the full eligible set, BEFORE
    # either filter is applied, so choosing one band doesn't make the
    # other bands disappear from that same dropdown next render.
    available_bands = [b for b in _LEAD_TIME_BAND_LABELS if any(_lead_time_band(lt) == b for _, lt in lead_times)]
    available_classifications = sorted({_clean_division(r) for r, _ in lead_times})

    if lead_time_band:
        lead_times = [(r, lt) for r, lt in lead_times if _lead_time_band(lt) == lead_time_band]
    if classification:
        lead_times = [(r, lt) for r, lt in lead_times if _clean_division(r) == classification]

    values = [lt for _, lt in lead_times]
    kpis = {
        "total_invoices": len(lead_times),
        "overall_avg_days": round(sum(values) / len(values), 1) if values else None,
        "fastest_days": round(min(values)) if values else None,
        "longest_days": round(max(values)) if values else None,
    }

    # Detail rows behind the Fastest/Longest KPI cards, for the click-to-see-detail popup.
    sorted_by_days = sorted(lead_times, key=lambda x: x[1])
    def _detail_rows(pairs):
        return [{"invoice_no": r.invoice_no, "driver_name": r.driver_name, "customer_name": r.customer_name,
                  "invoice_date": r.invoice_date, "dispatch_date": r.dispatch_date, "days": round(lt, 1)}
                 for r, lt in pairs]
    fastest_detail = _detail_rows(sorted_by_days[:10])
    longest_detail = _detail_rows(list(reversed(sorted_by_days))[:10])

    # By Classification (= Excel's "Division Description Performance"
    # table AND the per-column breakdown behind "Average Lead Time by
    # Division Description Clean" - same grouping serves both, matching
    # the Excel workbook where they're the same underlying pivot).
    class_map: dict[str, dict] = {}
    for r, lt in lead_times:
        cls = _clean_division(r) or "Unclassified"
        c = class_map.setdefault(cls, {"name": cls, "orders": 0, "total_days": 0.0, "min_d": None, "max_d": None})
        c["orders"] += 1
        c["total_days"] += lt
        c["min_d"] = lt if c["min_d"] is None else min(c["min_d"], lt)
        c["max_d"] = lt if c["max_d"] is None else max(c["max_d"], lt)
    class_rows = sorted(
        [{"name": c["name"], "orders": c["orders"], "avg_days": round(c["total_days"] / c["orders"], 1),
          "min_days": round(c["min_d"]), "max_days": round(c["max_d"])} for c in class_map.values()],
        key=lambda c: c["avg_days"],
    )

    # Lead Time Distribution - exact Excel bands (see _lead_time_band).
    distribution_counts = {b: 0 for b in _LEAD_TIME_BAND_LABELS}
    for _, lt in lead_times:
        distribution_counts[_lead_time_band(lt)] += 1

    # Lead Time x Classification matrix (Excel's "LEAD TIME x
    # CLASSIFICATION" pivot: rows = Lead Time Band, columns =
    # Classification, values = order count, with row/column/grand
    # totals) - not previously implemented in the app at all.
    classifications_for_matrix = sorted({c["name"] for c in class_rows})
    matrix_counts: dict[tuple[str, str], int] = {}
    for r, lt in lead_times:
        cls = _clean_division(r) or "Unclassified"
        band = _lead_time_band(lt)
        key = (band, cls)
        matrix_counts[key] = matrix_counts.get(key, 0) + 1
    matrix_rows = []
    col_totals = {c: 0 for c in classifications_for_matrix}
    grand_total = 0
    for band in _LEAD_TIME_BAND_LABELS:
        # every one of the 7 bands is always included, even at 0 orders in
        # the current filtered set - matches Excel, which always shows all
        # 7 pivot rows rather than hiding empty ones.
        row_cells = {c: matrix_counts.get((band, c), 0) for c in classifications_for_matrix}
        row_total = sum(row_cells.values())
        for c, v in row_cells.items():
            col_totals[c] += v
        grand_total += row_total
        matrix_rows.append({"band": band, "counts": row_cells, "total": row_total})

    return {
        "kpis": kpis, "by_classification": class_rows,
        "distribution": {"bins": _LEAD_TIME_BAND_LABELS, "counts": [distribution_counts[b] for b in _LEAD_TIME_BAND_LABELS]},
        "fastest_detail": fastest_detail, "longest_detail": longest_detail,
        "band_classification_matrix": {
            "classifications": classifications_for_matrix, "rows": matrix_rows,
            "col_totals": col_totals, "grand_total": grand_total,
        },
        "available_bands": available_bands, "available_classifications": available_classifications,
    }


def compute_order_summary_tab(db: Session, start_date: str = "", end_date: str = "", driver: str = "",
                               drivers: str = "", areas: str = "", division: str = "", route_type: str = "",
                               vehicle_type: str = "", facility_type: str = "", salesman: str = "", sap_rows: list | None = None) -> dict:
    """Direct port of renderOrderSummary() - driver x facility-type matrix
    with row/column totals. See compute_lead_time_tab's docstring for the
    Dashboard Filter Improvements note - same shared query builder now."""
    if sap_rows is None:
        q = build_filtered_sap_query(db, start_date, end_date, driver, drivers, areas, division,
                                      route_type, vehicle_type, facility_type, salesman)
        sap_rows = q.all()
    rows = sap_rows

    fac_types = sorted({r.facility_type for r in rows if r.facility_type})
    driver_map: dict[str, dict] = {}
    for r in rows:
        d = driver_map.setdefault(r.driver_name, {"driver": r.driver_name, "fac": {}, "total": 0})
        d["fac"][r.facility_type] = d["fac"].get(r.facility_type, 0) + 1
        d["total"] += 1

    driver_rows = sorted(driver_map.values(), key=lambda d: -d["total"])
    fac_totals = {f: sum(d["fac"].get(f, 0) for d in driver_rows) for f in fac_types}
    grand_total = sum(d["total"] for d in driver_rows)

    return {
        "facility_types": fac_types,
        "rows": [{"driver": d["driver"], "by_facility": [d["fac"].get(f, 0) for f in fac_types], "total": d["total"]}
                  for d in driver_rows],
        "facility_totals": [fac_totals[f] for f in fac_types],
        "grand_total": grand_total,
    }


def compute_area_analytics_tab(db: Session, start_date: str = "", end_date: str = "", driver: str = "",
                                drivers: str = "", areas: str = "", division: str = "", route_type: str = "",
                                vehicle_type: str = "", facility_type: str = "", salesman: str = "", sap_rows: list | None = None) -> dict:
    """Direct port of renderAreaAnalytics() - per-area orders/boxes/returns/
    success-rate table, weekly-by-area breakdown, and the Orders by Area
    chart. See compute_lead_time_tab's docstring for the Dashboard Filter
    Improvements note - same shared query builder now."""
    if sap_rows is None:
        q = build_filtered_sap_query(db, start_date, end_date, driver, drivers, areas, division,
                                      route_type, vehicle_type, facility_type, salesman)
        sap_rows = q.all()
    rows = sap_rows

    area_map: dict[str, dict] = {}
    for r in rows:
        area = r.area or "Unknown"
        a = area_map.setdefault(area, {"area": area, "orders": 0, "boxes": 0, "freezer": 0, "drivers": set(), "returns": 0})
        a["orders"] += 1
        a["boxes"] += r.boxes or 0
        a["freezer"] += r.freezer_boxes or 0
        a["drivers"].add(r.driver_name)
        if r.not_supplied_reason:
            a["returns"] += 1

    area_rows = sorted(area_map.values(), key=lambda a: -a["orders"])
    table = []
    for a in area_rows:
        total = a["orders"] + a["returns"]
        pct = round(a["orders"] / total * 100) if total else 100
        table.append({"area": a["area"], "orders": a["orders"], "boxes": a["boxes"], "freezer": a["freezer"],
                       "returns": a["returns"], "drivers": len(a["drivers"]), "success_pct": pct})

    totals = {"orders": sum(a["orders"] for a in area_rows), "boxes": sum(a["boxes"] for a in area_rows),
              "freezer": sum(a["freezer"] for a in area_rows), "returns": sum(a["returns"] for a in area_rows),
              "drivers": len({d for a in area_rows for d in a["drivers"]})}
    total_all = totals["orders"] + totals["returns"]
    totals["success_pct"] = round(totals["orders"] / total_all * 100) if total_all else 100

    # weekly-by-area breakdown (ISO week)
    week_map: dict[str, dict[str, int]] = {}
    for r in rows:
        area = r.area or "Unknown"
        try:
            d = datetime.strptime(r.dispatch_date, "%Y-%m-%d")
        except (ValueError, TypeError):
            continue
        wk = f"{d.isocalendar().year}-W{d.isocalendar().week:02d}"
        week_map.setdefault(wk, {})
        week_map[wk][area] = week_map[wk].get(area, 0) + 1
    weeks = sorted(week_map.keys())
    area_names = [a["area"] for a in area_rows]
    weekly_table = [{"week": wk, "by_area": [week_map[wk].get(a, 0) for a in area_names]} for wk in weeks]

    chart_top15 = area_rows[:15]
    return {
        "table": table, "totals": totals, "area_names": area_names, "weekly_table": weekly_table,
        "chart": {"labels": [a["area"] for a in chart_top15], "values": [a["orders"] for a in chart_top15]},
    }


def compute_not_supplied_tab(db: Session, start_date: str = "", end_date: str = "", driver: str = "",
                              drivers: str = "", areas: str = "", division: str = "", route_type: str = "",
                              vehicle_type: str = "", facility_type: str = "", salesman: str = "", sap_rows: list | None = None) -> dict:
    """Direct port of renderNotSupplied() - the not-supplied line items table
    and the (informational, KPI-excluded) zero-box rows table. See
    compute_lead_time_tab's docstring for the Dashboard Filter Improvements
    note - same shared query builder now."""
    if sap_rows is None:
        q = build_filtered_sap_query(db, start_date, end_date, driver, drivers, areas, division,
                                      route_type, vehicle_type, facility_type, salesman)
        sap_rows = q.all()
    rows = sap_rows

    not_supplied = [
        {"driver_name": r.driver_name, "customer_name": r.customer_name, "facility_type": r.facility_type,
         "reason": r.not_supplied_reason, "boxes": r.boxes, "invoice_date": r.invoice_date}
        for r in rows if r.not_supplied_reason
    ]
    zero_box = [
        {"driver_name": r.driver_name, "customer_name": r.customer_name,
         "invoice_date": r.invoice_date, "dispatch_date": r.dispatch_date}
        for r in rows if (r.boxes or 0) == 0 and not r.not_supplied_reason
    ]
    return {"not_supplied": not_supplied, "zero_box_excluded_from_kpis": zero_box}
