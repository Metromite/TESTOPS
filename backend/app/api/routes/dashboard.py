from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, require_roles
from app.models.user import Role, User
from app.models.analytics_facts import SapInvoiceFact, LandmarkVisitFact
from app.models.fleet import Driver
from app.services import dashboard_kpis, driver_performance, vehicle_matching, diagnostics, excel_export, availability
from app.services.response_cache import cached_dashboard_call

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/filter-options", dependencies=[Depends(get_current_user)])
def dashboard_filter_options(db: Session = Depends(get_db)):
    """
    Dashboard Filter Slicers (V2 milestone): distinct values actually
    present in SapInvoiceFact, for populating the Division/Facility
    Type/Salesman multi-select slicers with real options rather than a
    guessed static list (Driver/Area already come from their own live
    Fleet Database endpoints; Route Type/Vehicle Type come from
    reference_data.py via /api/meta/options - see Fleet.tsx/Dashboard.tsx).
    """
    def distinct(col):
        return sorted({v for (v,) in db.query(col).distinct().all() if v and str(v).strip()})

    # BUGFIX (Dashboard should only show Fleet Database drivers): this
    # used to return every distinct driver_name straight out of the SAP
    # import, including names SAP sent that don't correspond to any real
    # Fleet Database driver (typos, drivers who've since left, temp
    # codes, etc.) - Fleet Database is meant to be the source of truth.
    # Matched against BOTH Driver.code and Driver.name, case-insensitive,
    # since SAP invoice exports have been observed using either depending
    # on the feed.
    fleet_driver_codes = {c.lower() for (c,) in db.query(Driver.code).all() if c}
    fleet_driver_names = {n.lower() for (n,) in db.query(Driver.name).all() if n}
    sap_driver_names = distinct(SapInvoiceFact.driver_name)
    known_drivers = sorted(
        d for d in sap_driver_names
        if d.lower() in fleet_driver_codes or d.lower() in fleet_driver_names
    )

    # BUGFIX (DATABASE-AUTHORITATIVE FILTERING, areas): this used to
    # return `distinct(SapInvoiceFact.area)` - every distinct area value
    # straight out of SAP invoice history, same class of bug as the driver
    # one just above (and already fixed for drivers, but not here). An
    # area that only ever appeared in old transaction data and was never
    # added to (or was later removed from) the authoritative Area Database
    # would still show up as a selectable Area Slicer option, even though
    # build_filtered_sap_query() already restricts every query to
    # `Area.name` (see its own "item 8" comment) - so picking one of these
    # phantom options couldn't return wrong rows, but it could show the
    # person a filter choice that doesn't correspond to any real,
    # currently-valid area, and let them believe it's a legitimate
    # dashboard area. Same fix pattern as drivers: restrict to the
    # authoritative Area Database.
    from app.models.fleet import Area
    fleet_area_names = {a.lower() for (a,) in db.query(Area.name).all() if a}
    sap_area_names = distinct(SapInvoiceFact.area)
    known_areas = sorted(a for a in sap_area_names if a.lower() in fleet_area_names)

    return {
        "divisions": distinct(SapInvoiceFact.division_desc),
        "facility_types": distinct(SapInvoiceFact.facility_type),
        "salesmen": distinct(SapInvoiceFact.salesman),
        "areas": known_areas,
        "drivers": known_drivers,
    }


@router.get("/availability", dependencies=[Depends(get_current_user)])
def today_availability(db: Session = Depends(get_db)):
    """Direct port of V1's 'Today's Availability' section - who's on
    vacation, who's available, surplus staff, and shortage counts."""
    return availability.compute_today_availability(db)


