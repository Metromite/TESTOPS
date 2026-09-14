"""
services/diagnostics.py
--------------------------
Direct port of dashboard.html's renderDiagnostics() - a health/summary
panel over the currently imported data: load counts, matching results,
validation summary, facility classification breakdown.

The "Data Relationship Notes" card in V1 included two hardcoded example
lines about specific data points in V1's own test dataset ("Vehicle Number
U65988 confirmed in both files", "GPS Driver 'Yousuf Nobi' partial match
of SAP 'Yousuf Nobi Shakib'") - those were dropped here rather than kept,
since they're specific to V1's test data and would be actively misleading
shown against your real data (which almost certainly doesn't contain that
vehicle/driver). The three general, always-true notes are kept.
"""
from sqlalchemy.orm import Session

from app.models.analytics_facts import SapInvoiceFact, LandmarkVisitFact
from app.services import vehicle_matching as vm

FACILITY_ICONS = {
    "Hospital": "🏥", "Pharmacy": "💊", "Medical clinic": "🩺", "Supermarket": "🛒",
    "Store": "🏪", "Government": "🏛️", "Medical Equip": "🔬", "Medical Lab": "🧪",
    "Dental Clinic": "🦷", "Representative": "📋", "Other": "📦",
}


def compute_diagnostics(db: Session) -> dict:
    sap_rows = db.query(SapInvoiceFact).all()
    lm_rows = db.query(LandmarkVisitFact).all()

    match_result = vm.run_matching_engine(db, sap_rows, lm_rows)
    validation_results = vm.run_validation(sap_rows, match_result["match_summary"], match_result["standalone_mode"])
    sap_vehicle_map = vm.build_vehicle_map(sap_rows)

    fac_counts: dict[str, int] = {}
    for r in sap_rows:
        fac_counts[r.facility_type] = fac_counts.get(r.facility_type, 0) + 1
    facility_breakdown = sorted(
        [{"type": t, "icon": FACILITY_ICONS.get(t, "📦"), "count": c} for t, c in fac_counts.items()],
        key=lambda x: -x["count"],
    )

    match_details = [
        {"vehicle_key": k, "sap_driver": m.get("sap_driver"), "match_method": m.get("match_method")}
        for k, m in match_result["vehicle_match_map"].items()
    ]

    return {
        "data_load_summary": {
            "sap_rows_loaded": len(sap_rows), "sap_unique_vehicles": len(sap_vehicle_map),
            "sap_unique_drivers": len({r.driver_name for r in sap_rows if r.driver_name}),
            "landmark_rows_loaded": len(lm_rows),
            "landmark_vehicle_sections": match_result["match_summary"]["lm_vehicle_count"],
        },
        "matching_results": {
            "standalone_mode": match_result["standalone_mode"],
            "vehicle_matches": match_result["match_summary"]["vehicle_matches"],
            "name_matches": match_result["match_summary"]["name_matches"],
            "no_matches": match_result["match_summary"]["no_matches"],
            "match_details": match_details,
        },
        "validation_results": validation_results,
        "facility_breakdown": facility_breakdown,
        "data_relationship_notes": [
            "SAP Customer Names and GPS Landmark Names are NOT linked - they're different datasets.",
            "GPS Landmark visits are geofence records for ALL nearby landmarks, including non-customers.",
            "Recommended link method between SAP and GPS data: Vehicle Number (most reliable).",
        ],
    }
