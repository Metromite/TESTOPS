"""
services/route_planner.py
---------------------------
DIRECT PORT of V1's route-planning engine from app.py (functions
build_experience_cache, build_vacation_cache, is_on_vacation,
vacation_within_3_months, validate_experience, calculate_candidate_score,
check_route_requirements - originally ~lines 1420-1630 of app.py).

PORTING RULE FOLLOWED: business logic is preserved exactly - same scoring
constants, same bonus/penalty values, same exclusion rules, same
pharma/consumer health-card handling. The only things that changed are:
  - pandas DataFrame reads -> SQLAlchemy queries against Postgres
  - Streamlit session state -> plain function arguments / return values

This is the single highest-priority module per the user's explicit
instruction not to redesign the route planning logic. If any scoring
constant below looks wrong, it should be checked against V1's app.py
directly rather than "improved" here.
"""
from datetime import datetime, timedelta
from typing import Optional
import re

from sqlalchemy.orm import Session

from app.models.fleet import Driver, Helper, Vehicle, Area, Vacation, ExperienceHistory

# ---------------------------------------------------------------------------
# Text/date normalization - direct port of unify_text / parse_date_safe
# ---------------------------------------------------------------------------

def unify_text(val) -> str:
    if val is None:
        return ""
    val = str(val).strip()
    if val.lower() in ("nan", "none", "nat", "null", ""):
        return ""
    import re
    if re.search(r"2\s*-\s*8", val, flags=re.IGNORECASE):
        return "2-8 VAN"
    up = val.upper()
    if up == "PHARMA":
        return "Pharma"
    if up == "CONSUMER":
        return "Consumer"
    if up == "BUS":
        return "BUS"
    if up in ("PICK-UP", "PICK UP"):
        return "PICK-UP"
    if up == "VAN":
        return "VAN"
    return val