@router.get("/home", dependencies=[Depends(get_current_user)])
def home_dashboard(start_date: str = "", end_date: str = "", driver: str = "",
                    drivers: str = "", areas: str = "", division: str = "",
                    route_type: str = "", vehicle_type: str = "", facility_type: str = "", salesman: str = "",
                    db: Session = Depends(get_db)):
    """
    Direct port of V1's dashboard.html Home tab (gatherKpis + renderDashboard
    + buildDriverPerf + buildLmRouteMap + renderMainCharts) - see
    services/dashboard_kpis.py for the full porting notes and honest scope
    limits (Home tab only; other dashboard tabs not yet read/ported).

    Dashboard Global Filters (V2 milestone): `drivers`, `areas`, `division`,
    `route_type`, `vehicle_type`, `facility_type`, `salesman` - every one
    comma-separated for multi-selection - applied on top of the existing
    start/end/driver params, and Dashboard Configuration exclusion rules
    are always applied underneath both (see
    dashboard_kpis.apply_dashboard_config_exclusions).

    PERFORMANCE NOTE (ITEM PASS 5): this used to compute from
    sap_invoice_facts/landmark_visit_facts on every single request, with
    no reuse between identical requests - now wrapped in
    response_cache.cached_dashboard_call(), which reuses the result for
    any later request with the SAME filters as long as no new data has
    been imported since (see response_cache.py's data-version-keyed
    invalidation - it cannot serve a result older than the last import).
    The underlying computation itself (compute_home_dashboard) is
    completely unchanged - same function, same query, same business
    logic - this only avoids re-running it for a repeat of the exact
    same request.
    """
    params = dict(start_date=start_date, end_date=end_date, driver=driver, drivers=drivers, areas=areas,
                  division=division, route_type=route_type, vehicle_type=vehicle_type,
                  facility_type=facility_type, salesman=salesman)
    return cached_dashboard_call(db, "home", params, lambda: dashboard_kpis.compute_home_dashboard(db, **params))


@router.get("/home/kpis", dependencies=[Depends(get_current_user)])
def home_dashboard_kpis_fast(start_date: str = "", end_date: str = "", driver: str = "",
                              drivers: str = "", areas: str = "", division: str = "",
                              route_type: str = "", vehicle_type: str = "", facility_type: str = "", salesman: str = "",
                              db: Session = Depends(get_db)):
    """
    ITEM PASS 6 (Dashboard Part 1 - progressive loading, "PHASE 2 - FAST
    DATA"): the Overview tab's KPI row no longer waits for the full
    /home response (which also does the expensive full-LandmarkVisitFact
    fetch for avg_route_hours, plus the driver-overview table and all 4
    charts). This returns just the KPI numbers, computed from sap_rows
    only - see dashboard_kpis.compute_home_kpis_fast's docstring for
    exactly what's skipped and why it's safe (one field,
    `avg_route_hours`, is filled in moments later by the full response
    the frontend also requests in parallel).

    Same response cache as every other dashboard endpoint (data-version-
    keyed, see response_cache.py) - a second identical request, from this
    user or another, is served instantly until the next SAP import.
    """
    params = dict(start_date=start_date, end_date=end_date, driver=driver, drivers=drivers, areas=areas,
                  division=division, route_type=route_type, vehicle_type=vehicle_type,
                  facility_type=facility_type, salesman=salesman)
    return cached_dashboard_call(db, "home-kpis-fast", params, lambda: dashboard_kpis.compute_home_kpis_fast(db, **params))


@router.get("/home/detail", dependencies=[Depends(get_current_user)])
def home_detail(metric: str, start_date: str = "", end_date: str = "", driver: str = "",
                 drivers: str = "", areas: str = "", division: str = "",
                 route_type: str = "", vehicle_type: str = "", facility_type: str = "", salesman: str = "",
                 db: Session = Depends(get_db)):
    """
    Dashboard Detail Window (V2 milestone): the actual rows behind a clicked
    Home tab KPI card - `metric` is one of the kpis dict's keys
    (valid_invoices, not_supplied, freezer_boxes, normal_boxes,
    active_drivers, unique_customers, active_vehicles, or any other -
    those without a specific case in get_home_detail_rows() just return
    every row in the current filtered set). Same filters as /home, so the
    detail window's rows always match what the KPI card counted.

    Bounded to 2000 rows for now - not the "millions of records, no lag"
    architecture the Dashboard Performance requirement ultimately needs;
    see dashboard_kpis.py's docstring on get_home_detail_rows().
    """
    return dashboard_kpis.get_home_detail_rows(
        db, metric, start_date=start_date, end_date=end_date, driver=driver,
        drivers=drivers, areas=areas, division=division, route_type=route_type, vehicle_type=vehicle_type,
        facility_type=facility_type, salesman=salesman,
    )


