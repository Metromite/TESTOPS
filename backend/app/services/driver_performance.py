"""
services/driver_performance.py
----------------------------------
Direct port of dashboard.html's renderDriverPerformance() tab, plus the
FULL version of buildLmRouteMap() (dashboard_kpis.py has a slimmed-down
version used only for the Home tab's Avg Route Hours KPI - this one keeps
every field V1's route cards and table actually display: vehicle model,
GPS driver names, match confidence, depot departure/last-stop times as
formatted strings, avg stop duration, passthrough count).
"""
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.analytics_facts import SapInvoiceFact, LandmarkVisitFact
from app.services.dashboard_kpis import _parse_arrival_datetime, _is_depot_landmark, _build_driver_perf
from app.services import vehicle_matching as vm


def _format_time(dt) -> str:
    return dt.strftime("%H:%M") if dt else "—"


def _minutes_to_hm(mins: float) -> str:
    if not mins or mins <= 0:
        return "—"
    h, m = divmod(int(mins), 60)
    return f"{h}h {m}m" if h > 0 else f"{m}m"


def _build_lm_route_map_full(lm_rows: list[LandmarkVisitFact], vehicle_match_map: dict) -> dict:
    """Full port of buildLmRouteMap() - every field V1's route cards/table use."""
    by_vehicle: dict[str, list[LandmarkVisitFact]] = {}
    for r in lm_rows:
        if r.vehicle_key:
            by_vehicle.setdefault(r.vehicle_key, []).append(r)

    route_map = {}
    for vkey, rows in by_vehicle.items():
        rows_sorted = sorted(rows, key=lambda r: _parse_arrival_datetime(r.arrival) or datetime.min)
        match_info = vehicle_match_map.get(vkey, {"sap_driver": None, "match_method": "none", "confidence": "none"})
        gps_driver_names = list({r.driver_name for r in rows_sorted if r.driver_name and r.driver_name != "Unknown"})
        display_driver = match_info.get("sap_driver") or (gps_driver_names[0] if gps_driver_names else "Unknown")

        vehicle_raw = rows_sorted[0].vehicle_raw or vkey
        vehicle_num = vehicle_raw.split("(")[0].strip() if "(" in vehicle_raw else vehicle_raw
        vehicle_model = ""
        if "(" in vehicle_raw and ")" in vehicle_raw:
            vehicle_model = vehicle_raw[vehicle_raw.index("(") + 1: vehicle_raw.rindex(")")].strip()

        depot_rows = [r for r in rows_sorted if _is_depot_landmark(r.customer_name)]
        stop_rows = [r for r in rows_sorted if not r.is_passthrough and not r.is_depot
                     and not _is_depot_landmark(r.customer_name)]

        route_start = None
        departing_depot = next((r for r in depot_rows if r.departure and r.departure != "-"), None)
        if departing_depot:
            route_start = _parse_arrival_datetime(departing_depot.departure)
        route_end = _parse_arrival_datetime(stop_rows[-1].departure) if stop_rows else None
        route_duration = (round((route_end - route_start).total_seconds() / 60)
                           if route_start and route_end and route_end > route_start else 0)

        total_stop_mins = sum(r.minutes or 0 for r in stop_rows)
        avg_stop_mins = round(total_stop_mins / len(stop_rows)) if stop_rows else 0

        route_map[vkey] = {
            "vehicle_key": vkey, "vehicle_raw": vehicle_raw, "vehicle_num": vehicle_num, "vehicle_model": vehicle_model,
            "sap_driver": match_info.get("sap_driver"), "match_method": match_info.get("match_method"),
            "match_confidence": match_info.get("confidence"), "display_driver": display_driver,
            "gps_driver_names": gps_driver_names,
            "route_start": _format_time(route_start), "route_end": _format_time(route_end),
            "route_duration": route_duration, "route_duration_hm": _minutes_to_hm(route_duration),
            "stops": len(stop_rows),
            "stop_rows": [{"customer_name": r.customer_name, "arrival": r.arrival, "departure": r.departure,
                           "duration": r.duration} for r in stop_rows],
            "avg_stop_mins": avg_stop_mins, "avg_stop_hm": _minutes_to_hm(avg_stop_mins),
            "passthru_count": sum(1 for r in rows_sorted if r.is_passthrough),
            "total_lm_rows": len(rows_sorted),
        }
    return route_map


