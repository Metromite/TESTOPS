from datetime import datetime
from pydantic import BaseModel, field_validator

from app.models.reference_data import normalize_vehicle_type, normalize_route_type, normalize_requirement


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "viewer"


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool

    class Config:
        from_attributes = True


class DriverIn(BaseModel):
    code: str
    name: str
    veh_type: str = ""
    anchor_area: str = ""  # legacy free-text anchor field - kept for Excel bulk import/export compatibility
    health_card: str = "No"
    division: str = ""
    preferred_helper: str = ""
    status: str = "Active"
    anchored_area_ids: list[int] = []        # Area DB ids - structured multi-select, replaces manual typing
    anchored_area_group_ids: list[int] = []  # Area Group ids - whole groups, expanded at scoring time


class DriverOut(DriverIn):
    id: int
    anchored_areas: list[dict] = []   # [{"id":.., "code":.., "name":..}] for display, filled in by the route handler
    anchored_groups: list[dict] = []  # [{"id":.., "name":..}] for display

    class Config:
        from_attributes = True


class HelperIn(BaseModel):
    code: str
    name: str
    anchor_area: str = ""
    health_card: str = "No"
    division: str = ""
    status: str = "Active"


class HelperOut(HelperIn):
    id: int

    class Config:
        from_attributes = True


class AreaIn(BaseModel):
    code: str
    name: str
    sector: str = "Pharma"            # Division: Pharma / Consumer
    needs_driver: str = "Mandatory"   # Driver Requirement: Mandatory / Optional
    needs_helper: str = "Optional"    # Helper Requirement: Mandatory / Optional
    route_type: str = "Main Route"    # Main Route / Second Trip / Urgent & Government / Fleet
    vehicle_type: str = "Van"         # Pick-Up / Van / 2-8 Van / Bus - references the Vehicle Database's type domain
    anchored_vehicle_ids: list[int] = []  # Vehicle DB ids - one Area may have 0, 1, or several anchored vehicles

    @field_validator("needs_driver", "needs_helper")
    @classmethod
    def _norm_requirement(cls, v):
        return normalize_requirement(v)

    @field_validator("route_type")
    @classmethod
    def _norm_route_type(cls, v):
        return normalize_route_type(v)

    @field_validator("vehicle_type")
    @classmethod
    def _norm_vehicle_type(cls, v):
        return normalize_vehicle_type(v)


class AreaOut(BaseModel):
    id: int
    code: str
    name: str
    sector: str
    needs_driver: str
    needs_helper: str
    route_type: str
    vehicle_type: str
    anchored_vehicles: list[dict] = []  # [{"id":.., "number":.., "type":..}] for display, filled in by the route handler

    class Config:
        from_attributes = True


class VehicleIn(BaseModel):
    number: str
    type: str = "Van"          # Pick-Up / Van / 2-8 Van / 2-8 Pick-Up / Bus - dropdown only, managed from the Vehicle Database
    division: str = ""         # Pharma / Consumer / Both / "" (unrestricted) - optional Division Restriction
    status: str = "Active"
    permitted_area_ids: list[int] = []        # Area DB ids - empty (with no groups either) means no restriction
    permitted_area_group_ids: list[int] = []  # Area Group ids - whole groups, expanded wherever permitted areas are checked

    @field_validator("type")
    @classmethod
    def _norm_type(cls, v):
        return normalize_vehicle_type(v)


class VehicleOut(BaseModel):
    id: int
    number: str
    type: str
    division: str
    status: str
    permitted_areas: list[dict] = []        # [{"id":.., "code":.., "name":..}] for display
    permitted_area_groups: list[dict] = []  # [{"id":.., "name":..}] for display
    permitted_area_ids: list[int] = []
    permitted_area_group_ids: list[int] = []

    class Config:
        from_attributes = True


class AreaGroupIn(BaseModel):
    name: str
    area_ids: list[int] = []


class AreaGroupOut(BaseModel):
    id: int
    name: str
    areas: list[dict] = []  # [{"id":.., "code":.., "name":.., "sector":..}]

    class Config:
        from_attributes = True


class VacationIn(BaseModel):
    person_code: str
    person_name: str = ""
    person_type: str = "Driver"  # "Driver" / "Helper"
    start_date: str
    end_date: str


class VacationOut(VacationIn):
    id: int

    class Config:
        from_attributes = True


class RoutePlanRequest(BaseModel):
    target_date: str  # YYYY-MM-DD


class RankedCandidate(BaseModel):
    code: str
    name: str
    score: int
    reason: str
    vac_status: str | None = None


class ReasonBreakdownRow(BaseModel):
    factor: str
    points: int | None = None


class AreaPlanResult(BaseModel):
    area_code: str
    area_name: str
    sector: str
    route_type: str = "Main Route"
    required_vehicle: str
    ranked_drivers: list[RankedCandidate]
    ranked_helpers: list[RankedCandidate] = []
    top_driver_breakdown: list[ReasonBreakdownRow] = []
    top_helper_breakdown: list[ReasonBreakdownRow] = []


class RoutePlanResponse(BaseModel):
    fleet_errors: list[str]
    areas: list[AreaPlanResult]


class ReplacementForecastRow(BaseModel):
    area_code: str
    area_name: str
    role: str
    current_person_code: str
    current_person_name: str
    vacation_start_date: str
    days_until_vacation: int
    replacement_code: str | None = None
    replacement_name: str | None = None
    replacement_score: int | None = None
    no_replacement_available: bool


class RouteAssignmentOut(BaseModel):
    id: int
    plan_role: str
    area_code: str
    area_name: str
    sector: str
    route_type: str
    driver_requirement: str
    helper_requirement: str
    driver_code: str
    driver_name: str
    helper_code: str
    helper_name: str
    vehicle_number: str
    vehicle_type: str
    anchored_vehicle_number: str
    vehicle_assignment_reason: str
    start_date: str
    end_date: str
    driver_score: int
    driver_reason: str
    helper_score: int
    helper_reason: str
    assignment_reason: str
    restrictions_considered: str
    is_vacation_replacement: bool
    original_person_code: str
    original_person_name: str
    vacation_start_date: str
    vacation_end_date: str
    vacation_replacement_reason: str
    is_manually_edited: bool
    status: str

    class Config:
        from_attributes = True


class RouteAssignmentEdit(BaseModel):
    """Manual edit of a persisted Route Plan row - every field the spec
    lists as editable (Driver/Helper/Vehicle/Vehicle Type/Division/Area/
    Route Type/Dates/Requirement). Only the fields actually provided are
    changed; the row is flagged is_manually_edited so future regenerations
    of this role preserve it exactly (see route_planner.generate_route_plan)."""
    driver_code: str | None = None
    driver_name: str | None = None
    helper_code: str | None = None
    helper_name: str | None = None
    vehicle_number: str | None = None
    vehicle_type: str | None = None
    sector: str | None = None
    area_code: str | None = None
    area_name: str | None = None
    route_type: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    driver_requirement: str | None = None
    helper_requirement: str | None = None
    status: str | None = None


class DashboardKPIs(BaseModel):
    total_drivers: int
    total_helpers: int
    total_vehicles: int
    total_areas: int
    drivers_on_vacation_today: int
    open_route_assignments: int
    generated_at: datetime
