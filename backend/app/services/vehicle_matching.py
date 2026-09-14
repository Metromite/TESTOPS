"""
services/vehicle_matching.py
-------------------------------
DIRECT PORT of dashboard.html's vehicle<->driver matching subsystem -
buildVehicleMap(), runMatchingEngine(), and runValidation(). This is the
piece Driver Performance, Driver Mapping Review, and the Diagnostics tab
all depend on, previously left unread rather than guessed at.

Three-tier match, in priority order, unchanged from V1:
  1. Manual override (a person explicitly mapped this vehicle to a driver)
  2. Exact vehicle-key match (same vehicle number appears in both SAP and
     Landmark data for the same row) - "high" confidence
  3. Fuzzy name-token match (Landmark's driver name field, when not
     "Unknown", token-overlaps a SAP driver name by >=2 shared word
     stems) - "medium" confidence
  Otherwise: unmatched - "none" confidence.

STORAGE NOTE: manual overrides are now a persisted Postgres table
(VehicleDriverManualMapping) instead of V1's browser-memory-only object -
see that model's own docstring for why.
"""
from sqlalchemy.orm import Session

from app.models.analytics_facts import SapInvoiceFact, LandmarkVisitFact, VehicleDriverManualMapping


def build_vehicle_map(sap_rows: list[SapInvoiceFact]) -> dict:
    """Direct port of buildVehicleMap() - first driver seen per SAP vehicle key."""
    vmap = {}
    for r in sap_rows:
        if r.vehicle_key and r.driver_name and r.vehicle_key not in vmap:
            vmap[r.vehicle_key] = {
                "driver_name": r.driver_name, "helper_name": r.helper_name,
                "vehicle_num": r.vehicle_num, "vehicle_type": r.vehicle_type,
            }
    return vmap


def _name_tokens(name: str) -> list[str]:
    return [w for w in name.lower().split() if len(w) > 2]


def run_matching_engine(db: Session, sap_rows: list[SapInvoiceFact], lm_rows: list[LandmarkVisitFact]) -> dict:
    """Direct port of runMatchingEngine() - returns vehicle_match_map,
    match_summary, and standalone_mode exactly as V1 computed them."""
    manual = {m.vehicle_key: m.sap_driver for m in db.query(VehicleDriverManualMapping).all()}
    sap_vehicle_map = build_vehicle_map(sap_rows)
    sap_driver_names = list({r.driver_name for r in sap_rows if r.driver_name})
    lm_vehicle_keys = list({r.vehicle_key for r in lm_rows if r.vehicle_key})

    vehicle_match_map = {}
    vehicle_matches = name_matches = no_matches = 0

    for lm_key in lm_vehicle_keys:
        if lm_key in manual:
            vehicle_match_map[lm_key] = {"sap_driver": manual[lm_key], "match_method": "manual", "confidence": "high"}
            vehicle_matches += 1
            continue

        if lm_key in sap_vehicle_map:
            info = sap_vehicle_map[lm_key]
            vehicle_match_map[lm_key] = {
                "sap_driver": info["driver_name"], "helper_name": info["helper_name"],
                "vehicle_num": info["vehicle_num"], "vehicle_type": info["vehicle_type"],
                "match_method": "vehicle", "confidence": "high",
            }
            vehicle_matches += 1
            continue

        lm_drivers_for_vehicle = list({
            r.driver_name for r in lm_rows if r.vehicle_key == lm_key and r.driver_name != "Unknown"
        })

        best_sap_driver, best_score = None, 0.0
        for lm_driver in lm_drivers_for_vehicle:
            lm_words = _name_tokens(lm_driver)
            for sap_driver in sap_driver_names:
                sap_words = sap_driver.lower().split()
                shared = [w for w in lm_words if any(sw.startswith(w) or w.startswith(sw) for sw in sap_words)]
                if len(shared) >= 2:
                    score = len(shared) / max(len(lm_words), len(sap_words))
                    if score > best_score:
                        best_score, best_sap_driver = score, sap_driver

        if best_sap_driver:
            vehicle_match_map[lm_key] = {"sap_driver": best_sap_driver, "match_method": "name", "confidence": "medium"}
            name_matches += 1
        else:
            vehicle_match_map[lm_key] = {"sap_driver": None, "match_method": "none", "confidence": "none"}
            no_matches += 1

    match_summary = {
        "lm_vehicle_count": len(lm_vehicle_keys), "sap_vehicle_count": len(sap_vehicle_map),
        "vehicle_matches": vehicle_matches, "name_matches": name_matches, "no_matches": no_matches,
        "total_lm_rows": len(lm_rows),
    }
    standalone_mode = (len(lm_vehicle_keys) > 0 and vehicle_matches == 0 and name_matches == 0) or \
                       (len(lm_vehicle_keys) == 0 and len(sap_rows) > 0)

    return {"vehicle_match_map": vehicle_match_map, "match_summary": match_summary, "standalone_mode": standalone_mode}