def compute_driver_performance_tab(db: Session, start_date: str = "", end_date: str = "", driver: str = "",
                                    drivers: str = "", areas: str = "", division: str = "", route_type: str = "",
                                    vehicle_type: str = "", facility_type: str = "", salesman: str = "",
                                    sap_rows: list | None = None) -> dict:
    """
    Dashboard Filter Improvements (V2 milestone): the SAP side of this tab
    now goes through the same shared dashboard_kpis.build_filtered_sap_query()
    every other tab uses, so the same slicers (Driver, Division, Area,
    Vehicle Type, Facility Type, Salesman, Route Type, Date Range) AND
    Dashboard Configuration exclusions apply here too (previously this
    only accepted start_date/end_date and applied neither the other
    slicers nor config exclusions at all).

    The Landmark GPS side (lm_rows) is intentionally left unfiltered by
    these slicers - LandmarkVisitFact has no division/area/facility/
    salesman columns to filter on, and vehicle_matching.run_matching_engine()
    correlates it against the (now-filtered) SAP rows by vehicle/driver, so
    narrowing lm_rows independently would just break stops from matching
    their SAP orders rather than actually filter anything meaningfully.

    Dashboard Performance (V2 verification pass): accepts a pre-fetched
    `sap_rows` to skip its own query entirely - export_dashboard_workbook()
    fetches once and reuses across all six tabs instead of six separate
    full-table scans (this alone cut Dashboard Excel export from ~12s to
    ~2s on a 50k-row synthetic benchmark - see the audit report).
    """
    if sap_rows is None:
        from app.services.dashboard_kpis import build_filtered_sap_query
        q = build_filtered_sap_query(db, start_date, end_date, driver, drivers, areas, division,
                                      route_type, vehicle_type, facility_type, salesman)
        sap_rows = q.all()
    lm_rows = db.query(LandmarkVisitFact).all()

    match_result = vm.run_matching_engine(db, sap_rows, lm_rows)
    validation_results = vm.run_validation(sap_rows, match_result["match_summary"], match_result["standalone_mode"])

    route_map = _build_lm_route_map_full(lm_rows, match_result["vehicle_match_map"])
    driver_perf = _build_driver_perf(sap_rows)

    routes = list(route_map.values())
    vehicle_set = {r.vehicle_key for r in lm_rows if r.vehicle_key}
    stop_rows_all = [r for r in lm_rows if not r.is_passthrough and not r.is_depot]

    total_stops = len(stop_rows_all)
    avg_stops_per_vehicle = round(total_stops / len(vehicle_set), 1) if vehicle_set else 0
    durations = [r["route_duration"] for r in routes if r["route_duration"] > 0]
    avg_route_hr = round(sum(durations) / len(durations) / 60, 1) if durations else None
    stop_minutes = [r.minutes for r in stop_rows_all if (r.minutes or 0) > 0]
    avg_stop_min = round(sum(stop_minutes) / len(stop_minutes)) if stop_minutes else 0

    kpis = {
        "gps_vehicles": len(vehicle_set), "total_gps_stops": total_stops,
        "avg_stops_per_vehicle": avg_stops_per_vehicle,
        "avg_route_duration_hrs": avg_route_hr, "avg_stop_duration": _minutes_to_hm(avg_stop_min),
        "sap_orders": len(sap_rows), "sap_total_boxes": sum(r.boxes or 0 for r in sap_rows),
    }

    routes_sorted = sorted(routes, key=lambda r: -r["stops"])
    route_cards = []
    for r in routes_sorted:
        sap_orders = None
        if not match_result["standalone_mode"] and r["match_method"] == "vehicle" and r["sap_driver"]:
            d = driver_perf.get(r["sap_driver"])
            if d:
                sap_orders = {"invoices": d["invoices"], "boxes": d["boxes"], "freezer": d["freezer"]}
        route_cards.append({**r, "sap_orders": sap_orders})

    return {
        "standalone_mode": match_result["standalone_mode"],
        "validation_results": validation_results,
        "kpis": kpis,
        "chart_stops": {"labels": [r["display_driver"] for r in routes_sorted], "values": [r["stops"] for r in routes_sorted]},
        "chart_route_hours": {"labels": [r["display_driver"] for r in routes_sorted],
                               "values": [round(r["route_duration"] / 60, 1) if r["route_duration"] > 0 else 0 for r in routes_sorted]},
        "route_cards": route_cards,
    }