@router.get("/lead-time", dependencies=[Depends(get_current_user)])
def lead_time_tab(start_date: str = "", end_date: str = "", driver: str = "",
                   drivers: str = "", areas: str = "", division: str = "", route_type: str = "",
                   vehicle_type: str = "", facility_type: str = "", salesman: str = "",
                   lead_time_band: str = "", classification: str = "", db: Session = Depends(get_db)):
    """Lead Time Dashboard (Excel parity pass), extended with the full
    Dashboard Global Filters set (every tab respects the same slicers as
    the Overview tab) PLUS two Lead-Time-Dashboard-specific slicers of its
    own - `lead_time_band` and `classification` - matching the Excel
    workbook's own filterable pivot (see dashboard_kpis.compute_lead_time_tab's
    docstring for exactly what each does and reconciles against).

    ITEM PASS 5 (unchanged): wrapped in the same data-version-keyed
    response cache as /home (see response_cache.py)."""
    params = dict(start_date=start_date, end_date=end_date, driver=driver, drivers=drivers, areas=areas,
                  division=division, route_type=route_type, vehicle_type=vehicle_type,
                  facility_type=facility_type, salesman=salesman,
                  lead_time_band=lead_time_band, classification=classification)
    return cached_dashboard_call(db, "lead-time", params, lambda: dashboard_kpis.compute_lead_time_tab(db, **params))


@router.get("/order-summary", dependencies=[Depends(get_current_user)])
def order_summary_tab(start_date: str = "", end_date: str = "", driver: str = "",
                       drivers: str = "", areas: str = "", division: str = "", route_type: str = "",
                       vehicle_type: str = "", facility_type: str = "", salesman: str = "", db: Session = Depends(get_db)):
    """Direct port of dashboard.html's renderOrderSummary(), extended with
    the full Dashboard Global Filters set.

    ITEM PASS 5: wrapped in the same data-version-keyed response cache as
    /home (see response_cache.py) - compute_order_summary_tab itself is
    unchanged."""
    params = dict(start_date=start_date, end_date=end_date, driver=driver, drivers=drivers, areas=areas,
                  division=division, route_type=route_type, vehicle_type=vehicle_type,
                  facility_type=facility_type, salesman=salesman)
    return cached_dashboard_call(db, "order-summary", params, lambda: dashboard_kpis.compute_order_summary_tab(db, **params))


@router.get("/area-analytics", dependencies=[Depends(get_current_user)])
def area_analytics_tab(start_date: str = "", end_date: str = "", driver: str = "",
                        drivers: str = "", areas: str = "", division: str = "", route_type: str = "",
                        vehicle_type: str = "", facility_type: str = "", salesman: str = "", db: Session = Depends(get_db)):
    """Direct port of dashboard.html's renderAreaAnalytics(), extended with
    the full Dashboard Global Filters set.

    ITEM PASS 5: wrapped in the same data-version-keyed response cache as
    /home (see response_cache.py) - compute_area_analytics_tab itself is
    unchanged."""
    params = dict(start_date=start_date, end_date=end_date, driver=driver, drivers=drivers, areas=areas,
                  division=division, route_type=route_type, vehicle_type=vehicle_type,
                  facility_type=facility_type, salesman=salesman)
    return cached_dashboard_call(db, "area-analytics", params, lambda: dashboard_kpis.compute_area_analytics_tab(db, **params))


@router.get("/not-supplied", dependencies=[Depends(get_current_user)])
def not_supplied_tab(start_date: str = "", end_date: str = "", driver: str = "",
                      drivers: str = "", areas: str = "", division: str = "", route_type: str = "",
                      vehicle_type: str = "", facility_type: str = "", salesman: str = "", db: Session = Depends(get_db)):
    """Direct port of dashboard.html's renderNotSupplied(), extended with
    the full Dashboard Global Filters set.

    ITEM PASS 5: wrapped in the same data-version-keyed response cache as
    /home (see response_cache.py) - compute_not_supplied_tab itself is
    unchanged."""
    params = dict(start_date=start_date, end_date=end_date, driver=driver, drivers=drivers, areas=areas,
                  division=division, route_type=route_type, vehicle_type=vehicle_type,
                  facility_type=facility_type, salesman=salesman)
    return cached_dashboard_call(db, "not-supplied", params, lambda: dashboard_kpis.compute_not_supplied_tab(db, **params))


