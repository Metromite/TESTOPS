"""
services/correlation_engine.py
--------------------------------
DIRECT PORT of V1's visit_correlation_engine.py. Every scoring constant,
every threshold (CONFIDENCE_REVIEW_THRESHOLD, MIN_PAIR_SCORE_TO_ALIGN,
ALIAS_AUTO_LEARN_THRESHOLD, DRIVER_AUTO_ACCEPT_THRESHOLD, etc.), and the
Needleman-Wunsch-style sequence alignment are unchanged from V1 - including
the specific hard-won tuning decisions documented in V1's own comments
(the 30% name-similarity floor, the confidence caps below name_sim<30,
the vehicle-bonus-after-cap ordering) which were each found by testing
against real data. None of that reasoning is second-guessed here.

What changed: the two standalone SQLite alias files (customer_aliases.db,
driver_aliases.db) are now the shared Postgres tables CustomerAlias and
DriverAlias (models/customer.py), per the "database first" requirement -
one connection factory, not two separate local files.
"""
import re
from collections import defaultdict
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.services.identity_engine import _fuzzy_ratio
from app.models.customer import CustomerAlias, DriverAlias

CONFIDENCE_REVIEW_THRESHOLD = 60
MIN_PAIR_SCORE_TO_ALIGN = 25
ALIAS_AUTO_LEARN_THRESHOLD = 90
DRIVER_AUTO_ACCEPT_THRESHOLD = 80
DRIVER_REVIEW_THRESHOLD = 60

_SUFFIX_WORDS = {
    "LLC", "PHARMACY", "MEDICAL", "PVT", "LTD", "TRADING", "EST", "ESTABLISHMENT",
    "GROUP", "CENTRE", "CENTER", "CLINIC", "HOSPITAL", "STORE", "STORES", "TRD",
    "FZE", "FZCO", "DMCC", "CO", "COMPANY", "GEN", "GENERAL", "AND", "THE",
}
_ABBREV_MAP = {"BRANCH": "B", "BR": "B"}

REVIEW_REASONS = [
    "no_landmark_that_day", "no_matching_stop_found", "different_customer_names", "driver_mismatch",
    "customer_only_in_remarks", "customer_only_in_address", "multiple_landmark_candidates",
    "duplicate_customer_names", "missing_sap_information", "missing_landmark_information",
    "time_mismatch", "route_mismatch", "unknown_reason",
]


def normalize_customer_name(name: str) -> str:
    s = str(name or "").upper()
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    tokens = [_ABBREV_MAP.get(t, t) for t in s.split(" ") if t]

    collapsed = []
    i = 0
    while i < len(tokens):
        if tokens[i] == "B" and i + 1 < len(tokens) and tokens[i + 1].isdigit():
            collapsed.append("B" + tokens[i + 1])
            i += 2
        else:
            collapsed.append(tokens[i])
            i += 1

    kept = [t for t in collapsed if t not in _SUFFIX_WORDS]
    return " ".join(kept) if kept else " ".join(collapsed)


def name_similarity(a: str, b: str) -> float:
    return _fuzzy_ratio(normalize_customer_name(a), normalize_customer_name(b))


def driver_name_similarity(a: str, b: str) -> float:
    def toks(s):
        s = re.sub(r"[\[\]]", " ", str(s or "").upper())
        return [t for t in s.split() if len(t) > 1]
    tokens_a, tokens_b = toks(a), toks(b)
    if not tokens_a or not tokens_b:
        return 0.0
    shorter, longer = (tokens_a, tokens_b) if len(tokens_a) <= len(tokens_b) else (tokens_b, tokens_a)
    scores = [max(_fuzzy_ratio(t, t2) for t2 in longer) for t in shorter]
    return sum(scores) / len(scores)


# ---------------------------------------------------------------------------
# Driver alias table (Postgres, was driver_aliases.db)
# ---------------------------------------------------------------------------

def lookup_driver_alias(db: Session, sap_name: str) -> Optional[str]:
    key = (sap_name or "").strip().upper()
    row = db.query(DriverAlias).filter(DriverAlias.sap_driver_normalized == key).first()
    return row.landmark_driver_name if row else None


