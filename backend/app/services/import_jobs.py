"""
services/import_jobs.py
-------------------------
Background job function for SAP/Landmark file imports. Does two things,
matching V1's immutable-raw-storage principle while ALSO making the real
parsed logic (analytics_parsers.py) available for correlation/analytics:

  1. Store every raw row untouched in `raw_import_rows` (audit trail -
     never mutated, matches route_intelligence_db.py's design principle).
  2. Run the actual ported SAP/Landmark parsing logic (facility
     classification, vehicle-plate extraction, NA-safe coercion) and store
     the resulting facts in sap_invoice_facts / landmark_visit_facts.

Both steps run in the same job so progress reporting covers the whole
thing - the raw-row loop was previously the only thing here; the real
parsing is what was missing (see correlation_job.py's prior placeholder
note, now resolved).
"""
import json
import uuid

import pandas as pd
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.imports import RawImportRow
from app.models.analytics_facts import SapInvoiceFact, LandmarkVisitFact
from app.models.customer import IdentityReviewItem
from app.services import analytics_parsers as ap
from app.services import identity_engine as ie
from app.services.jobs import report_progress


def run_file_import(job_id: str, filepath: str, source_type: str, imported_by: str = ""):
    db: Session = SessionLocal()
    batch_id = str(uuid.uuid4())
    try:
        # --- Step 1: immutable raw storage (unchanged from before) ---
        if filepath.lower().endswith((".xlsx", ".xls")):
            df = pd.read_excel(filepath)
        else:
            df = pd.read_csv(filepath)

        total = len(df)
        report_progress(job_id, 0, total, "Reading file", f"Loaded {total} rows from {filepath}")
        chunk = []
        for idx, row in df.iterrows():
            chunk.append(RawImportRow(
                source_type=source_type, batch_id=batch_id, source_filename=filepath,
                row_index=int(idx), row_json=json.dumps(row.astype(str).to_dict()),
                imported_by=imported_by,
            ))
            if len(chunk) >= 500:
                db.bulk_save_objects(chunk)
                db.commit()
                report_progress(job_id, idx + 1, total, "Storing raw rows", f"Stored {idx + 1}/{total} raw rows")
                chunk = []
        if chunk:
            db.bulk_save_objects(chunk)
            db.commit()

        # --- Step 2: real parsing (analytics_parsers.py, ported) ---
        report_progress(job_id, total, total, "Parsing business facts",
                         "Running ported SAP/Landmark parsing logic")

        if source_type == "sap":
            facts = ap.parse_sap_invoice_facts(df, source_file=filepath)
            fact_rows = [SapInvoiceFact(batch_id=batch_id, **f) for f in facts]

            # Salesman Categorization (V2 milestone): best-effort column
            # detection (same candidates master_data_learning.py already
            # uses for autocomplete), matched back to each fact by Invoice
            # No since parse_sap_invoice_facts() doesn't carry a salesman
            # field itself (kept untouched as a direct V1 port).
            try:
                from app.services.master_data_learning import detect_salesman_column
                salesman_col = detect_salesman_column(df)
                if salesman_col is not None and "Invoice No" in df.columns:
                    salesman_by_invoice = {}
                    for _, r in df.iterrows():
                        inv = ap._clean_str(r.get("Invoice No"))
                        sm = str(r.get(salesman_col, "")).strip()
                        if inv and sm and sm.lower() not in ("nan", "none", "n/a"):
                            salesman_by_invoice[inv] = sm
                    for fr in fact_rows:
                        fr.salesman = salesman_by_invoice.get(fr.invoice_no, "")
            except Exception:
                pass  # best-effort - never blocks the import
        else:  # landmark - needs the raw ungrouped grid, re-read with header=None
            raw_rows = ap.read_landmark_sheet_raw(filepath)
            facts = ap.parse_landmark_visit_facts(raw_rows, source_file=filepath)
            fact_rows = [LandmarkVisitFact(batch_id=batch_id, **f) for f in facts]

        for i in range(0, len(fact_rows), 500):
            db.bulk_save_objects(fact_rows[i:i + 500])
            db.commit()
            report_progress(job_id, total, total, "Storing parsed facts",
                             f"Stored {min(i + 500, len(fact_rows))}/{len(fact_rows)} parsed {source_type} facts")

        # --- Step 2b: Master Data Learning (Customer/Salesman autocomplete).
        # Additive and best-effort by design, same pattern as the
        # experience-tracking try/except below - a problem here must never
        # undo the successful raw/fact import that already happened above.
        # Driver/Helper/Area Code/Area Name/Vehicle Number/Vehicle Type/
        # Division/Route Type autocomplete is NOT handled here - those come
        # live from their own authoritative tables (see models/master_data.py
        # docstring for why), so importing SAP data can never create a
        # "ghost" Driver/Area/Vehicle row.
        try:
            from app.services.master_data_learning import learn_from_sap_import
            learned = learn_from_sap_import(db, df, facts)
            if learned:
                report_progress(job_id, total, total, "Master data learned",
                                 f"Learned {learned} new customer/salesman value(s) for autocomplete")
        except Exception as exc:
            report_progress(job_id, total, total, "Master data learning skipped", f"Could not learn master data: {exc}")

        # --- Step 2c: Division Detection (V2 milestone) - for every driver
        # code seen in this batch, compare Consumer vs Pharma invoices per
        # working day and record the winner permanently. Additive/
        # best-effort, same reasoning as Master Data Learning above.
        if source_type == "sap":
            try:
                from app.services.division_detection import compute_driver_daily_divisions
                codes = {f.get("driver_code", "") for f in facts if f.get("driver_code")}
                written = compute_driver_daily_divisions(db, codes) if codes else 0
                if written:
                    report_progress(job_id, total, total, "Division detection updated",
                                     f"Recorded Consumer/Pharma division for {written} driver-day(s)")
            except Exception as exc:
                report_progress(job_id, total, total, "Division detection skipped", f"Could not compute daily divisions: {exc}")

        # --- Step 3: experience tracking (identity_engine.py, ported but
        # not previously wired in) - this is what lets the Experience page
        # show exact dates-worked per area/sector per driver/helper. Only
        # runs for SAP imports, since that's the file that has Dispatch
        # Number/Driver Code/Location Code/Division Description columns.
        if source_type == "sap":
            report_progress(job_id, total, total, "Building experience history",
                             "Matching drivers/helpers against master data and tracking area/sector stints")
            try:
                plan = ie.process_sap_export(df, db)
                ie.apply_stint_changes(db, plan["auto_updates"], plan["auto_inserts"])

                review_cards = ie.dedupe_review_items(plan["review_items"])
                for card in review_cards:
                    for row in card["affected_rows"]:
                        db.add(IdentityReviewItem(
                            batch_id=batch_id, role=card["role"], sap_code=card["sap_code"],
                            sap_name=card["sap_name"], area=row["area"], date=row["date"],
                            vehicle=row["vehicle"], confidence=card["confidence"], reason=card["reason"],
                            suggested_code=card["suggested_code"] or "", suggested_name=card["suggested_name"] or "",
                        ))
                db.commit()

                stats = plan["stats"]
                report_progress(
                    job_id, total, total, "Experience history updated",
                    f"{stats['history_inserts']} new area/sector stints, {stats['history_updates']} extended, "
                    f"{stats['auto_exact']} exact driver/helper matches, {stats['auto_alias']} alias matches, "
                    f"{stats['needs_review']} rows need manual identity review",
                )
            except Exception as exc:
                # Experience tracking is additive - a problem here (e.g. an
                # unusual file layout) shouldn't undo the successful raw/fact
                # import that already happened above.
                report_progress(job_id, total, total, "Experience history skipped",
                                 f"Could not build experience history: {exc}")

        report_progress(job_id, total, total, "Finalizing",
                         f"Import complete - batch {batch_id} - {len(facts)} facts parsed, ready for correlation")
    finally:
        db.close()