@router.get("/driver-performance", dependencies=[Depends(get_current_user)])
def driver_performance_tab(start_date: str = "", end_date: str = "", driver: str = "",
                            drivers: str = "", areas: str = "", division: str = "", route_type: str = "",
                            vehicle_type: str = "", facility_type: str = "", salesman: str = "", db: Session = Depends(get_db)):
    """Direct port of dashboard.html's renderDriverPerformance() + full
    buildLmRouteMap(), extended with the full Dashboard Global Filters set
    on its SAP side (see compute_driver_performance_tab's docstring for
    why the Landmark GPS side stays unfiltered).

    ITEM PASS 5: wrapped in the same data-version-keyed response cache as
    /home (see response_cache.py) - compute_driver_performance_tab itself
    is unchanged."""
    params = dict(start_date=start_date, end_date=end_date, driver=driver, drivers=drivers, areas=areas,
                  division=division, route_type=route_type, vehicle_type=vehicle_type,
                  facility_type=facility_type, salesman=salesman)
    return cached_dashboard_call(db, "driver-performance", params, lambda: driver_performance.compute_driver_performance_tab(db, **params))


@router.get("/driver-mapping-review", dependencies=[Depends(require_roles(Role.ADMIN, Role.DISPATCHER))])
def driver_mapping_review_tab(db: Session = Depends(get_db)):
    """Direct port of dashboard.html's renderDriverMappingReview(). Write-
    capable (can change matching), so Viewer role is excluded - matches
    the "Viewer: read-only dashboards" rule."""
    sap_rows = db.query(SapInvoiceFact).all()
    lm_rows = db.query(LandmarkVisitFact).all()
    return vehicle_matching.compute_driver_mapping_review(db, sap_rows, lm_rows)


class ManualMappingRequest(BaseModel):
    vehicle_key: str
    sap_driver: str = ""  # empty string clears the override


@router.post("/driver-mapping-review/apply", dependencies=[Depends(require_roles(Role.ADMIN, Role.DISPATCHER))])
def apply_mapping(payload: ManualMappingRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Direct port of applyManualMapping() - now persisted in Postgres
    instead of browser memory, so every user sees the same override."""
    vehicle_matching.apply_manual_mapping(db, payload.vehicle_key, payload.sap_driver, updated_by=user.username)
    return {"ok": True}


@router.post("/driver-mapping-review/reset", dependencies=[Depends(require_roles(Role.ADMIN, Role.DISPATCHER))])
def reset_mappings(db: Session = Depends(get_db)):
    """Direct port of resetAllMappings()."""
    vehicle_matching.reset_all_mappings(db)
    return {"ok": True}


@router.get("/diagnostics", dependencies=[Depends(get_current_user)])
def diagnostics_tab(db: Session = Depends(get_db)):
    """Direct port of dashboard.html's renderDiagnostics()."""
    return diagnostics.compute_diagnostics(db)


@router.get("/export-excel", dependencies=[Depends(get_current_user)])
def export_excel(start_date: str = "", end_date: str = "", driver: str = "",
                  drivers: str = "", areas: str = "", division: str = "", route_type: str = "",
                  vehicle_type: str = "", facility_type: str = "", salesman: str = "",
                  lead_time_band: str = "", classification: str = "",
                  db: Session = Depends(get_db)):
    """
    Direct port of dashboard_backend.py's /export endpoint - same color
    palette, same native Excel bar/doughnut/stacked charts, same sheet
    layout. Pulls data straight from the already-computed dashboard tabs
    instead of expecting the browser to re-post it, so the export can
    never drift from what the dashboard itself shows.

    BUGFIX (export always downloaded the whole month, ignoring every
    active Global Filter): this endpoint used to take NO query params at
    all, so export_dashboard_workbook() built its dataset from
    build_filtered_sap_query(db) with every filter left at its default
    ("" = no restriction) - completely independent of whatever the
    dashboard the person was actually looking at had filtered down to.
    Now accepts the exact same Global Filters query-param set every other
    /dashboard/* tab endpoint already does (see dashboardFilterParams() on
    the frontend, which the Dashboard.tsx Export button now sends here
    too) and threads them straight into export_dashboard_workbook(), which
    passes them to the one shared build_filtered_sap_query() call - no
    second/duplicate filtering logic was added anywhere; this reuses the
    exact same function every tab's numbers already come from.

    lead_time_band/classification (FINAL CORRECTION PASS): these two are
    Lead-Time-Dashboard-only slicers, not part of build_filtered_sap_query
    - they're applied inside compute_lead_time_tab AFTER the shared row
    set is built (see its docstring), same as the Lead Time tab endpoint
    itself. Passed through here purely so the exported "Lead Time by
    Class"/"Lead Time Distribution" sheets match whatever the person had
    selected on the Lead Time tab when they clicked export - every other
    sheet (KPIs, Driver Overview, Area Analytics, etc.) is unaffected by
    these two, exactly as on the dashboard itself.
    """
    params = dict(start_date=start_date, end_date=end_date, driver=driver, drivers=drivers, areas=areas,
                  division=division, route_type=route_type, vehicle_type=vehicle_type,
                  facility_type=facility_type, salesman=salesman,
                  lead_time_band=lead_time_band, classification=classification)
    buf = excel_export.export_dashboard_workbook(db, **params)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{excel_export.export_filename()}"'},
    )