def learn_driver_alias(db: Session, sap_name: str, landmark_name: str, confidence: float):
    key = (sap_name or "").strip().upper()
    now = datetime.utcnow()
    row = db.query(DriverAlias).filter(DriverAlias.sap_driver_normalized == key).first()
    if row:
        row.times_confirmed += 1
        row.last_seen = now
    else:
        db.add(DriverAlias(sap_driver_normalized=key, sap_driver_original=sap_name,
                            landmark_driver_name=landmark_name, confidence=confidence,
                            times_confirmed=1, first_seen=now, last_seen=now))
    db.commit()


def reconcile_drivers(db: Session, sap_names: list[str], landmark_names: list[str]):
    mapping, ambiguous = {}, []
    landmark_names = [n for n in landmark_names if n and n != "Unknown"]

    for sap_name in sap_names:
        cached = lookup_driver_alias(db, sap_name)
        if cached:
            mapping[sap_name] = cached
            continue
        if sap_name.strip().upper() in {n.strip().upper() for n in landmark_names}:
            mapping[sap_name] = sap_name
            continue
        if not landmark_names:
            continue

        scored = sorted(((lm, driver_name_similarity(sap_name, lm)) for lm in landmark_names), key=lambda x: -x[1])
        best_name, best_score = scored[0]
        second_score = scored[1][1] if len(scored) > 1 else 0

        if best_score >= DRIVER_AUTO_ACCEPT_THRESHOLD and (best_score - second_score) >= 10:
            mapping[sap_name] = best_name
            learn_driver_alias(db, sap_name, best_name, best_score)
        elif best_score >= DRIVER_REVIEW_THRESHOLD:
            ambiguous.append({
                "sap_driver": sap_name, "suggested_landmark_driver": best_name,
                "confidence": round(best_score, 1),
                "runner_up": scored[1][0] if len(scored) > 1 else None,
                "runner_up_confidence": round(second_score, 1),
            })
    return mapping, ambiguous


def classify_review_reason(result: dict, name_source, duplicate_name_in_group: bool) -> str:
    if result["matched_landmark_name"] is None:
        return "no_landmark_that_day" if not result.get("group_had_landmark_data", True) else "no_matching_stop_found"
    if not result["sap_customer_name"]:
        return "missing_sap_information"
    if name_source == "remarks":
        return "customer_only_in_remarks"
    if name_source == "address":
        return "customer_only_in_address"
    if duplicate_name_in_group:
        return "duplicate_customer_names"

    ev = result["evidence"]
    name_sim = ev.get("name_similarity_pct", 0) or 0
    route_sim = ev.get("route_sequence_pct", 0) or 0
    time_sim = ev.get("time_proximity_pct", 0)
    time_sim = 50 if isinstance(time_sim, str) else (time_sim or 0)

    if name_sim < 50 and route_sim >= 70:
        return "different_customer_names"
    if name_sim >= 50 and time_sim < 40:
        return "time_mismatch"
    if name_sim >= 50 and route_sim < 40:
        return "route_mismatch"
    return "unknown_reason"


def group_review_for_bulk_approval(review_results: list[dict]) -> list[dict]:
    groups = defaultdict(list)
    for r in review_results:
        key = normalize_customer_name(r.get("sap_customer_name", ""))
        if key:
            groups[key].append(r)

    bulk = []
    for key, items in groups.items():
        if len(items) < 2:
            continue
        candidates = [r["matched_landmark_name"] for r in items
                      if r.get("matched_landmark_name") and r["confidence"] >= CONFIDENCE_REVIEW_THRESHOLD]
        suggested = max(set(candidates), key=candidates.count) if candidates else None
        bulk.append({
            "sap_name_group": key,
            "original_names": sorted({r["sap_customer_name"] for r in items}),
            "count": len(items),
            "sample_invoice_nos": [r["invoice_no"] for r in items[:5]],
            "suggested_landmark_name": suggested,
            "suggestion_support_count": candidates.count(suggested) if suggested else 0,
        })
    return sorted(bulk, key=lambda x: -x["count"])


def _to_minutes_since_midnight(t):
    if t is None or t == "":
        return None
    if hasattr(t, "hour"):
        return t.hour * 60 + t.minute + t.second / 60
    s = str(t).strip()
    m = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$", s)
    if not m:
        return None
    h, mi, se = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    return h * 60 + mi + se / 60


