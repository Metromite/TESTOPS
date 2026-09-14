"""
models/reference_data.py
---------------------------
Canonical dropdown domains for the Areas + Vehicle Database redesign.
Single source of truth used by:
  - Pydantic schemas (schemas.py) for validation/normalization
  - api/routes/fleet.py's /api/meta/options endpoint (frontend dropdowns)
  - services/route_planner.py (business-rule comparisons)

Vehicle Type and Division are shared between Area and Vehicle - an Area's
vehicle_type must be one of these same values so it genuinely references
the Vehicle Database's type domain rather than being free text.
"""

VEHICLE_TYPES = ["Pick-Up", "Van", "2-8 Van", "2-8 Pick-Up", "Bus"]
DIVISIONS = ["Pharma", "Consumer"]
DIVISION_RESTRICTIONS = ["", "Pharma", "Consumer", "Both"]  # "" and "Both" both mean "no restriction"
REQUIREMENT_LEVELS = ["Mandatory", "Optional"]
ROUTE_TYPES = ["Main Route", "Second Trip", "Urgent & Government", "Fleet", "Cold Chain"]

# Route types that keep the old "Main" priority-scheduling behavior in
# route_planner.py (Main routes get covered first when there's a fleet
# shortage). The old schema only had a binary Main/Replacement split;
# this migration maps that binary split onto the new 4-value domain by
# treating "Main Route" as the sole priority tier and everything else
# (Second Trip / Urgent & Government / Fleet) as non-priority, which
# preserves existing scoring behavior without inventing new priority
# rules the business hasn't specified.
PRIORITY_ROUTE_TYPES = {"Main Route"}

# Best-effort normalization for values that may already exist in the
# database under old spellings/casing (e.g. "VAN", "PICK-UP", "2-8 VAN"),
# so existing rows display correctly against the new canonical dropdown
# instead of showing as an unrecognized value.
_VEHICLE_TYPE_ALIASES = {
    "VAN": "Van", "PICK-UP": "Pick-Up", "PICKUP": "Pick-Up",
    "BUS": "Bus", "2-8 VAN": "2-8 Van", "2-8VAN": "2-8 Van",
    "2-8 PICK-UP": "2-8 Pick-Up", "2-8 PICKUP": "2-8 Pick-Up", "2-8PICK-UP": "2-8 Pick-Up",
}
_ROUTE_TYPE_ALIASES = {
    "MAIN": "Main Route",
    "REPLACEMENT": "Second Trip",  # best-faith mapping - flagged in migration map; please confirm/correct
}
_REQUIREMENT_ALIASES = {"YES": "Mandatory", "NO": "Optional"}


def normalize_vehicle_type(value: str) -> str:
    if not value:
        return "Van"
    return _VEHICLE_TYPE_ALIASES.get(value.strip().upper(), value.strip())


def normalize_route_type(value: str) -> str:
    if not value:
        return "Main Route"
    return _ROUTE_TYPE_ALIASES.get(value.strip().upper(), value.strip())


def normalize_requirement(value: str) -> str:
    if not value:
        return "Optional"
    return _REQUIREMENT_ALIASES.get(value.strip().upper(), value.strip())


def division_permits(vehicle_division: str, area_division: str) -> bool:
    """Empty or 'Both' means unrestricted - usable for any division."""
    vd = (vehicle_division or "").strip()
    if not vd or vd.lower() == "both":
        return True
    return vd.lower() == (area_division or "").strip().lower()