def parse_date_safe(d_str) -> str:
    if d_str is None:
        return ""
    if isinstance(d_str, datetime):
        return d_str.strftime("%Y-%m-%d")
    d_str = str(d_str).strip().split(" ")[0]
    if d_str.lower() in ("none", "nan", "nat", ""):
        return ""
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(d_str, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return d_str


# ---------------------------------------------------------------------------
# Caches - direct port of build_experience_cache / build_vacation_cache
# ---------------------------------------------------------------------------

def build_experience_cache(db: Session) -> dict:
    """
    Returns { code: {'areas': {area_name: last_end_date_str},
                      'sectors': {sector_name: last_end_date_str}} }
    exactly matching V1's exp_cache shape, so calculate_candidate_score
    below is unmodified.

    Division Detection (V2 milestone): ALSO folds in DriverDailyDivision
    records (the per-day Consumer-vs-Pharma-invoice-count comparison - see
    services/division_detection.py) into the same `sectors` dict, using
    the identical "most recent date wins" merge already used for
    ExperienceHistory.sector below. This is a genuinely more granular
    signal (real per-day counts vs. one Division Description per whole
    imported dispatch batch), so it can only sharpen exp_cache, never
    contradict it structurally - calculate_candidate_score keeps reading
    this dict exactly as before.
    """
    exp_cache: dict = {}
    for r in db.query(ExperienceHistory).all():
        code = r.person_code
        area = unify_text(r.area)
        sector = unify_text(r.sector or "Pharma")
        end_date = parse_date_safe(r.end_date or r.date)
        if not end_date:
            continue
        if code not in exp_cache:
            exp_cache[code] = {"areas": {}, "sectors": {}}
        if area not in exp_cache[code]["areas"] or end_date > exp_cache[code]["areas"][area]:
            exp_cache[code]["areas"][area] = end_date
        if sector not in exp_cache[code]["sectors"] or end_date > exp_cache[code]["sectors"][sector]:
            exp_cache[code]["sectors"][sector] = end_date

    from app.models.salesman import DriverDailyDivision
    for d in db.query(DriverDailyDivision).all():
        code = d.person_code
        sector = unify_text(d.division or "Pharma")
        end_date = parse_date_safe(d.work_date)
        if not end_date:
            continue
        if code not in exp_cache:
            exp_cache[code] = {"areas": {}, "sectors": {}}
        if sector not in exp_cache[code]["sectors"] or end_date > exp_cache[code]["sectors"][sector]:
            exp_cache[code]["sectors"][sector] = end_date

    return exp_cache


def build_vacation_cache(db: Session) -> dict:
    """Returns { code: [(start_date_str, end_date_str), ...] }, matching V1 exactly."""
    vac_cache: dict = {}
    for r in db.query(Vacation).all():
        code = r.person_code
        vac_cache.setdefault(code, [])
        s_val = parse_date_safe(r.start_date)
        e_val = parse_date_safe(r.end_date)
        if s_val and e_val:
            vac_cache[code].append((s_val, e_val))
    return vac_cache


def is_on_vacation(person_code: str, target_date: datetime, vac_cache: dict) -> bool:
    target_str = target_date.strftime("%Y-%m-%d")
    for start, end in vac_cache.get(person_code, []):
        if start <= target_str <= end:
            return True
    return False


def vacation_within_3_months(person_code: str, target_date: datetime, vac_cache: dict) -> Optional[str]:
    limit_date = (target_date + timedelta(days=90)).strftime("%Y-%m-%d")
    target_str = target_date.strftime("%Y-%m-%d")
    for start, end in vac_cache.get(person_code, []):
        if target_str < start <= limit_date:
            return parse_date_safe(start)
    return None


def get_vac_status(code: str, vac_cache: dict, today_date: datetime) -> str:
    today_str = today_date.strftime("%Y-%m-%d")
    vacs = vac_cache.get(code, [])
    if not vacs:
        return "Never"
    for s, e in vacs:
        if s <= today_str <= e:
            days_left = (datetime.strptime(e, "%Y-%m-%d").date() - today_date.date()).days
            return f"On leave ({days_left} days left)"
    past_vacs = sorted([e for s, e in vacs if e < today_str], reverse=True)
    if past_vacs:
        days_since = (today_date.date() - datetime.strptime(past_vacs[0], "%Y-%m-%d").date()).days
        return f"Back ({days_since} days ago)"
    future_vacs = sorted([s for s, e in vacs if s > today_str])
    if future_vacs:
        days_until = (datetime.strptime(future_vacs[0], "%Y-%m-%d").date() - today_date.date()).days
        return f"Upcoming (in {days_until} days)"
    return "Never"


# ---------------------------------------------------------------------------
# Overlap validation - direct port of validate_experience
# ---------------------------------------------------------------------------

def validate_experience(role: str, code: str, area: str, start_dt: str, end_dt: str,
                         db: Session, pending_dicts: list[dict]) -> tuple[bool, str]:
    try:
        s1 = datetime.strptime(start_dt, "%Y-%m-%d")
        e1 = datetime.strptime(end_dt, "%Y-%m-%d")
        if (e1 - s1).days + 1 < 14:
            return False, "Duration less than 14 days"

        rows = db.query(ExperienceHistory).filter(
            ExperienceHistory.person_type == role,
            ExperienceHistory.area == area,
        ).all()
        for r in rows:
            try:
                s2 = datetime.strptime(r.date, "%Y-%m-%d")
                e2 = datetime.strptime(r.end_date, "%Y-%m-%d")
                if s1 <= e2 and s2 <= e1:
                    return False, f"Overlap with {r.person_name} ({s2:%Y-%m-%d} to {e2:%Y-%m-%d})"
            except Exception:
                pass

        for p in pending_dicts:
            if p.get("person_type") == role and p.get("area") == area:
                try:
                    s2 = datetime.strptime(p["date"], "%Y-%m-%d")
                    e2 = datetime.strptime(p["end_date"], "%Y-%m-%d")
                    if s1 <= e2 and s2 <= e1:
                        return False, f"Overlap with pending assignment ({p.get('person_name')})"
                except Exception:
                    pass
        return True, "Valid"
    except Exception:
        return False, "Invalid Date Format"


# ---------------------------------------------------------------------------
# Scoring engine - direct port of calculate_candidate_score, INCLUDING the
# exact bonus/penalty constants from V1. Do not change these numbers without
# checking with the business owner first - they encode real dispatch policy
# (anchor-area strictness, pharma/consumer health-card rules, rotation-via-
# recency-penalty, etc.), not arbitrary tuning.
# ---------------------------------------------------------------------------

NEVER_WORKED_BONUS = 10000
NEVER_WORKED_SECTOR_BONUS = 8000
ANCHOR_MATCH_BONUS = 50000
MONTHS_WEIGHT = 100
SECTOR_MONTHS_WEIGHT = 50
RECENT_AREA_PENALTY = -3000
VACATION_SOON_PENALTY = -1500


def calculate_candidate_score(candidate: dict, area: dict, req_veh: str, req_sector: str,
                               target_date: datetime, exp_cache: dict, vac_cache: dict,
                               role: str = "Driver", hc_assigned: int = 0) -> tuple[Optional[int], str]:
    code = candidate["code"]
    score = 0
    reasons: list[str] = []
    target_str = target_date.strftime("%Y-%m-%d")

    if is_on_vacation(code, target_date, vac_cache):
        return None, "Excluded: On Vacation"

    if role == "Driver":
        p_veh = unify_text(candidate.get("veh_type", ""))
        if p_veh and p_veh not in (req_veh, "") and not (
            p_veh == "VAN / PICK-UP" and req_veh in ("VAN", "PICK-UP")
        ):
            return None, f"Excluded: Vehicle Mismatch ({p_veh} != {req_veh})"

    anchors = [unify_text(a).upper() for a in str(candidate.get("anchor_area", "")).split(",") if a.strip()]
    anchors = [a for a in anchors if a not in ("NONE", "")]

    if anchors:
        a_code = unify_text(area.get("code", ""))
        check_list = [
            unify_text(area["name"]).upper(),
            unify_text(req_sector).upper(),
            unify_text(req_veh).upper(),
            a_code.upper(),
        ]
        matched = any(any(anc in chk or chk in anc for chk in check_list) for anc in anchors)
        if matched:
            score += ANCHOR_MATCH_BONUS
            reasons.append(f"Anchor Match (+{ANCHOR_MATCH_BONUS})")
        else:
            return None, f"Excluded: Anchored strictly to {', '.join(anchors)}"

    last_worked_area = exp_cache.get(code, {}).get("areas", {}).get(unify_text(area["name"]))
    if not last_worked_area:
        score += NEVER_WORKED_BONUS
        reasons.append(f"Never worked Area (+{NEVER_WORKED_BONUS})")
    else:
        months_since = (
            datetime.strptime(target_str, "%Y-%m-%d") - datetime.strptime(last_worked_area, "%Y-%m-%d")
        ).days / 30.0
        if months_since < 3:
            score += RECENT_AREA_PENALTY
            reasons.append(f"Recent Area Visit <3m ({RECENT_AREA_PENALTY})")
        else:
            time_score = int(months_since * MONTHS_WEIGHT)
            score += time_score
            reasons.append(f"{months_since:.1f}m since area (+{time_score})")

    last_worked_sector = exp_cache.get(code, {}).get("sectors", {}).get(req_sector)
    if not last_worked_sector:
        score += NEVER_WORKED_SECTOR_BONUS
        reasons.append(f"Never worked {req_sector} Sector (+{NEVER_WORKED_SECTOR_BONUS})")
    else:
        months_since_sec = (
            datetime.strptime(target_str, "%Y-%m-%d") - datetime.strptime(last_worked_sector, "%Y-%m-%d")
        ).days / 30.0
        time_score_sec = int(months_since_sec * SECTOR_MONTHS_WEIGHT)
        score += time_score_sec
        reasons.append(f"{months_since_sec:.1f}m since {req_sector} Sector (+{time_score_sec})")

    vac_start = vacation_within_3_months(code, target_date, vac_cache)
    if vac_start:
        score += VACATION_SOON_PENALTY
        reasons.append(f"Vacation soon ({VACATION_SOON_PENALTY})")

    if "Consumer" in unify_text(req_sector):
        if candidate.get("health_card") == "Yes":
            if hc_assigned < 3:
                score += 5000
                reasons.append("Required HC for Consumer (+5000)")
            else:
                score += 500
                reasons.append("HC in Consumer (+500)")
        else:
            if hc_assigned < 3:
                score -= 2000
                reasons.append("Non-HC Penalty (-2000)")
    else:
        if candidate.get("health_card") == "Yes":
            if hc_assigned < 3:
                score -= 3000
                reasons.append("Reserved HC for Consumer (-3000)")
            else:
                score -= 200
                reasons.append("Saved HC (-200)")

    return score, " | ".join(reasons)


# ---------------------------------------------------------------------------
# Fleet requirement check - direct port of check_route_requirements
# ---------------------------------------------------------------------------

def check_route_requirements(db: Session, vac_cache: dict, today_date: datetime) -> list[str]:
    """
    Direct port of V1's check_route_requirements, extended with Main vs
    Replacement priority: when there's a fleet shortage, Main routes should
    be covered first and Replacement routes are the ones that go
    understaffed, per your explicit priority rule. This computes each
    vehicle type's requirement split by route_type, and reports the
    shortage in priority order rather than one undifferentiated total.
    """
    errors: list[str] = []
    req_veh_main = {"VAN": 0, "PICK-UP": 0, "BUS": 0, "2-8 VAN": 0}
    req_veh_replacement = {"VAN": 0, "PICK-UP": 0, "BUS": 0, "2-8 VAN": 0}

    for area in db.query(Area).all():
        if area.needs_driver == "Optional":
            continue
        sec = unify_text(area.sector)
        name = unify_text(area.name)
        if "2-8" in sec or "COLD CHAIN" in name.upper():
            key = "2-8 VAN"
        elif "Govt" in sec or "GOVT" in name.upper():
            key = "BUS"
        elif "Pick-Up" in sec or "PICK UP" in name.upper():
            key = "PICK-UP"
        else:
            key = "VAN"
        bucket = req_veh_main if area.route_type == "Main Route" else req_veh_replacement
        bucket[key] += 1

    avail_veh = {"VAN": 0, "PICK-UP": 0, "BUS": 0, "2-8 VAN": 0}
    for v in db.query(Vehicle).all():
        status = (v.status or "Active")
        if "under service" in status.lower() or "in for service" in status.lower():
            continue
        vtype = unify_text(v.type)
        if vtype in avail_veh:
            avail_veh[vtype] += 1
        elif vtype == "VAN / PICK-UP":
            avail_veh["VAN"] += 1
            avail_veh["PICK-UP"] += 1

    for vtype in req_veh_main:
        main_req = req_veh_main[vtype]
        total_req = main_req + req_veh_replacement[vtype]
        have = avail_veh[vtype]
        if have < main_req:
            errors.append(
                f"URGENT - Missing {vtype} Vehicles for MAIN routes: need {main_req}, "
                f"only have {have} active. Even Main routes are short."
            )
        elif have < total_req:
            short = total_req - have
            errors.append(
                f"Missing {vtype} Vehicles: {short} Replacement route(s) will go uncovered "
                f"(Main routes are fully covered - {main_req} needed, {have} available; "
                f"shortage is absorbed by lower-priority Replacement routes as designed)."
            )

    strict_d_req_main = db.query(Area).filter(Area.needs_driver == "Mandatory", Area.route_type == "Main Route").count()
    strict_d_req_total = db.query(Area).filter(Area.needs_driver == "Mandatory").count()
    avail_d = sum(
        1 for d in db.query(Driver).all() if not is_on_vacation(d.code, today_date, vac_cache)
    )
    if avail_d < strict_d_req_main:
        errors.append(
            f"URGENT - Missing Drivers for MAIN routes: need {strict_d_req_main}, only have {avail_d}."
        )
    elif avail_d < strict_d_req_total:
        errors.append(
            f"Missing Drivers: {strict_d_req_total - avail_d} Replacement route(s) will go "
            f"uncovered (Main routes are fully covered)."
        )
    return errors


# ---------------------------------------------------------------------------
# Orchestration - NEW glue code (not in V1 as a single function; V1 built
# this up interactively inside the Streamlit page). This wraps the ported
# functions above into one callable the API layer can invoke, without
# changing any of the scoring/exclusion logic itself.
# ---------------------------------------------------------------------------

def _parse_reason_breakdown(reason: str) -> list[dict]:
    """Splits a candidate's pipe-separated reason string (e.g. 'Anchor
    Match (+50000) | Never worked Area (+10000)') into individual
    factor/points rows, for the "why this suggestion" breakdown table."""
    if not reason:
        return []
    parts = []
    for chunk in reason.split(" | "):
        m = re.match(r"^(.*?)\s*\(([+-]?\d+)\)\s*$", chunk.strip())
        if m:
            parts.append({"factor": m.group(1).strip(), "points": int(m.group(2))})
        else:
            parts.append({"factor": chunk.strip(), "points": None})
    return parts


def _driver_anchor_extra_map(db: Session) -> dict[int, str]:
    """
    Area Groups / Driver Anchoring milestone: bulk-resolves each Driver's
    structured Anchored Areas (individual Areas + expanded Area Groups,
    from DriverAnchoredArea / DriverAnchoredAreaGroup) into extra
    comma-separated tokens, keyed by driver_id.

    This is merged onto the legacy free-text `anchor_area` column (see
    _merge_anchor_area below) when building scoring candidates - it
    EXTENDS calculate_candidate_score's existing strict-anchor matching
    without changing that function at all: it just sees a longer
    comma-separated list, exactly like today's manually-typed
    "JA, MIRDIF" free text. Per the milestone spec ("Do NOT replace the
    scoring engine. Only extend it."), this is deliberately the only
    integration point.
    """
    from app.models.area_groups import DriverAnchoredArea, DriverAnchoredAreaGroup, AreaGroupMember

    result: dict[int, set[str]] = {}
    for driver_id, code, name in (
        db.query(DriverAnchoredArea.driver_id, Area.code, Area.name)
        .join(Area, Area.id == DriverAnchoredArea.area_id).all()
    ):
        result.setdefault(driver_id, set()).update({code, name})
    for driver_id, code, name in (
        db.query(DriverAnchoredAreaGroup.driver_id, Area.code, Area.name)
        .join(AreaGroupMember, AreaGroupMember.group_id == DriverAnchoredAreaGroup.group_id)
        .join(Area, Area.id == AreaGroupMember.area_id).all()
    ):
        result.setdefault(driver_id, set()).update({code, name})
    return {did: ",".join(sorted(toks)) for did, toks in result.items()}


def _merge_anchor_area(legacy: str, extra: str) -> str:
    """Combines the legacy free-text anchor_area value with the
    structured-anchoring tokens into one comma-separated string, deduped
    case-insensitively, preserving order (legacy first)."""
    parts = [p.strip() for p in (legacy or "").split(",") if p.strip()]
    parts += [p.strip() for p in (extra or "").split(",") if p.strip()]
    seen: set[str] = set()
    out: list[str] = []
    for p in parts:
        if p.upper() not in seen:
            seen.add(p.upper())
            out.append(p)
    return ",".join(out)


def generate_route_plan_candidates(db: Session, target_date: datetime) -> dict:
    """
    Runs the ported engine for every area needing a driver (and helper,
    where the area calls for one), returning ranked candidates per
    area/role plus a parsed breakdown of why the top candidate scored the
    way it did. This does NOT auto-commit assignments - matching V1's flow
    of "review scored candidates, then confirm" rather than silently
    auto-assigning.
    """
    exp_cache = build_experience_cache(db)
    vac_cache = build_vacation_cache(db)
    today = datetime.utcnow()

    fleet_errors = check_route_requirements(db, vac_cache, today)

    # ITEM 12 ROOT CAUSE (Route Planner showing fewer Areas than Fleet
    # Database - "only 29"):
    #
    # This query used to be `db.query(Area).filter(Area.needs_driver ==
    # "Mandatory")`. `needs_driver` only ever holds "Mandatory" or
    # "Optional" (see models/fleet.py's Area.needs_driver comment) - there
    # is no third "doesn't need a driver at all" value - so that filter
    # silently dropped every single Area whose driver requirement is
    # merely "Optional", even though this function's own docstring says
    # it covers "every area needing a driver (and helper, where the area
    # calls for one)". It also never looked at `needs_helper` at all, so
    # an area that's Optional-driver but Mandatory-helper was dropped
    # entirely from Candidate Review with no candidates shown for it.
    #
    # Meanwhile Fleet Database's own area listing (api/routes/fleet.py,
    # `query = db.query(Area)`) and the actual plan generator used for
    # Driver/Helper Route Plan (generate_route_plan below, `all_areas =
    # db.query(Area).all()`, which then splits into mandatory_areas/
    # optional_areas itself) both start from the FULL, unfiltered Area
    # table. Candidate Review was the one place quietly using a narrower
    # source than everywhere else in the app.
    #
    # Fix: use the same full Area source as Fleet Database and as
    # generate_route_plan. Nothing in the ranking/eligibility logic below
    # needs to change - `_rank_candidates_for_area` (and the "no
    # candidates" empty state already rendered by RoutePlanner.tsx) still
    # apply per-area/per-role the same way; this only restores the areas
    # that were being filtered out before candidates were ever computed
    # for them.
    areas = db.query(Area).all()
    # Main routes get first pick when reviewing candidates - Replacement
    # routes are the ones that should go understaffed first if there's a
    # shortage, per your explicit priority rule.
    areas = sorted(areas, key=lambda a: 0 if a.route_type == "Main Route" else 1)
    driver_anchor_extra = _driver_anchor_extra_map(db)
    drivers = [
        {"code": d.code, "name": d.name, "veh_type": d.veh_type,
         "anchor_area": _merge_anchor_area(d.anchor_area, driver_anchor_extra.get(d.id, "")),
         "health_card": d.health_card}
        for d in db.query(Driver).filter(Driver.status == "Active").all()
    ]
    helpers = [
        {"code": h.code, "name": h.name, "veh_type": "", "anchor_area": h.anchor_area, "health_card": h.health_card}
        for h in db.query(Helper).filter(Helper.status == "Active").all()
    ]

    results = []
    for area in areas:
        area_dict = {"code": area.code, "name": area.name}
        req_sector = unify_text(area.sector)
        if "2-8" in req_sector or "COLD CHAIN" in area.name.upper():
            req_veh = "2-8 VAN"
        elif "Govt" in req_sector or "GOVT" in area.name.upper():
            req_veh = "BUS"
        elif "Pick-Up" in req_sector or "PICK UP" in area.name.upper():
            req_veh = "PICK-UP"
        else:
            req_veh = "VAN"

        scored = []
        hc_assigned = 0
        for cand in drivers:
            score, reason = calculate_candidate_score(
                cand, area_dict, req_veh, req_sector, target_date, exp_cache, vac_cache, role="Driver",
                hc_assigned=hc_assigned,
            )
            if score is not None:
                scored.append({"code": cand["code"], "name": cand["name"], "score": score, "reason": reason})
        scored.sort(key=lambda x: x["score"], reverse=True)

        scored_helpers = []
        if area.needs_helper == "Mandatory":
            hc_assigned_h = 0
            for cand in helpers:
                score, reason = calculate_candidate_score(
                    cand, area_dict, req_veh, req_sector, target_date, exp_cache, vac_cache, role="Helper",
                    hc_assigned=hc_assigned_h,
                )
                if score is not None:
                    scored_helpers.append({"code": cand["code"], "name": cand["name"], "score": score, "reason": reason})
            scored_helpers.sort(key=lambda x: x["score"], reverse=True)

        results.append({
            "area_code": area.code,
            "area_name": area.name,
            "sector": req_sector,
            "route_type": area.route_type,
            "required_vehicle": req_veh,
            "ranked_drivers": scored[:5],  # top 5 candidates for review, not auto-assignment
            "ranked_helpers": scored_helpers[:5] if area.needs_helper == "Mandatory" else [],
            "top_driver_breakdown": _parse_reason_breakdown(scored[0]["reason"]) if scored else [],
            "top_helper_breakdown": _parse_reason_breakdown(scored_helpers[0]["reason"]) if scored_helpers else [],
        })

    return {"fleet_errors": fleet_errors, "areas": results}


def compute_replacement_forecast(db: Session, target_date: datetime) -> list[dict]:
    """
    For every area, the top-ranked candidate is effectively "assigned" to
    that route today. This checks whether that person has an upcoming
    vacation (within the same 90-day window vacation_within_3_months
    already uses) and, if so, surfaces the next-ranked eligible candidate
    as the replacement - so a Dispatcher can see who needs covering and
    exactly when, before it becomes an urgent same-day scramble.
    """
    plan = generate_route_plan_candidates(db, target_date)
    vac_cache = build_vacation_cache(db)
    forecast = []

    for area in plan["areas"]:
        for role, ranked in (("Driver", area["ranked_drivers"]), ("Helper", area["ranked_helpers"])):
            if not ranked:
                continue
            top = ranked[0]
            vac_start = vacation_within_3_months(top["code"], target_date, vac_cache)
            if not vac_start:
                continue
            days_until = (datetime.strptime(vac_start, "%Y-%m-%d") - target_date).days
            replacement = ranked[1] if len(ranked) > 1 else None
            forecast.append({
                "area_code": area["area_code"], "area_name": area["area_name"], "role": role,
                "current_person_code": top["code"], "current_person_name": top["name"],
                "vacation_start_date": vac_start, "days_until_vacation": days_until,
                "replacement_code": replacement["code"] if replacement else None,
                "replacement_name": replacement["name"] if replacement else None,
                "replacement_score": replacement["score"] if replacement else None,
                "no_replacement_available": replacement is None,
            })

    return sorted(forecast, key=lambda f: f["days_until_vacation"])


# NOTE (V2 verification pass - duplicate logic removal): build_route_plan_sheet()
# was removed here - it reshaped generate_route_plan_candidates() output into
# an old grouped-section preview layout, and its only caller (GET "/sheet" in
# api/routes/route_plan.py) was also removed as dead code, confirmed by
# searching the whole frontend for any remaining reference. The real,
# persisted, always-in-sync Route Plan Sheet is get_combined_route_plan_sheet()
# below (GET /route-plan/combined-sheet) - keeping both around would have
# reintroduced exactly the "two overlapping route plan sheets" duplication
# problem RoutePlanSheet.tsx's own comment already documents fixing once.


# ---------------------------------------------------------------------------
# ROUND 3 - Route Planning split + assignment/vacation/anchored-vehicle
# logic (persisted, editable, independent Driver/Helper plans).
#
# EXTENDS everything above rather than replacing it: still uses
# calculate_candidate_score/check_route_requirements/build_experience_cache/
# build_vacation_cache exactly as they are. This section is purely the
# orchestration layer that (a) persists a chosen candidate instead of just
# returning a ranked list for review, (b) keeps assignments stable across
# regenerations unless there's a real reason to change, (c) splits a plan
# into vacation-driven segments, and (d) picks a vehicle (anchored first,
# then Permitted-Areas-aware fallback).
# ---------------------------------------------------------------------------
import uuid as _uuid
from app.models.fleet import AreaAnchoredVehicle, VehiclePermittedArea
from app.models.route_plan import RouteAssignment
from app.models import reference_data as _ref


def _plan_window(start_date_str: str) -> tuple[str, str]:
    start_dt = datetime.strptime(start_date_str, "%Y-%m-%d")
    end_dt = start_dt + timedelta(days=90)  # "3-month" plan window, per spec
    return start_dt.strftime("%Y-%m-%d"), end_dt.strftime("%Y-%m-%d")


def select_vehicle_for_area(db, area: Area, used_vehicle_numbers: set[str]) -> tuple[str, str]:
    """
    ANCHORED VEHICLE ROUTE LOGIC + PERMITTED AREAS integration.
    Step 1: try the area's anchored vehicle(s), in the order configured.
    Step 2: if unavailable, pick a compatible vehicle - preferring ones
    whose Permitted Areas include this area and whose Division restriction
    (if any) allows this area's division - and record why the anchored
    vehicle wasn't used. Returns (vehicle_number, reason).
    """
    req_type = unify_text(area.vehicle_type)
    area_division = unify_text(area.sector)

    anchored_rows = (
        db.query(Vehicle)
        .join(AreaAnchoredVehicle, AreaAnchoredVehicle.vehicle_id == Vehicle.id)
        .filter(AreaAnchoredVehicle.area_id == area.id)
        .all()
    )
    for v in anchored_rows:
        if v.number in used_vehicle_numbers:
            continue
        status = (v.status or "Active").lower()
        if "under service" in status or "in for service" in status:
            continue
        return v.number, "Anchored vehicle assigned"

    unavailable_reason = (
        "Anchored vehicle unavailable because: " + (
            "already assigned to another area in this plan"
            if anchored_rows else "no anchored vehicle configured for this area"
        )
    )

    # Step 2 - compatible fallback, preferring Permitted-Areas matches.
    candidates = db.query(Vehicle).filter(Vehicle.number.notin_(used_vehicle_numbers) if used_vehicle_numbers else True).all()
    compatible = []
    for v in candidates:
        status = (v.status or "Active").lower()
        if "under service" in status or "in for service" in status:
            continue
        if unify_text(v.type) != req_type:
            continue
        if not _ref.division_permits(v.division, area_division):
            continue
        compatible.append(v)

    if not compatible:
        return "", f"{unavailable_reason}; SHORTAGE - no compatible {req_type} vehicle available (manual override needed)"

    permitted_ids = {
        row.vehicle_id for row in db.query(VehiclePermittedArea.vehicle_id)
        .filter(VehiclePermittedArea.area_id == area.id).all()
    }
    # Area Groups milestone: a vehicle permitted via a whole Area Group
    # counts the same as an individual Permitted Area match - expand
    # group membership at read time rather than duplicating rows, so
    # editing a group later automatically applies everywhere it's used.
    from app.models.area_groups import VehiclePermittedAreaGroup, AreaGroupMember
    permitted_ids |= {
        row.vehicle_id for row in db.query(VehiclePermittedAreaGroup.vehicle_id)
        .join(AreaGroupMember, AreaGroupMember.group_id == VehiclePermittedAreaGroup.group_id)
        .filter(AreaGroupMember.area_id == area.id).all()
    }
    preferred = [v for v in compatible if v.id in permitted_ids]
    if preferred:
        chosen = sorted(preferred, key=lambda v: v.number)[0]
        return chosen.number, f"{unavailable_reason}; assigned {chosen.number} (Permitted Area match, {req_type})"

    # No permitted-area-restricted vehicle matches, but compatible
    # unrestricted vehicles exist - use one, flagged for dispatcher review
    # per spec ("display a warning... while still allowing manual override").
    chosen = sorted(compatible, key=lambda v: v.number)[0]
    return chosen.number, (
        f"{unavailable_reason}; no vehicle has this Area in its Permitted Areas - "
        f"assigned nearest compatible {req_type} vehicle ({chosen.number}); please verify or override manually"
    )


def _rank_candidates_for_area(db, role: str, area: Area, target_date: datetime,
                               exp_cache: dict, vac_cache: dict, pool: list[dict]) -> list[dict]:
    area_dict = {"code": area.code, "name": area.name}
    req_veh = unify_text(area.vehicle_type)
    req_sector = unify_text(area.sector)
    scored = []
    for cand in pool:
        score, reason = calculate_candidate_score(
            cand, area_dict, req_veh, req_sector, target_date, exp_cache, vac_cache, role=role,
        )
        if score is not None:
            scored.append({"code": cand["code"], "name": cand["name"], "score": score, "reason": reason})
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored


def _get_current_batch_id(db, plan_role: str) -> Optional[str]:
    row = (
        db.query(RouteAssignment.plan_batch_id)
        .filter(RouteAssignment.plan_role == plan_role)
        .order_by(RouteAssignment.created_at.desc())
        .first()
    )
    return row[0] if row else None


def _current_role_rows(db, plan_role: str) -> list[RouteAssignment]:
    batch_id = _get_current_batch_id(db, plan_role)
    if not batch_id:
        return []
    return (
        db.query(RouteAssignment)
        .filter(RouteAssignment.plan_role == plan_role, RouteAssignment.plan_batch_id == batch_id)
        .all()
    )


def get_combined_route_plan_sheet(db) -> list[dict]:
    """
    ROUTE PLANNER INTEGRATION FIX: the Route Plan Sheet is one row per area
    combining BOTH the current Driver plan and current Helper plan - even
    though they're generated and persisted completely independently (per
    the earlier "generating one must never overwrite the other" rule).
    This function only MERGES them for display/export; it never writes
    anything back, so the two plans stay genuinely independent underneath.

    CRITICAL CORRECTION PASS item 9/12/13/14 ROOT CAUSE ("37 areas become
    29" on the Route Plan Sheet specifically - Candidate Review/Route
    Planner's own "37 area" bug was already fixed separately above): this
    used to build its area list from `set(driver_rows) | set(helper_rows)`
    - i.e. only areas that happen to already have a row in the MOST
    RECENTLY GENERATED persisted batch for at least one role. Area
    Database is the actual source of truth (see build_filtered_sap_query's
    equivalent rule for drivers/areas elsewhere in the app) - so an area
    added to Area Database *after* the last "Generate Route Plan" run has
    zero persisted rows in either batch and, with the old set-union logic,
    had no way to ever appear on this sheet until someone re-ran
    generation - it just silently vanished from view with no error and no
    indication regeneration was needed. That is exactly how a 37-area
    Area Database produces a 29-row sheet: the other 8 were added after
    the last generation.

    Fix: start from the full, current Area Database (db.query(Area).all())
    - not from whatever happens to already be persisted - and mark any
    area with no persisted row for either role as "Pending Generation"
    rather than dropping it. Nothing in the merge logic for areas that DO
    have persisted rows changes.

    Vehicle Number: since vehicle selection runs independently within each
    role's generation, the Driver row and Helper row for the same area can
    end up with different assigned vehicles. This is flagged rather than
    silently resolved by an invented rule: the Driver row's vehicle is
    shown (a route's vehicle is conventionally "owned" by the driver
    assignment), and if only a Helper row exists for that area (Helper
    Mandatory but Driver Optional/unassigned), the Helper row's vehicle is
    used instead.

    Vacation-segmented areas (an area whose person has a mid-window vacation
    has up to 3 rows in that role's own batch - original/replacement/
    returned) collapse to whichever segment happens to be last in the query
    result here, since a single combined-sheet row can't show a timeline.
    The full segment-by-segment detail is still visible in the Driver/
    Helper Route Plan tabs (PersistedPlanPanel) - this sheet is deliberately
    the "at a glance, right now" operational view, not the full timeline.
    """
    driver_rows = {r.area_code: r for r in _current_role_rows(db, "driver")}
    helper_rows = {r.area_code: r for r in _current_role_rows(db, "helper")}
    all_areas = db.query(Area).all()
    next_sort_order = (max([r.sort_order for r in list(driver_rows.values()) + list(helper_rows.values())], default=-1)) + 1

    combined = []
    for area in all_areas:
        area_code = area.code
        d, h = driver_rows.get(area_code), helper_rows.get(area_code)
        if d is None and h is None:
            # item 9/10/14: an area that simply hasn't been through a
            # plan generation yet is NOT the same thing as "no room for
            # it" - it must still appear, clearly marked, rather than
            # being silently absent from the sheet.
            combined.append({
                "area_code": area_code,
                "area_name": area.name,
                "sector": area.sector,
                "route_type": area.route_type,
                "driver_code": "", "driver_name": "",
                "helper_code": "", "helper_name": "",
                "vehicle_type": area.vehicle_type,
                "vehicle_number": "",
                "assignment_reason": "Pending Generation - this area exists in Area Database but hasn't been "
                                      "included in a Driver or Helper Route Plan generation yet. Run Generate "
                                      "Route Plan for the relevant role(s) to assign it.",
                "score": 0,
                "status": "Pending Generation",
                "sort_order": next_sort_order,
                "driver_row_id": None,
                "helper_row_id": None,
            })
            next_sort_order += 1
            continue
        primary = d or h
        combined.append({
            "area_code": area_code,
            "area_name": primary.area_name,
            "sector": primary.sector,
            "route_type": primary.route_type,
            "driver_code": d.driver_code if d else "",
            "driver_name": d.driver_name if d else "",
            "helper_code": h.helper_code if h else "",
            "helper_name": h.helper_name if h else "",
            "vehicle_type": (d or h).vehicle_type,
            "vehicle_number": (d.vehicle_number if d and d.vehicle_number else (h.vehicle_number if h else "")),
            "assignment_reason": "; ".join(filter(None, [
                f"Driver: {d.assignment_reason}" if d else "",
                f"Helper: {h.assignment_reason}" if h else "",
            ])) or "No assignment generated yet for this area",
            "score": d.driver_score if d else (h.helper_score if h else 0),
            "status": (d.status if d else "") or (h.status if h else "") or "Pending",
            "sort_order": (d.sort_order if d else None) if d is not None else (h.sort_order if h else 0),
            "driver_row_id": d.id if d else None,
            "helper_row_id": h.id if h else None,
        })

    combined.sort(key=lambda r: r["sort_order"])
    for i, row in enumerate(combined, start=1):
        row["sn"] = i

    # Explicit regression guard for the "37 areas become 29" class of bug
    # (see the root-cause note above): Area Database is the single source
    # of truth for this sheet's row count, by construction, everywhere
    # above - this assertion doesn't compute anything new, it just makes
    # that invariant loud and immediate (a 500 with a clear message) if a
    # future change ever reintroduces a narrower area source, instead of
    # silently shipping a sheet with fewer rows than the Area Database
    # again. Deliberately NOT a hardcoded number - `len(all_areas)` is
    # whatever Area Database currently contains (37 today; correctly
    # becomes 38, 40, etc. as areas are added, with no code change here).
    assert len(combined) == len(all_areas), (
        f"Route Plan Sheet row count ({len(combined)}) does not match the Area Database "
        f"area count ({len(all_areas)}) - every Area Database area must appear on this sheet, "
        f"even unstaffed ones (as 'Pending Generation'/'Shortage'). This indicates a regression "
        f"in get_combined_route_plan_sheet's area sourcing, not a data problem."
    )
    return combined


def reorder_route_plan_sheet(db, area_codes_in_order: list[str]) -> None:
    """
    ROUTE PLAN SHEET REARRANGEMENT: persists a dispatcher's manual row
    order. Applies the SAME sort_order to both the Driver-plan row and
    the Helper-plan row for a given area (if both exist), so the combined
    sheet's ordering stays consistent no matter which independent plan
    you're looking at individually.
    """
    for i, area_code in enumerate(area_codes_in_order):
        db.query(RouteAssignment).filter(RouteAssignment.area_code == area_code).update(
            {"sort_order": i}, synchronize_session=False,
        )
    db.commit()


def generate_route_plan(db, plan_role: str, start_date_str: str, created_by: str = "") -> dict:
    """
    Generates (and PERSISTS) an independent Driver or Helper 3-month Route
    Plan. Only replaces the previous batch for THIS role - generating the
    Driver plan never touches Helper rows and vice versa, per your explicit
    "Helpers stay with the previous driver assignments for ~1 month" rule.

    Assignment order (STEP 1-3 from your spec): Mandatory areas for this
    role first, then Optional areas using only whatever candidates weren't
    already used for Mandatory areas - Optional never displaces Mandatory.

    Stability: if the previous batch already had a valid (still-active,
    not-on-vacation-at-window-start) person for an area and that row wasn't
    manually edited to something incompatible, keep them and say so. Manual
    edits from the previous batch are always carried forward unchanged.

    Vacation replacement: only the FIRST vacation inside the plan window is
    modeled as a 3-way split (original -> replacement -> original returns);
    a person with two separate vacations inside one 90-day window is a rare
    edge case flagged in a comment rather than silently guessed at.
    """
    if plan_role not in ("driver", "helper"):
        raise ValueError("plan_role must be 'driver' or 'helper'")

    window_start, window_end = _plan_window(start_date_str)
    target_date = datetime.strptime(start_date_str, "%Y-%m-%d")
    exp_cache = build_experience_cache(db)
    vac_cache = build_vacation_cache(db)

    req_field = Area.needs_driver if plan_role == "driver" else Area.needs_helper  # noqa: F841 (kept for readability/reference)
    model_cls = Driver if plan_role == "driver" else Helper
    driver_anchor_extra = _driver_anchor_extra_map(db) if model_cls is Driver else {}
    people = [
        {"code": p.code, "name": p.name, "veh_type": getattr(p, "veh_type", ""),
         "anchor_area": _merge_anchor_area(p.anchor_area, driver_anchor_extra.get(p.id, "")),
         "health_card": p.health_card, "status": p.status}
        for p in db.query(model_cls).all()
    ]
    active_people = [p for p in people if (p.get("status") or "Active") == "Active"]
    people_by_code = {p["code"]: p for p in people}

    prev_batch_id = _get_current_batch_id(db, plan_role)
    prev_rows_by_area = {}
    if prev_batch_id:
        for row in db.query(RouteAssignment).filter(
            RouteAssignment.plan_batch_id == prev_batch_id, RouteAssignment.plan_role == plan_role,
        ).all():
            prev_rows_by_area.setdefault(row.area_code, []).append(row)

    all_areas = db.query(Area).all()
    mandatory_areas = [a for a in all_areas if unify_text(getattr(a, "needs_driver" if plan_role == "driver" else "needs_helper")) == "Mandatory"]
    optional_areas = [a for a in all_areas if unify_text(getattr(a, "needs_driver" if plan_role == "driver" else "needs_helper")) == "Optional"]
    for group in (mandatory_areas, optional_areas):
        group.sort(key=lambda a: 0 if a.route_type == "Main Route" else 1)

    used_person_codes: set[str] = set()
    used_vehicle_numbers: set[str] = set()
    new_rows: list[RouteAssignment] = []
    new_batch_id = str(_uuid.uuid4())

    def build_rows_for_area(area: Area, requirement_level: str) -> list[RouteAssignment]:
        prior = prev_rows_by_area.get(area.code, [])
        prior_manual = [r for r in prior if r.is_manually_edited]
        if prior_manual:
            # Manual edits are sticky - carried forward exactly as-is,
            # regardless of scoring, per "nothing should disappear /
            # changes must be saved permanently" from your spec.
            rows = []
            for r in prior_manual:
                used_person_codes.add(r.driver_code if plan_role == "driver" else r.helper_code)
                if r.vehicle_number:
                    used_vehicle_numbers.add(r.vehicle_number)
                rows.append(RouteAssignment(
                    plan_batch_id=new_batch_id, plan_role=plan_role,
                    area_code=area.code, area_name=area.name, sector=area.sector,
                    route_type=area.route_type, driver_requirement=area.needs_driver, helper_requirement=area.needs_helper,
                    driver_code=r.driver_code, driver_name=r.driver_name,
                    helper_code=r.helper_code, helper_name=r.helper_name,
                    vehicle_number=r.vehicle_number, vehicle_type=area.vehicle_type,
                    anchored_vehicle_number=r.anchored_vehicle_number,
                    vehicle_assignment_reason=r.vehicle_assignment_reason,
                    start_date=window_start, end_date=window_end,
                    driver_score=r.driver_score, driver_reason=r.driver_reason,
                    helper_score=r.helper_score, helper_reason=r.helper_reason,
                    assignment_reason="Manually set by dispatcher - preserved across regeneration",
                    restrictions_considered=r.restrictions_considered,
                    is_manually_edited=True, status="Confirmed", created_by=created_by,
                ))
            return rows

        pool = [p for p in active_people if p["code"] not in used_person_codes]
        ranked = _rank_candidates_for_area(db, plan_role.capitalize(), area, target_date, exp_cache, vac_cache, pool)
        if not ranked:
            return [RouteAssignment(
                plan_batch_id=new_batch_id, plan_role=plan_role,
                area_code=area.code, area_name=area.name, sector=area.sector,
                route_type=area.route_type, driver_requirement=area.needs_driver, helper_requirement=area.needs_helper,
                start_date=window_start, end_date=window_end,
                assignment_reason=f"SHORTAGE - no eligible {plan_role} available for this {requirement_level.lower()} area",
                vehicle_type=area.vehicle_type, status="Shortage", created_by=created_by,
            )]

        top = ranked[0]
        # Stability check: keep the same person as last generation if
        # they're still a valid top-ish candidate and nothing forces a
        # change (they were removed, went inactive, or are now on vacation
        # for the window's start date - all already excluded from `pool`
        # naturally by being filtered out of active_people/vac_cache).
        prev_auto = next((r for r in prior if not r.is_manually_edited), None)
        prev_code = (prev_auto.driver_code if plan_role == "driver" else prev_auto.helper_code) if prev_auto else None
        chosen = top
        reason_prefix = ""
        if prev_code and prev_code in people_by_code and prev_code not in used_person_codes:
            still_ranked = next((c for c in ranked if c["code"] == prev_code), None)
            if still_ranked:
                chosen = still_ranked
                reason_prefix = "Kept - no change needed (stable across regeneration). "
        if not reason_prefix:
            if prev_code and prev_code not in people_by_code:
                reason_prefix = "Changed - previous assignee no longer exists in the system. "
            elif prev_code:
                reason_prefix = "Changed - previous assignee unavailable this period (vacation/inactive/reassigned). "
            else:
                reason_prefix = "New assignment. "

        used_person_codes.add(chosen["code"])
        veh_number, veh_reason = select_vehicle_for_area(db, area, used_vehicle_numbers)
        if veh_number:
            used_vehicle_numbers.add(veh_number)
        anchored_number = next((v.number for v in db.query(Vehicle).join(
            AreaAnchoredVehicle, AreaAnchoredVehicle.vehicle_id == Vehicle.id
        ).filter(AreaAnchoredVehicle.area_id == area.id).all()), "")

        base_kwargs = dict(
            plan_batch_id=new_batch_id, plan_role=plan_role,
            area_code=area.code, area_name=area.name, sector=area.sector,
            route_type=area.route_type, driver_requirement=area.needs_driver, helper_requirement=area.needs_helper,
            vehicle_number=veh_number, vehicle_type=area.vehicle_type,
            anchored_vehicle_number=anchored_number, vehicle_assignment_reason=veh_reason,
            restrictions_considered=chosen["reason"], status="Confirmed" if veh_number else "Shortage",
            created_by=created_by,
        )
        if plan_role == "driver":
            base_kwargs.update(driver_code=chosen["code"], driver_name=chosen["name"],
                                driver_score=chosen["score"], driver_reason=chosen["reason"])
        else:
            base_kwargs.update(helper_code=chosen["code"], helper_name=chosen["name"],
                                helper_score=chosen["score"], helper_reason=chosen["reason"])

        # VACATION REPLACEMENT LOGIC: does this chosen person have a vacation
        # starting inside the plan window? If so, split into segments rather
        # than replacing them for the whole 3 months (per your explicit rule
        # that replacement only happens from the actual vacation start date).
        vac_segment = next(
            (seg for seg in vac_cache.get(chosen["code"], []) if window_start <= seg[0] <= window_end), None,
        )
        if not vac_segment:
            return [RouteAssignment(start_date=window_start, end_date=window_end,
                                     assignment_reason=reason_prefix.strip(), **base_kwargs)]

        vac_start, vac_end = vac_segment
        rows = []
        if window_start < vac_start:
            rows.append(RouteAssignment(start_date=window_start, end_date=vac_start,
                                         assignment_reason=reason_prefix.strip(), **base_kwargs))
        # Replacement segment - pick the next best candidate not already used.
        replacement_pool = [p for p in pool if p["code"] != chosen["code"]]
        replacement_ranked = _rank_candidates_for_area(
            db, plan_role.capitalize(), area, datetime.strptime(vac_start, "%Y-%m-%d"), exp_cache, vac_cache, replacement_pool,
        )
        replacement = replacement_ranked[0] if replacement_ranked else None
        rep_kwargs = dict(base_kwargs)
        rep_kwargs["vehicle_assignment_reason"] = veh_reason  # same vehicle logic; a real fleet may reassign a vehicle too, kept simple/stable here
        if replacement:
            used_person_codes.add(replacement["code"])
            if plan_role == "driver":
                rep_kwargs.update(driver_code=replacement["code"], driver_name=replacement["name"],
                                   driver_score=replacement["score"], driver_reason=replacement["reason"])
            else:
                rep_kwargs.update(helper_code=replacement["code"], helper_name=replacement["name"],
                                   helper_score=replacement["score"], helper_reason=replacement["reason"])
            rows.append(RouteAssignment(
                start_date=vac_start, end_date=vac_end,
                assignment_reason=f"Vacation replacement for {chosen['name']} ({chosen['code']})",
                is_vacation_replacement=True, original_person_code=chosen["code"], original_person_name=chosen["name"],
                vacation_start_date=vac_start, vacation_end_date=vac_end,
                vacation_replacement_reason=f"{chosen['name']} on vacation {vac_start} to {vac_end} - "
                                             f"{replacement['name']} assigned from Optional/available pool by existing scoring",
                **rep_kwargs,
            ))
        else:
            rows.append(RouteAssignment(
                start_date=vac_start, end_date=vac_end,
                assignment_reason=f"SHORTAGE during vacation - no available replacement for {chosen['name']}",
                is_vacation_replacement=True, original_person_code=chosen["code"], original_person_name=chosen["name"],
                vacation_start_date=vac_start, vacation_end_date=vac_end,
                vacation_replacement_reason="No eligible replacement found in the available pool",
                status="Shortage", **{k: v for k, v in base_kwargs.items() if k not in ("driver_code", "driver_name", "driver_score", "driver_reason", "helper_code", "helper_name", "helper_score", "helper_reason")},
            ))
        if vac_end < window_end:
            rows.append(RouteAssignment(
                start_date=vac_end, end_date=window_end,
                assignment_reason=f"{chosen['name']} returned from vacation - reassigned to original area per existing rules",
                **base_kwargs,
            ))
        return rows

    for area in mandatory_areas:
        new_rows.extend(build_rows_for_area(area, "Mandatory"))
    for area in optional_areas:
        new_rows.extend(build_rows_for_area(area, "Optional"))

    # ROUTE PLAN SHEET REARRANGEMENT: preserve the dispatcher's manual row
    # order across regenerations, same stability principle as everything
    # else in this function - only brand-new areas (never in the previous
    # batch) get appended at the end with a fresh incremental sort_order.
    prior_sort_order = {
        area_code: rows[0].sort_order for area_code, rows in prev_rows_by_area.items() if rows
    }
    next_order = (max(prior_sort_order.values(), default=-1)) + 1
    for row in new_rows:
        if row.area_code in prior_sort_order:
            row.sort_order = prior_sort_order[row.area_code]
        else:
            row.sort_order = next_order
            next_order += 1

    # Only now (after successfully building the new plan in memory) do we
    # touch the DB - replace this role's previous batch, never the other
    # role's rows, and never anything until generation actually succeeded.
    if prev_batch_id:
        db.query(RouteAssignment).filter(
            RouteAssignment.plan_role == plan_role, RouteAssignment.plan_batch_id == prev_batch_id,
        ).delete()
    db.add_all(new_rows)
    db.commit()

    return {
        "plan_role": plan_role, "batch_id": new_batch_id,
        "window_start": window_start, "window_end": window_end,
        "areas_planned": len(mandatory_areas) + len(optional_areas),
        "rows_created": len(new_rows),
        "shortages": sum(1 for r in new_rows if r.status == "Shortage"),
    }


# ---------------------------------------------------------------------------
# ROUTE PLAN SHEET COLUMN CUSTOMIZATION - persisted permanently (Postgres,
# not localStorage) so drag-reordered/hidden/resized columns survive
# refresh, closing the browser, and restarting the server. Singleton row,
# same pattern as AppearanceConfig (models/appearance.py).
# ---------------------------------------------------------------------------

# Requested default order - keep this the single source of truth; the
# frontend fetches it via GET /route-plan/sheet-layout instead of hardcoding
# its own copy, so backend and frontend can never drift apart.
DEFAULT_SHEET_COLUMNS = [
    {"key": "sn", "label": "S/N", "width": 60},
    {"key": "sector", "label": "Division", "width": 100},
    {"key": "driver_code", "label": "Driver Code", "width": 110},
    {"key": "driver_name", "label": "Driver Name", "width": 150},
    {"key": "area_name", "label": "Area", "width": 150},
    {"key": "helper_code", "label": "Helper Code", "width": 110},
    {"key": "helper_name", "label": "Helper Name", "width": 150},
    {"key": "vehicle_type", "label": "Vehicle Type", "width": 110},
    {"key": "vehicle_number", "label": "Vehicle Number", "width": 130},
    {"key": "route_type", "label": "Route Type", "width": 140},
    {"key": "assignment_reason", "label": "Assignment Reason", "width": 340},
    {"key": "score", "label": "Score", "width": 80},
]
DEFAULT_COLUMN_ORDER = [c["key"] for c in DEFAULT_SHEET_COLUMNS]
DEFAULT_COLUMN_WIDTHS = {c["key"]: c["width"] for c in DEFAULT_SHEET_COLUMNS}
COLUMN_LABELS = {c["key"]: c["label"] for c in DEFAULT_SHEET_COLUMNS}
VALID_COLUMN_KEYS = set(DEFAULT_COLUMN_ORDER)


def _default_sheet_layout() -> dict:
    return {
        "columns": [dict(c) for c in DEFAULT_SHEET_COLUMNS],
        "column_order": list(DEFAULT_COLUMN_ORDER),
        "hidden_columns": [],
        "column_widths": dict(DEFAULT_COLUMN_WIDTHS),
        "is_default": True,
    }


def get_sheet_layout(db) -> dict:
    """Returns the saved column layout, defensively merged against the
    known column set - if a column key was renamed/removed since the
    layout was last saved it's simply dropped, and any new column key
    that wasn't in the saved layout gets appended at the end so newly
    added columns don't silently vanish from the sheet."""
    import json
    from app.models.sheet_layout import RouteSheetLayout

    row = db.get(RouteSheetLayout, 1)
    if not row or not row.column_order:
        return _default_sheet_layout()

    try:
        saved_order = [k for k in json.loads(row.column_order) if k in VALID_COLUMN_KEYS]
    except Exception:
        saved_order = []
    for key in DEFAULT_COLUMN_ORDER:
        if key not in saved_order:
            saved_order.append(key)  # newly-added column - append, don't drop

    try:
        hidden = [k for k in json.loads(row.hidden_columns or "[]") if k in VALID_COLUMN_KEYS]
    except Exception:
        hidden = []

    try:
        saved_widths = json.loads(row.column_widths or "{}")
    except Exception:
        saved_widths = {}
    widths = dict(DEFAULT_COLUMN_WIDTHS)
    widths.update({k: v for k, v in saved_widths.items() if k in VALID_COLUMN_KEYS})

    columns = [{"key": k, "label": COLUMN_LABELS[k], "width": widths[k]} for k in saved_order]
    return {
        "columns": columns, "column_order": saved_order,
        "hidden_columns": hidden, "column_widths": widths, "is_default": False,
    }


def save_sheet_layout(db, column_order: list[str], hidden_columns: list[str],
                       column_widths: dict, updated_by: str = "") -> dict:
    import json
    from app.models.sheet_layout import RouteSheetLayout

    clean_order = [k for k in column_order if k in VALID_COLUMN_KEYS]
    for key in DEFAULT_COLUMN_ORDER:  # never lose a column that wasn't included
        if key not in clean_order:
            clean_order.append(key)
    clean_hidden = [k for k in hidden_columns if k in VALID_COLUMN_KEYS]
    clean_widths = {k: int(v) for k, v in column_widths.items() if k in VALID_COLUMN_KEYS and v}

    row = db.get(RouteSheetLayout, 1)
    if not row:
        row = RouteSheetLayout(id=1)
        db.add(row)
    row.column_order = json.dumps(clean_order)
    row.hidden_columns = json.dumps(clean_hidden)
    row.column_widths = json.dumps(clean_widths)
    row.updated_by = updated_by
    db.commit()
    return get_sheet_layout(db)