def time_proximity_score(sap_time, landmark_time) -> Optional[float]:
    t1 = _to_minutes_since_midnight(sap_time)
    t2 = _to_minutes_since_midnight(landmark_time)
    if t1 is None or t2 is None:
        return None
    diff = abs(t1 - t2)
    if diff <= 15:
        return 100.0
    if diff >= 240:
        return 0.0
    return max(0.0, 100.0 - (diff - 15) / (240 - 15) * 100.0)


# ---------------------------------------------------------------------------
# Alias database - now shared Postgres, same semantics as V1's SQLite table
# ---------------------------------------------------------------------------

def lookup_alias(db: Session, sap_name: str) -> Optional[dict]:
    key = normalize_customer_name(sap_name)
    row = (
        db.query(CustomerAlias)
        .filter(CustomerAlias.sap_name_normalized == key)
        .order_by(CustomerAlias.times_confirmed.desc())
        .first()
    )
    if not row:
        return None
    return {"landmark_name_normalized": row.landmark_name_normalized,
            "landmark_name_original": row.landmark_name_original,
            "times_confirmed": row.times_confirmed, "best_confidence": row.best_confidence}


def learn_alias(db: Session, sap_name: str, landmark_name: str, confidence: float):
    sap_key = normalize_customer_name(sap_name)
    lm_key = normalize_customer_name(landmark_name)
    now = datetime.utcnow()
    row = (
        db.query(CustomerAlias)
        .filter(CustomerAlias.sap_name_normalized == sap_key, CustomerAlias.landmark_name_normalized == lm_key)
        .first()
    )
    if row:
        row.times_confirmed += 1
        row.best_confidence = max(row.best_confidence, confidence)
        row.last_seen = now
    else:
        db.add(CustomerAlias(sap_name_normalized=sap_key, landmark_name_normalized=lm_key,
                              sap_name_original=sap_name, landmark_name_original=landmark_name,
                              times_confirmed=1, best_confidence=confidence, first_seen=now, last_seen=now))
    db.commit()


def get_alias_stats(db: Session) -> dict:
    total = db.query(CustomerAlias).count()
    confirmed_multi = db.query(CustomerAlias).filter(CustomerAlias.times_confirmed > 1).count()
    return {"total_aliases_learned": total, "aliases_confirmed_more_than_once": confirmed_multi}


def list_aliases(db: Session, search: str = "") -> list[dict]:
    q = db.query(CustomerAlias)
    if search:
        like = f"%{search.upper()}%"
        q = q.filter(
            (CustomerAlias.sap_name_original.ilike(like)) | (CustomerAlias.landmark_name_original.ilike(like))
        )
    rows = q.order_by(CustomerAlias.times_confirmed.desc()).all()
    return [{
        "sap_name_normalized": r.sap_name_normalized, "landmark_name_normalized": r.landmark_name_normalized,
        "sap_name_original": r.sap_name_original, "landmark_name_original": r.landmark_name_original,
        "times_confirmed": r.times_confirmed, "best_confidence": r.best_confidence,
        "first_seen": r.first_seen.isoformat(), "last_seen": r.last_seen.isoformat(),
    } for r in rows]


def delete_alias(db: Session, sap_name_normalized: str, landmark_name_normalized: str) -> bool:
    row = (
        db.query(CustomerAlias)
        .filter(CustomerAlias.sap_name_normalized == sap_name_normalized,
                CustomerAlias.landmark_name_normalized == landmark_name_normalized)
        .first()
    )
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


# ---------------------------------------------------------------------------
# Sequence alignment (Needleman-Wunsch style, zero gap penalty) - unchanged
# ---------------------------------------------------------------------------

