"""
services/identity_engine.py
------------------------------
DIRECT PORT of V1's identity_engine.py. Every function below keeps the
same name, same thresholds (FUZZY_AUTO_THRESHOLD, FUZZY_REVIEW_THRESHOLD,
STINT_GAP_GRACE_DAYS), and the same three-way resolution logic (exact /
alias / review) - nothing about the matching rules has changed.

What DID change, mechanically: V1 passed pandas DataFrames for
drivers_df/helpers_df/history_df (loaded from SQLite once per Streamlit
run); V2 queries Postgres directly since there's no more single-process
DataFrame cache. Every place V1 did `master_df.iterrows()` now iterates a
SQLAlchemy query result instead - same comparisons, same fuzzy-match
loop, different data source.
"""
import re
from collections import defaultdict
from datetime import datetime

from sqlalchemy.orm import Session

try:
    from rapidfuzz import fuzz
    _HAS_RAPIDFUZZ = True
except ImportError:
    import difflib
    _HAS_RAPIDFUZZ = False

from app.models.fleet import Driver, Helper, ExperienceHistory

FUZZY_AUTO_THRESHOLD = 90
FUZZY_REVIEW_THRESHOLD = 70
STINT_GAP_GRACE_DAYS = 21

REQUIRED_SAP_COLUMNS = [
    'Dispatch Number', 'Dispatch Date', 'Driver Code', 'Driver Name',
    'Helper Code', 'Helper Name', 'Vehicle Number', 'Location Code',
]


def normalize_name(name) -> str:
    if name is None:
        return ""
    s = re.sub(r'\s+', ' ', str(name).strip())
    return s.upper()


def normalize_vehicle(v) -> str:
    if v is None:
        return ""
    return re.sub(r'[^A-Z0-9]', '', str(v).strip().upper())


def is_driver_code(code) -> bool:
    if code is None:
        return False
    c = str(code).strip().upper()
    return c.startswith('D') and len(c) > 1 and c[1:].strip() != ""


def is_helper_code(code) -> bool:
    if code is None:
        return False
    c = str(code).strip().upper()
    return c.startswith('H') and len(c) > 1 and c[1:].strip() != ""


def _fuzzy_ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if _HAS_RAPIDFUZZ:
        return fuzz.token_sort_ratio(a, b)
    return difflib.SequenceMatcher(None, a, b).ratio() * 100


def parse_date_safe(val):
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d")
    s = str(val).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------------------
# Step 1: parse a raw SAP EXPORT dataframe into per-dispatch, per-role records
# (unchanged from V1 - still takes a pandas DataFrame, since that's just the
# shape an uploaded Excel/CSV file naturally parses into; this only replaces
# the DOWNSTREAM master-data lookups with Postgres)
# ---------------------------------------------------------------------------

