"""
services/table_io.py
-----------------------
Generic Excel import/export for the simple flat Fleet-style tables
(Driver, Helper, Vehicle, Area, Vacation). Column headers in the sheet
must match the model's field names (case-insensitive) - export always
produces a file in exactly that shape, so re-uploading an exported file
round-trips cleanly.

Import behavior: matched by the table's natural key (e.g. Driver.code) -
if a row with that key already exists, it's updated in place; otherwise a
new row is created. This means re-uploading a corrected sheet is safe to
do repeatedly rather than creating duplicates.
"""
import io

import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from sqlalchemy.orm import Session


def export_table_to_excel(rows: list, fields: list[str], sheet_title: str) -> io.BytesIO:
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_title[:31]
    ws.sheet_view.showGridLines = False

    for ci, field in enumerate(fields, 1):
        cell = ws.cell(row=1, column=ci, value=field)
        cell.fill = PatternFill("solid", fgColor="2C2C84")
        cell.font = Font(name="Arial", bold=True, color="FFFFFF")
        cell.alignment = Alignment(horizontal="center")

    for ri, row in enumerate(rows, 2):
        for ci, field in enumerate(fields, 1):
            ws.cell(row=ri, column=ci, value=getattr(row, field, ""))

    for ci, field in enumerate(fields, 1):
        ws.column_dimensions[chr(64 + ci) if ci <= 26 else "A"].width = max(len(field) + 4, 14)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def import_table_from_excel(db: Session, model, key_field: str, fields: list[str], file_bytes: bytes,
                             match_existing: bool = True, secondary_key_fields: list[str] | None = None,
                             normalizers: dict | None = None) -> dict:
    """
    match_existing=True: rows are matched by key_field (plus any
    secondary_key_fields, all of which must match) and updated in place if
    found - safe for Driver.code, Helper.code, Vehicle.number (genuinely
    globally unique). Area.code is NOT globally unique any more (the same
    code can exist under a different Division), so Area imports pass
    secondary_key_fields=["name", "sector"] to match on the full
    code+name+division combination, matching the corrected DB constraint.
    match_existing=False: every row is always inserted as new (required
    for tables like Vacation, where person_code legitimately repeats
    across multiple vacation periods for the same person - there's no
    single column that uniquely identifies "this one vacation record" to
    match against).
    """
    secondary_key_fields = secondary_key_fields or []
    normalizers = normalizers or {}
    df = pd.read_excel(io.BytesIO(file_bytes))
    col_map = {c.lower().strip(): c for c in df.columns}

    if key_field.lower() not in col_map:
        return {"ok": False, "error": f"Uploaded file has no '{key_field}' column - can't match rows to existing records."}

    created, updated, skipped = 0, 0, 0
    for _, row in df.iterrows():
        key_val = row.get(col_map[key_field.lower()])
        if pd.isna(key_val) or str(key_val).strip() == "":
            skipped += 1
            continue
        key_val = str(key_val).strip()

        values = {}
        for field in fields:
            if field.lower() in col_map:
                v = row.get(col_map[field.lower()])
                v = "" if pd.isna(v) else (str(v).strip() if isinstance(v, str) else v)
                if field in normalizers and isinstance(v, str):
                    v = normalizers[field](v)
                values[field] = v

        existing = None
        if match_existing:
            q = db.query(model).filter(getattr(model, key_field) == key_val)
            for sec_field in secondary_key_fields:
                if sec_field.lower() in col_map:
                    sec_val = row.get(col_map[sec_field.lower()])
                    sec_val = "" if pd.isna(sec_val) else (str(sec_val).strip() if isinstance(sec_val, str) else sec_val)
                    q = q.filter(getattr(model, sec_field) == sec_val)
            existing = q.first()
        if existing:
            for k, v in values.items():
                setattr(existing, k, v)
            updated += 1
        else:
            values[key_field] = key_val
            db.add(model(**values))
            created += 1

    db.commit()
    return {"ok": True, "created": created, "updated": updated, "skipped_blank_key": skipped}