def run_validation(sap_rows: list[SapInvoiceFact], match_summary: dict, standalone_mode: bool) -> list[dict]:
    """Direct port of runValidation()."""
    results = []
    missing_veh = sum(1 for r in sap_rows if not r.vehicle_num or not r.vehicle_key)
    results.append({"level": "warn", "msg": f"{missing_veh} SAP row(s) missing Vehicle Number"} if missing_veh > 0
                    else {"level": "ok", "msg": "All SAP rows have Vehicle Number"})

    veh_driver_map: dict[str, set] = {}
    for r in sap_rows:
        if r.vehicle_key:
            veh_driver_map.setdefault(r.vehicle_key, set()).add(r.driver_name)
    dup_veh = [k for k, v in veh_driver_map.items() if len(v) > 1]
    results.append(
        {"level": "warn", "msg": f"{len(dup_veh)} vehicle(s) have multiple SAP driver names: {', '.join(dup_veh)}"}
        if dup_veh else {"level": "ok", "msg": "No vehicle/driver conflicts in SAP data"}
    )

    if match_summary["lm_vehicle_count"] > 0:
        results.append(
            {"level": "ok", "msg": f"{match_summary['vehicle_matches']} of {match_summary['lm_vehicle_count']} "
                                    f"GPS vehicle(s) matched via Vehicle Number"}
            if match_summary["vehicle_matches"] > 0 else {"level": "warn", "msg": "No GPS vehicles matched via Vehicle Number"}
        )
        if match_summary["name_matches"] > 0:
            results.append({"level": "warn", "msg": f"{match_summary['name_matches']} vehicle(s) matched by driver name only (medium confidence)"})
        if match_summary["no_matches"] > 0:
            results.append({"level": "err", "msg": f"{match_summary['no_matches']} GPS vehicle(s) could not be matched to any SAP record"})

    results.append({"level": "warn", "msg": "GPS landmarks are geofence visits - NOT the same as SAP invoice customers. SAP and GPS analytics are displayed separately."})

    if standalone_mode:
        results.append({"level": "err", "msg": "STANDALONE MODE: Vehicle and driver matching could not be validated. SAP and GPS reports are displayed independently."})

    return results


def apply_manual_mapping(db: Session, vehicle_key: str, sap_driver: str, updated_by: str = ""):
    row = db.get(VehicleDriverManualMapping, vehicle_key)
    if sap_driver:
        if row:
            row.sap_driver = sap_driver
            row.updated_by = updated_by
        else:
            db.add(VehicleDriverManualMapping(vehicle_key=vehicle_key, sap_driver=sap_driver, updated_by=updated_by))
    elif row:
        db.delete(row)
    db.commit()


def compute_driver_mapping_review(db: Session, sap_rows: list[SapInvoiceFact], lm_rows: list[LandmarkVisitFact]) -> dict:
    """Direct port of renderDriverMappingReview() - one row per distinct
    GPS vehicle, showing its current match and a dropdown of every SAP
    driver name to override it with."""
    sap_driver_list = sorted({r.driver_name for r in sap_rows if r.driver_name})
    match_result = run_matching_engine(db, sap_rows, lm_rows)
    vehicle_match_map = match_result["vehicle_match_map"]

    seen = set()
    entries = []
    for lr in lm_rows:
        key = lr.vehicle_key or ""
        if key in seen:
            continue
        seen.add(key)
        match = vehicle_match_map.get(key, {"sap_driver": None, "match_method": "none", "confidence": "none"})
        entries.append({
            "vehicle_key": key, "vehicle_display": lr.vehicle_raw or key,
            "gps_driver_name": lr.driver_name if lr.driver_name and lr.driver_name != "Unknown" else None,
            "current_sap_driver": match.get("sap_driver"), "match_method": match.get("match_method"),
        })

    counts = {"vehicle": 0, "name": 0, "manual": 0, "none": 0}
    for e in entries:
        counts[e["match_method"]] = counts.get(e["match_method"], 0) + 1

    return {"sap_driver_options": sap_driver_list, "entries": entries, "counts": counts}


def reset_all_mappings(db: Session):
    db.query(VehicleDriverManualMapping).delete()
    db.commit()