def parse_sap_export(df):
    missing = [c for c in REQUIRED_SAP_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(
            f"This doesn't look like a standard SAP EXPORT Dispatch Summary file "
            f"- missing expected columns: {missing}"
        )

    agg = {
        'Dispatch Date': 'first',
        'Driver Code': 'first', 'Driver Name': 'first',
        'Helper Code': 'first', 'Helper Name': 'first',
        'Vehicle Number': 'first', 'Location Code': 'first',
    }
    if 'Division Description' in df.columns:
        agg['Division Description'] = lambda s: next(
            (x for x in s if x is not None and str(x).strip()), ""
        )

    dispatches = df.groupby('Dispatch Number', as_index=False).agg(agg)

    records = []
    for _, row in dispatches.iterrows():
        date_val = parse_date_safe(row.get('Dispatch Date'))
        if not date_val:
            continue
        area = str(row.get('Location Code', '') or '').strip()
        if not area:
            continue
        vehicle = normalize_vehicle(row.get('Vehicle Number', ''))
        sector = str(row.get('Division Description', '') or '').strip() or "Pharma"
        dispatch_no = row.get('Dispatch Number')

        d_code = str(row.get('Driver Code', '') or '').strip()
        if is_driver_code(d_code):
            records.append({
                "role": "Driver", "code": d_code.upper(), "name": row.get('Driver Name', ''),
                "area": area, "vehicle": vehicle, "sector": sector,
                "date": date_val, "dispatch_number": dispatch_no,
            })
        h_code = str(row.get('Helper Code', '') or '').strip()
        if is_helper_code(h_code):
            records.append({
                "role": "Helper", "code": h_code.upper(), "name": row.get('Helper Name', ''),
                "area": area, "vehicle": vehicle, "sector": sector,
                "date": date_val, "dispatch_number": dispatch_no,
            })
    return records


# ---------------------------------------------------------------------------
# Step 2: identity matching - master_df replaced with a live DB query
# ---------------------------------------------------------------------------

def match_identity(code: str, name: str, role: str, db: Session) -> dict:
    code_n = str(code).strip().upper()
    name_n = normalize_name(name)

    model = Driver if role == "Driver" else Helper
    hit = db.query(model).filter(model.code == code_n).first()
    if hit:
        same_name = normalize_name(hit.name) == name_n
        return {
            "status": "exact", "matched_code": hit.code, "matched_name": hit.name,
            "confidence": 100.0,
            "reason": ("Exact code match." if same_name else
                       f"Code matches master exactly; SAP spelled the name "
                       f"'{name}' but master name '{hit.name}' is kept."),
        }

    best_score, best_row = -1.0, None
    for r in db.query(model).all():
        score = _fuzzy_ratio(name_n, normalize_name(r.name))
        if score > best_score:
            best_score, best_row = score, r

    if best_row is not None and best_score >= FUZZY_AUTO_THRESHOLD:
        return {
            "status": "alias", "matched_code": best_row.code, "matched_name": best_row.name,
            "confidence": round(best_score, 1),
            "reason": (f"New code '{code_n}' isn't in master, but the name is a "
                       f"{round(best_score, 1)}% match for existing {role.lower()} "
                       f"'{best_row.name}' ({best_row.code}). Recorded as an alias code for that person."),
        }

    reason = f"Code '{code_n}' not found in master."
    if best_row is not None and best_score >= FUZZY_REVIEW_THRESHOLD:
        reason += f" Closest name match is '{best_row.name}' at only {round(best_score, 1)}% - too uncertain to auto-merge."
    else:
        reason += " No close name match found - likely a new person."
    return {
        "status": "review",
        "matched_code": best_row.code if best_row else None,
        "matched_name": best_row.name if best_row else None,
        "confidence": round(best_score, 1) if best_row else 0.0,
        "reason": reason,
    }


# ---------------------------------------------------------------------------
# Step 3: build stint updates/inserts for experience_history
# ---------------------------------------------------------------------------

def build_stint_updates(records: list[dict], db: Session):
    grouped = defaultdict(list)
    for r in records:
        grouped[(r['role'], r['code'], r['area'])].append(r)

    updates, inserts = [], []
    for (role, code, area), rows in grouped.items():
        dates = sorted(r['date'] for r in rows)
        batch_start, batch_end = dates[0], dates[-1]
        name = rows[-1]['name']
        sector = rows[-1]['sector']
        vehicle_number = rows[-1]['vehicle']

        existing = (
            db.query(ExperienceHistory)
            .filter(
                ExperienceHistory.person_type == role,
                ExperienceHistory.person_code == code,
                ExperienceHistory.area == area,
            )
            .all()
        )
        candidate = None
        best_end = None
        for e in existing:
            try:
                end_dt = datetime.strptime(e.end_date, "%Y-%m-%d")
            except (ValueError, TypeError):
                continue
            if best_end is None or end_dt > best_end:
                best_end, candidate = end_dt, e

        if candidate is not None:
            gap_days = (datetime.strptime(batch_start, "%Y-%m-%d") - best_end).days
            if -3 <= gap_days <= STINT_GAP_GRACE_DAYS:
                new_end = max(candidate.end_date, batch_end)
                if new_end != candidate.end_date or vehicle_number != candidate.vehicle_number:
                    updates.append({"id": candidate.id, "new_end_date": new_end, "person_code": code,
                                     "person_name": name, "area": area, "new_vehicle_number": vehicle_number})
                continue

        inserts.append({
            "person_type": role, "person_code": code, "person_name": name,
            "area": area, "sector": sector, "date": batch_start, "end_date": batch_end,
            "vehicle_number": vehicle_number,
        })
    return updates, inserts


# ---------------------------------------------------------------------------
# Orchestrator - identical shape to V1's process_sap_export, DB-backed
# ---------------------------------------------------------------------------

def process_sap_export(df, db: Session) -> dict:
    records = parse_sap_export(df)
    resolved, review_items = [], []

    for r in records:
        match = match_identity(r['code'], r['name'], r['role'], db)
        if match['status'] in ('exact', 'alias'):
            rr = dict(r)
            rr['sap_code'] = r['code']
            rr['code'] = match['matched_code']
            rr['name'] = match['matched_name']
            rr['match_status'] = match['status']
            rr['match_reason'] = match['reason']
            resolved.append(rr)
        else:
            review_items.append({
                "role": r['role'], "sap_code": r['code'], "sap_name": r['name'],
                "area": r['area'], "date": r['date'], "vehicle": r['vehicle'],
                "confidence": match['confidence'], "reason": match['reason'],
                "suggested_code": match['matched_code'], "suggested_name": match['matched_name'],
            })

    updates, inserts = build_stint_updates(resolved, db)

    stats = {
        "dispatch_rows_parsed": len({r['dispatch_number'] for r in records}),
        "driver_rows": sum(1 for r in records if r['role'] == 'Driver'),
        "helper_rows": sum(1 for r in records if r['role'] == 'Helper'),
        "auto_exact": sum(1 for r in resolved if r['match_status'] == 'exact'),
        "auto_alias": sum(1 for r in resolved if r['match_status'] == 'alias'),
        "needs_review": len(review_items),
        "history_updates": len(updates),
        "history_inserts": len(inserts),
    }
    return {"auto_updates": updates, "auto_inserts": inserts, "review_items": review_items,
            "stats": stats, "raw_records": records}


def apply_stint_changes(db: Session, updates: list[dict], inserts: list[dict]):
    """NEW glue (V1's caller/app.py did the actual writes inline). Applies
    the plan produced by process_sap_export - still nothing here decides
    the business rules, it just performs the INSERT/UPDATE the plan says to."""
    for u in updates:
        row = db.get(ExperienceHistory, u["id"])
        if row:
            row.end_date = u["new_end_date"]
            if u.get("new_vehicle_number"):
                row.vehicle_number = u["new_vehicle_number"]
    for ins in inserts:
        db.add(ExperienceHistory(**ins))
    db.commit()


def dedupe_review_items(review_items: list[dict]) -> list[dict]:
    grouped = {}
    for it in review_items:
        key = (it['role'], it['sap_code'], normalize_name(it['sap_name']))
        if key not in grouped:
            grouped[key] = {
                "role": it['role'], "sap_code": it['sap_code'], "sap_name": it['sap_name'],
                "confidence": it['confidence'], "reason": it['reason'],
                "suggested_code": it['suggested_code'], "suggested_name": it['suggested_name'],
                "affected_rows": [],
            }
        grouped[key]["affected_rows"].append({"area": it['area'], "date": it['date'], "vehicle": it['vehicle']})

    cards = []
    for card in grouped.values():
        dates = [r['date'] for r in card['affected_rows']]
        card['row_count'] = len(card['affected_rows'])
        card['date_min'] = min(dates)
        card['date_max'] = max(dates)
        cards.append(card)
    return sorted(cards, key=lambda c: (c['role'], c['sap_code']))