def _align_sequences(n: int, m: int, pair_score) -> list[tuple[int, int]]:
    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    choice = [[None] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            s = pair_score(i - 1, j - 1)
            diag = dp[i - 1][j - 1] + s
            up = dp[i - 1][j]
            left = dp[i][j - 1]
            best = max(diag, up, left)
            dp[i][j] = best
            if diag == best and diag > max(up, left):
                choice[i][j] = "diag"
            elif up == best:
                choice[i][j] = "up"
            else:
                choice[i][j] = "left"

    pairs = []
    i, j = n, m
    while i > 0 and j > 0:
        c = choice[i][j]
        if c == "diag":
            pairs.append((i - 1, j - 1))
            i -= 1
            j -= 1
        elif c == "up":
            i -= 1
        else:
            j -= 1
    pairs.reverse()
    return pairs


# ---------------------------------------------------------------------------
# Core: correlate one driver's one day - unchanged scoring logic
# ---------------------------------------------------------------------------

def correlate_driver_day(db: Session, sap_rows: list[dict], landmark_rows: list[dict]) -> list[dict]:
    stops = [r for r in landmark_rows if not r.get("is_passthrough") and not r.get("is_depot")]
    stops.sort(key=lambda r: _to_minutes_since_midnight(r["arrival"]) or 0)
    passthroughs = [r for r in landmark_rows if r.get("is_passthrough")]

    n, m = len(sap_rows), len(stops)

    alias_hits = {}
    for i, sap_row in enumerate(sap_rows):
        alias = lookup_alias(db, sap_row.get("customer_name", ""))
        if alias:
            alias_hits[i] = alias["landmark_name_normalized"]

    def pair_score(i, j):
        sap_row, lm_row = sap_rows[i], stops[j]
        sap_name = sap_row.get("customer_name") or sap_row.get("not_supplied_reason") or ""
        name_sim = name_similarity(sap_name, lm_row["customer_name"])
        if i in alias_hits and normalize_customer_name(lm_row["customer_name"]) == alias_hits[i]:
            name_sim = max(name_sim, 97.0)

        sap_time = sap_row.get("box_entry_time") or sap_row.get("invoice_date")
        time_score = time_proximity_score(sap_time, lm_row["arrival"])

        if not sap_name.strip():
            combined = time_score if time_score is not None else 0.0
        elif name_sim < 30:
            combined = 0.0
        elif time_score is None:
            combined = name_sim
        else:
            combined = name_sim * 0.7 + time_score * 0.3

        return combined if combined >= MIN_PAIR_SCORE_TO_ALIGN else 0.0

    aligned_pairs = _align_sequences(n, m, pair_score) if n and m else []

    name_counts = defaultdict(int)
    for r in sap_rows:
        nm = normalize_customer_name(r.get("customer_name", ""))
        if nm:
            name_counts[nm] += 1

    results = []
    for i, sap_row in enumerate(sap_rows):
        match = next((j for si, j in aligned_pairs if si == i), None)
        is_dup = name_counts.get(normalize_customer_name(sap_row.get("customer_name", "")), 0) > 1
        if match is None:
            r = _unmatched_result(sap_row)
            r["review_reason"] = classify_review_reason(r, sap_row.get("customer_name_source"), is_dup)
            results.append(r)
            continue

        lm_row = stops[match]
        sap_name = sap_row.get("customer_name") or ""
        name_sim = name_similarity(sap_name, lm_row["customer_name"]) if sap_name.strip() else 0.0
        sap_time = sap_row.get("box_entry_time") or sap_row.get("invoice_date")
        time_score = time_proximity_score(sap_time, lm_row["arrival"])

        route_score = 100.0 - abs((i / max(n - 1, 1)) - (match / max(m - 1, 1))) * 100.0
        route_score = max(0.0, min(100.0, route_score))

        same_vehicle = bool(sap_row.get("vehicle_key")) and sap_row["vehicle_key"] == lm_row.get("vehicle_key")

        confidence, evidence = _score_confidence(name_sim, route_score, time_score, same_vehicle, sap_name)
        if is_dup:
            evidence["duplicate_customer_name_in_route"] = True
        dup_forces_review = False

        prev_stop = stops[match - 1] if match > 0 else None
        travel_minutes = None
        if prev_stop is not None:
            dep = _to_minutes_since_midnight(prev_stop.get("departure") or prev_stop.get("arrival"))
            arr = _to_minutes_since_midnight(lm_row["arrival"])
            if dep is not None and arr is not None:
                travel_minutes = round(max(arr - dep, 0), 1)

        passthroughs_before = sum(
            1 for p in passthroughs
            if (prev_stop is None or (_to_minutes_since_midnight(p["arrival"]) or 0) >
                (_to_minutes_since_midnight(prev_stop.get("departure") or prev_stop.get("arrival")) or 0))
            and (_to_minutes_since_midnight(p["arrival"]) or 0) < (_to_minutes_since_midnight(lm_row["arrival"]) or 0)
        )

        if confidence >= ALIAS_AUTO_LEARN_THRESHOLD and sap_name.strip() and not dup_forces_review:
            learn_alias(db, sap_name, lm_row["customer_name"], confidence)

        result = {
            "invoice_no": sap_row.get("invoice_no"), "sap_customer_name": sap_name,
            "customer_name_source": sap_row.get("customer_name_source"),
            "matched_landmark_name": lm_row["customer_name"], "confidence": round(confidence, 1),
            "needs_review": confidence < CONFIDENCE_REVIEW_THRESHOLD or dup_forces_review,
            "evidence": evidence, "arrival": lm_row["arrival"], "departure": lm_row["departure"],
            "duration_minutes": lm_row["minutes"], "travel_minutes_from_previous": travel_minutes,
            "passthroughs_before": passthroughs_before, "driver_name": sap_row.get("driver_name"),
            "vehicle_key": lm_row.get("vehicle_key"), "date": sap_row.get("dispatch_date"),
        }
        result["review_reason"] = (classify_review_reason(result, sap_row.get("customer_name_source"), is_dup)
                                    if result["needs_review"] else None)
        results.append(result)
    return results


def _score_confidence(name_sim, route_score, time_score, same_vehicle, sap_name):
    time_score_for_calc = time_score if time_score is not None else route_score
    vehicle_bonus = 5.0 if same_vehicle else 0.0

    if not sap_name.strip():
        base = route_score * 0.4 + time_score_for_calc * 0.3
        confidence = min(58.0, base + vehicle_bonus)
    elif name_sim >= 85:
        confidence = 70 + name_sim * 0.3 + vehicle_bonus
    elif name_sim >= 50:
        confidence = 45 + name_sim * 0.35 + route_score * 0.15 + vehicle_bonus
    elif name_sim >= 30:
        base = name_sim * 0.5 + route_score * 0.3 + time_score_for_calc * 0.2
        confidence = min(58.0, base + vehicle_bonus)
    else:
        base = route_score * 0.3 + time_score_for_calc * 0.2
        confidence = min(50.0, base + vehicle_bonus)

    confidence = max(0.0, min(100.0, confidence))
    evidence = {
        "same_driver": True, "same_date": True, "same_vehicle": same_vehicle,
        "name_similarity_pct": round(name_sim, 1), "route_sequence_pct": round(route_score, 1),
        "time_proximity_pct": round(time_score, 1) if time_score is not None else "n/a (no usable time signal)",
        "overall_confidence_pct": round(confidence, 1),
    }
    return confidence, evidence


def _unmatched_result(sap_row, group_had_landmark_data: bool = True) -> dict:
    if group_had_landmark_data:
        reason_text = ("This driver/date had Landmark GPS data, but no stop scored above the minimum "
                       f"threshold ({MIN_PAIR_SCORE_TO_ALIGN}) against this specific invoice - likely more "
                       "SAP invoices than actual stops that day, or name+timing genuinely don't line up.")
    else:
        reason_text = "No Landmark GPS data exists at all for this driver/date, even after driver-name reconciliation."
    return {
        "invoice_no": sap_row.get("invoice_no"), "sap_customer_name": sap_row.get("customer_name"),
        "customer_name_source": sap_row.get("customer_name_source"), "matched_landmark_name": None,
        "confidence": 0.0, "needs_review": True, "group_had_landmark_data": group_had_landmark_data,
        "evidence": {"reason": reason_text}, "arrival": None, "departure": None, "duration_minutes": None,
        "travel_minutes_from_previous": None, "passthroughs_before": None,
        "driver_name": sap_row.get("driver_name"), "vehicle_key": None, "date": sap_row.get("dispatch_date"),
    }


_MONTHS = {"JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
           "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12}


def _extract_date(arrival_str) -> str:
    if not arrival_str:
        return ""
    s = str(arrival_str).strip()
    m = re.match(r"(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})", s)
    if m:
        d, mon_str, y = m.groups()
        mo = _MONTHS.get(mon_str.upper()[:3])
        if mo:
            return f"{y}-{mo:02d}-{int(d):02d}"
    m2 = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m2:
        d, mo, y = m2.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    m3 = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m3:
        y, mo, d = m3.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    return ""


# ---------------------------------------------------------------------------
# Orchestrator - unchanged grouping/reconciliation logic
# ---------------------------------------------------------------------------

def correlate_all(db: Session, sap_facts: list[dict], landmark_facts: list[dict]) -> dict:
    sap_groups = defaultdict(list)
    for r in sap_facts:
        key = (r.get("driver_name") or "").strip().upper() or f"VEH:{r.get('vehicle_key', '')}"
        sap_groups[(key, r.get("dispatch_date"))].append(r)

    lm_groups = defaultdict(list)
    for r in landmark_facts:
        key_driver = (r.get("driver_name") or "").strip().upper()
        date_str = _extract_date(r.get("arrival"))
        lm_groups[(key_driver, date_str)].append(r)
        if r.get("vehicle_key"):
            lm_groups[(f"VEH:{r['vehicle_key']}", date_str)].append(r)

    sap_driver_names = sorted({r.get("driver_name", "") for r in sap_facts if r.get("driver_name")})
    lm_driver_names = sorted({r.get("driver_name", "") for r in landmark_facts if r.get("driver_name")})
    driver_map, ambiguous_drivers = reconcile_drivers(db, sap_driver_names, lm_driver_names)

    all_results = []
    groups_processed = 0
    groups_skipped_no_landmark_data = 0

    for (driver_key, date_str), sap_rows in sap_groups.items():
        landmark_rows = lm_groups.get((driver_key, date_str))
        if not landmark_rows:
            reconciled = driver_map.get(sap_rows[0].get("driver_name", ""))
            if reconciled:
                landmark_rows = lm_groups.get((reconciled.strip().upper(), date_str))
        if not landmark_rows:
            veh_key = sap_rows[0].get("vehicle_key")
            landmark_rows = lm_groups.get((f"VEH:{veh_key}", date_str)) if veh_key else None
        if not landmark_rows:
            groups_skipped_no_landmark_data += 1
            for r in sap_rows:
                res = _unmatched_result(r, group_had_landmark_data=False)
                res["review_reason"] = "no_landmark_that_day"
                all_results.append(res)
            continue
        groups_processed += 1
        all_results.extend(correlate_driver_day(db, sap_rows, landmark_rows))

    matched = [r for r in all_results if r["matched_landmark_name"] is not None]
    confidently_matched = [r for r in matched if not r["needs_review"]]
    needs_review = [r for r in all_results if r["needs_review"]]

    confidence_distribution = {
        "95-100": sum(1 for r in matched if r["confidence"] >= 95),
        "80-94": sum(1 for r in matched if 80 <= r["confidence"] < 95),
        "60-79": sum(1 for r in matched if 60 <= r["confidence"] < 80),
        "below_60": sum(1 for r in matched if r["confidence"] < 60),
    }
    review_reason_counts = defaultdict(int)
    for r in needs_review:
        review_reason_counts[r.get("review_reason") or "unknown_reason"] += 1

    bulk_approval_candidates = group_review_for_bulk_approval(
        [r for r in needs_review if r["matched_landmark_name"] is None or r["confidence"] < CONFIDENCE_REVIEW_THRESHOLD]
    )

    return {
        "results": all_results, "ambiguous_drivers": ambiguous_drivers,
        "bulk_approval_candidates": bulk_approval_candidates,
        "stats": {
            "total_sap_invoices": len(sap_facts), "groups_processed": groups_processed,
            "groups_skipped_no_landmark_data": groups_skipped_no_landmark_data,
            "drivers_auto_reconciled": len(driver_map), "drivers_needing_review": len(ambiguous_drivers),
            "matched_total": len(matched), "matched_confidently_ie_not_flagged": len(confidently_matched),
            "needs_review": len(needs_review),
            "match_rate_pct": round(len(matched) / max(len(sap_facts), 1) * 100, 1),
            "confident_match_rate_pct": round(len(confidently_matched) / max(len(sap_facts), 1) * 100, 1),
            "review_rate_pct": round(len(needs_review) / max(len(sap_facts), 1) * 100, 1),
            "avg_confidence_all_matched": round(sum(r["confidence"] for r in matched) / len(matched), 1) if matched else 0,
            "avg_confidence_confident_matches_only": round(
                sum(r["confidence"] for r in confidently_matched) / len(confidently_matched), 1
            ) if confidently_matched else 0,
            "confidence_distribution": confidence_distribution,
            "review_reason_breakdown": dict(review_reason_counts),
        },
    }