# ---------------------------------------------------------------------------
# Dashboard Configuration (V2 milestone) - permanent, admin-editable
# exclusion rules applied to every future Dashboard computation & import.
# ITEM 15 (rule engine expansion) - see models/dashboard_config.py's module
# docstring for the full reference on rule_type/operator/negate/logic and
# the two "setting" toggle rows (exclude_negative_lead_times/
# fleet_only_drivers). invoice_type/custom remain saveable but unenforced,
# as before - no matching column anywhere in SapInvoiceFact for either.
# ---------------------------------------------------------------------------

class DashboardConfigRuleIn(BaseModel):
    rule_type: str  # see models/dashboard_config.py ALL_RULE_TYPES
    value: str
    note: str = ""
    operator: str = "contains"  # see models/dashboard_config.py OPERATORS
    negate: bool = False
    logic: str = "OR"  # "AND" or "OR", vs sibling rules of the same rule_type


@router.get("/config-rules", dependencies=[Depends(get_current_user)])
def list_config_rules(db: Session = Depends(get_db)):
    return dashboard_kpis.get_dashboard_config_rules(db)


@router.post("/config-rules", dependencies=[Depends(require_roles(Role.ADMIN))])
def create_config_rule(payload: DashboardConfigRuleIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.models.dashboard_config import DashboardConfigRule, ALL_RULE_TYPES, OPERATORS, SETTING_NAMES
    from fastapi import HTTPException
    if payload.rule_type not in ALL_RULE_TYPES:
        raise HTTPException(400, f"Unknown rule_type. Must be one of: {sorted(ALL_RULE_TYPES)}")
    if payload.operator not in OPERATORS:
        raise HTTPException(400, f"Unknown operator. Must be one of: {sorted(OPERATORS)}")
    if payload.logic not in ("AND", "OR"):
        raise HTTPException(400, "logic must be 'AND' or 'OR'")
    if payload.rule_type == "setting" and payload.value not in SETTING_NAMES:
        raise HTTPException(400, f"Unknown setting. Must be one of: {sorted(SETTING_NAMES)}")
    rule = DashboardConfigRule(rule_type=payload.rule_type, value=payload.value.strip(),
                                note=payload.note, operator=payload.operator,
                                negate=payload.negate, logic=payload.logic,
                                created_by=user.username)
    db.add(rule)
    db.commit()
    return {"ok": True, "id": rule.id}


@router.delete("/config-rules/{rule_id}", dependencies=[Depends(require_roles(Role.ADMIN))])
def delete_config_rule(rule_id: int, db: Session = Depends(get_db)):
    from app.models.dashboard_config import DashboardConfigRule
    db.query(DashboardConfigRule).filter(DashboardConfigRule.id == rule_id).delete()
    db.commit()
    return {"ok": True}
