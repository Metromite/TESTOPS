"""
services/correlation_job.py
------------------------------
Background-job wrapper around services/correlation_engine.correlate_all.
This now reads REAL parsed facts from sap_invoice_facts / landmark_visit_facts
(populated by services/import_jobs.py running the ported analytics_parsers.py
logic) instead of the earlier placeholder that guessed at raw column names.
The field names line up exactly because correlation_engine.py was ported
expecting precisely the dict shape analytics_parsers.py's functions produce -
no translation layer needed between them.
"""
from app.core.database import SessionLocal
from app.models.analytics_facts import SapInvoiceFact, LandmarkVisitFact
from app.models.customer import CorrelationResult
from app.services import correlation_engine as ce
from app.services.jobs import report_progress

_SAP_FIELDS = [
    "invoice_no", "customer_name", "customer_name_source", "dispatch_date",
    "driver_name", "vehicle_key", "box_entry_time", "not_supplied_reason",
]
_LM_FIELDS = [
    "driver_name", "customer_name", "vehicle_key", "arrival", "departure",
    "minutes", "is_passthrough", "is_depot",
]


def _sap_row_to_dict(row: SapInvoiceFact) -> dict:
    d = {f: getattr(row, f) for f in _SAP_FIELDS}
    d["invoice_date"] = row.invoice_date  # used as a fallback time signal by the engine
    return d


def _lm_row_to_dict(row: LandmarkVisitFact) -> dict:
    return {f: getattr(row, f) for f in _LM_FIELDS}


def run_correlation(job_id: str, sap_batch_id: str, landmark_batch_id: str, result_batch_id: str):
    db = SessionLocal()
    try:
        report_progress(job_id, 0, 100, "Loading parsed SAP/Landmark facts")
        sap_rows = db.query(SapInvoiceFact).filter(SapInvoiceFact.batch_id == sap_batch_id).all()
        lm_rows = db.query(LandmarkVisitFact).filter(LandmarkVisitFact.batch_id == landmark_batch_id).all()

        sap_facts = [_sap_row_to_dict(r) for r in sap_rows]
        lm_facts = [_lm_row_to_dict(r) for r in lm_rows]

        report_progress(job_id, 20, 100, "Running correlation engine",
                         f"{len(sap_facts)} SAP invoice facts vs {len(lm_facts)} Landmark visit facts")
        outcome = ce.correlate_all(db, sap_facts, lm_facts)

        total = len(outcome["results"])
        for idx, r in enumerate(outcome["results"]):
            db.add(CorrelationResult(
                batch_id=result_batch_id,
                invoice_no=str(r.get("invoice_no") or ""),
                sap_customer_name=r.get("sap_customer_name") or "",
                matched_landmark_name=r.get("matched_landmark_name") or "",
                confidence=r.get("confidence") or 0.0,
                needs_review=r.get("needs_review", False),
                review_reason=r.get("review_reason") or "",
                evidence_json=_safe_json(r.get("evidence", {})),
                driver_name=r.get("driver_name") or "",
                date=r.get("date") or "",
            ))
            if idx % 200 == 0:
                db.commit()
                report_progress(job_id, 20 + int(idx / max(total, 1) * 70), 100, "Storing results",
                                 f"Stored {idx}/{total}")
        db.commit()
        report_progress(job_id, 100, 100, "Done",
                         f"Match rate {outcome['stats']['match_rate_pct']}%, "
                         f"{outcome['stats']['needs_review']} need review, "
                         f"{outcome['stats']['drivers_needing_review']} driver names ambiguous")
    finally:
        db.close()


def _safe_json(d: dict) -> str:
    import json
    try:
        return json.dumps(d)
    except TypeError:
        return json.dumps({k: str(v) for k, v in d.items()})
