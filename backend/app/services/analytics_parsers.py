"""
services/analytics_parsers.py
--------------------------------
DIRECT PORT of V1's analytics_parsers.py. This closes the gap flagged in
services/correlation_job.py: turning a raw uploaded file into the "fact"
dicts the correlation engine expects. Every function keeps its V1 name and
behavior - facility classification against the same 322-keyword map
(copied byte-for-byte from V1's facility_keyword_map.json, not retyped -
same reasoning V1's own docstring gives for doing it that way), the same
NA-safe string/date/int coercion (each fixing a specific bug V1's comments
describe finding against real data), and the same Landmark sheet-shape
autodetection.

The only thing NOT ported here: V1's own docstring says persisting these
facts was "analytics_db.py's job" - that module wasn't in your upload, so
models/analytics_facts.py below is NEW glue I designed to store the output
of these parsers in Postgres, not a port of an existing V1 file.
"""
import json
import os
import re
from datetime import datetime

import pandas as pd

from app.services import identity_engine as ie

_HERE = os.path.dirname(os.path.abspath(__file__))
_KEYWORD_MAP_PATH = os.path.join(_HERE, "..", "data", "facility_keyword_map.json")


def _load_keyword_rules():
    with open(_KEYWORD_MAP_PATH, encoding="utf-8") as f:
        keyword_map = json.load(f)
    rules = []
    for ftype, keywords in keyword_map.items():
        for kw in keywords:
            rules.append((kw.upper(), ftype))
    # Longest keyword wins first - matches V1's `_KW_RULES.sort((a,b) =>
    # b.kw.length - a.kw.length)` exactly, including Python's stable sort
    # preserving tie order the same way JS engines' Array.sort does.
    rules.sort(key=lambda r: -len(r[0]))
    return rules


_KW_RULES = _load_keyword_rules()


def classify_facility(txn_code, remarks, cust_name, div_desc):
    for col in (txn_code, remarks, cust_name, div_desc):
        if not col:
            continue
        upper = str(col).upper()
        for kw, ftype in _KW_RULES:
            if kw in upper:
                return ftype
    return "Representative"


def parse_duration(d):
    m = re.match(r"^(\d+)H:(\d+)M$", str(d or "").strip())
    if not m:
        return 0
    return int(m.group(1)) * 60 + int(m.group(2))


def _clean_str(v):
    """NA-safe string coercion - fixes two real bugs V1 found against
    actual SAP files: NaN cells becoming the literal string "nan", and
    pandas silently turning ID columns like Invoice No into "...0" floats."""
    try:
        if v is None or pd.isna(v):
            return ""
    except (TypeError, ValueError):
        pass
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def _to_date_str(v):
    try:
        if v is None or v == "" or pd.isna(v):
            return ""
    except (TypeError, ValueError):
        pass
    if isinstance(v, (pd.Timestamp, datetime)):
        return v.strftime("%Y-%m-%d")
    return str(v)


def _to_int(v):
    try:
        if v is None or v == "" or pd.isna(v):
            return 0
    except (TypeError, ValueError):
        pass
    try:
        return int(round(float(v)))
    except (ValueError, TypeError):
        return 0


# ---------------------------------------------------------------------------
# SAP invoice-line facts (grain: one row per Invoice No, unaggregated)
# ---------------------------------------------------------------------------

def parse_sap_invoice_facts(df, source_file: str = "") -> list[dict]:
    records = []
    for _, r in df.iterrows():
        invoice_no = _clean_str(r.get("Invoice No"))
        if not invoice_no:
            # Confirmed against real data: rows with no Invoice No are
            # genuine empty padding rows, not deliveries with a missing name.
            continue

        # Business rule (explicit): only real driver/helper codes count -
        # Driver Code must start with "D", Helper Code (if present) must
        # start with "H". Also exclude KIZAD deliveries and any invoice
        # numbered with the "2..." prefix (a different, non-standard
        # invoice series) - only the "3..." series are real pharmacy
        # delivery invoices for this dashboard's purposes.
        driver_code = _clean_str(r.get("Driver Code")).upper()
        helper_code = _clean_str(r.get("Helper Code")).upper()
        if driver_code and not driver_code.startswith("D"):
            continue
        if helper_code and not helper_code.startswith("H"):
            helper_code = ""  # drop a bad helper code rather than reject the whole delivery row
        if invoice_no.startswith("2"):
            continue

        vehicle_num = _clean_str(r.get("Vehicle Number"))
        vehicle_key = ie.normalize_vehicle(vehicle_num)
        cust_name = _clean_str(r.get("Customer Name"))
        driver_name = _clean_str(r.get("Driver Name"))
        div_desc = _clean_str(r.get("Division Description")) or _clean_str(r.get("Division Desc"))
        txn_code = _clean_str(r.get("TXN Code"))
        remarks = _clean_str(r.get("Remarks"))
        address = _clean_str(r.get("Address"))
        area_val = _clean_str(r.get("Location Code")) or div_desc

        if "KIZAD" in cust_name.upper() or "KIZAD" in area_val.upper() or "KIZAD" in remarks.upper():
            continue

        fac_type = classify_facility(txn_code, remarks, cust_name, div_desc)
        vnum_raw = vehicle_num.upper()
        if fac_type == "Pharmacy" and ("PICK" in vnum_raw or re.match(r"^[0-9]", vnum_raw)):
            fac_type = "Store"

        supply_desc = _clean_str(r.get("Supply Description"))

        box_entry = r.get("Box Entry Time")
        box_entry_str = box_entry.strftime("%H:%M:%S") if hasattr(box_entry, "strftime") else (str(box_entry) if box_entry else "")

        records.append({
            "invoice_date": _to_date_str(r.get("Invoice Date")),
            "dispatch_date": _to_date_str(r.get("Dispatch Date")),
            "dispatch_num": _clean_str(r.get("Dispatch Number")),
            "invoice_no": invoice_no,
            "driver_code": driver_code,
            "driver_name": driver_name,
            "helper_code": helper_code,
            "helper_name": _clean_str(r.get("Helper Name")),
            "vehicle_num": vehicle_num,
            "vehicle_key": vehicle_key,
            "customer_name": cust_name,
            "customer_name_source": "customer_name" if cust_name else None,
            "remarks": remarks,
            "address": address,
            "area": area_val,
            "boxes": _to_int(r.get("No of Boxes")),
            "normal_boxes": _to_int(r.get("No of Normal Box")),
            "freezer_boxes": _to_int(r.get("No of Freezer Box")),
            "not_supplied_reason": supply_desc,
            "division_desc": div_desc,
            "txn_code": txn_code,
            "facility_type": fac_type,
            "vehicle_type": (("PICKUP" if re.match(r"^[0-9]", vehicle_num) else "VAN") if vehicle_num else "UNKNOWN"),
            "box_entry_time": box_entry_str,
            "source_file": source_file,
        })

    # Fallback: real deliveries missing a Customer Name use Remarks/Address
    # as an identity signal instead - confirmed 394 such recoverable rows in
    # V1's own test data rather than being unmatched forever.
    for rec in records:
        if not rec["customer_name"]:
            fallback = rec["remarks"] or rec["address"]
            if fallback:
                rec["customer_name"] = fallback
                rec["customer_name_source"] = "remarks" if rec["remarks"] else "address"

    return records


def invoice_fact_key(rec: dict) -> str:
    """Composite natural key matching V1's dedup key exactly."""
    return f"{rec['invoice_no']}|{rec['dispatch_date']}|{rec['driver_name']}|{rec['customer_name']}"


# ---------------------------------------------------------------------------
# Landmark (GPS geofence visit) facts
# ---------------------------------------------------------------------------

def extract_vehicle_plate(header_str: str) -> str:
    """Handles both 'C 47055 (5 Ton PickUp)' -> 'C47055' and
    '16 47645 Coaster Bus' -> '47645' (a real format gap V1 found and fixed -
    the second form has no parens, so a naive split mashed the leading
    sequence number and trailing type words into the vehicle key)."""
    s = header_str.split("(")[0].strip().upper()
    tokens = re.split(r"[\s\-]+", s)
    digit_tokens = [(i, t) for i, t in enumerate(tokens) if re.fullmatch(r"\d{3,7}", t)]
    if not digit_tokens:
        return re.sub(r"[^A-Z0-9]", "", s)
    idx, plate_digits = max(digit_tokens, key=lambda x: len(x[1]))
    prefix = tokens[idx - 1] if idx > 0 and re.fullmatch(r"[A-Z]{1,3}", tokens[idx - 1]) else ""
    return prefix + plate_digits


def read_landmark_sheet_raw(path_or_buffer, sheet_name=0) -> list:
    """Reads a Landmark export as a raw row-major grid, no header assumed."""
    df = pd.read_excel(path_or_buffer, sheet_name=sheet_name, header=None)
    return df.values.tolist()


def _cell(row, idx):
    if idx is None or idx < 0 or idx >= len(row):
        return ""
    v = row[idx]
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    if isinstance(v, (pd.Timestamp, datetime)):
        return v.strftime("%d/%m/%Y %H:%M:%S")
    return str(v).strip()


def parse_landmark_visit_facts(raw_rows: list, source_file: str = "") -> list[dict]:
    records = []
    data_start = -1
    col_driver, col_lm, col_entry, col_exit, col_dur = 1, 2, 6, 7, 9

    for i in range(min(30, len(raw_rows))):
        row_str = [str(c).lower().strip() if c is not None and not (isinstance(c, float) and pd.isna(c)) else ""
                   for c in raw_rows[i]]
        driver_idx = next((j for j, c in enumerate(row_str) if c == "driver"), -1)
        lm_idx = next((j for j, c in enumerate(row_str) if c == "landmark" or c.startswith("landmark")), -1)
        dur_idx = next((j for j, c in enumerate(row_str) if c == "duration" or c.startswith("duration")), -1)
        entry_idx = next((j for j, c in enumerate(row_str) if "entry" in c and "date" in c), -1)
        exit_idx = next((j for j, c in enumerate(row_str) if "exit" in c and "date" in c), -1)
        if driver_idx >= 0 and (lm_idx >= 0 or dur_idx >= 0):
            data_start = i + 1
            col_driver = driver_idx
            if lm_idx >= 0: col_lm = lm_idx
            if entry_idx >= 0: col_entry = entry_idx
            if exit_idx >= 0: col_exit = exit_idx
            if dur_idx >= 0: col_dur = dur_idx
            break
    if data_start < 0:
        data_start = 18

    current_vehicle_raw = ""
    current_vehicle_key = ""

    for i in range(data_start, len(raw_rows)):
        row = raw_rows[i]
        if row is None:
            continue
        col1 = _cell(row, col_driver)
        col2 = _cell(row, col_lm)
        entry = _cell(row, col_entry)
        exit_ = _cell(row, col_exit)
        dur = _cell(row, col_dur)
        if not col1 and not col2 and not entry and not dur:
            continue

        is_vehicle_header = bool(col1) and not col2 \
            and ("(" in col1 or len(ie.normalize_vehicle(col1)) >= 4) \
            and not entry and not dur
        if is_vehicle_header:
            current_vehicle_raw = col1
            current_vehicle_key = extract_vehicle_plate(col1)
            continue

        if not col2 or col2.lower() == "landmark":
            continue
        if not dur and not entry:
            continue

        minutes = parse_duration(dur)
        is_passthrough = "pass" in dur.lower()
        is_delivery = bool(re.match(r"^\d+H:\d+M$", dur, re.I)) and minutes > 0
        is_depot = "CITY PHARMACY" in col2.upper() and "IND" in col2.upper()

        records.append({
            "driver_name": col1 or "Unknown",
            "customer_name": col2,
            "vehicle_raw": current_vehicle_raw,
            "vehicle_key": current_vehicle_key,
            "arrival": entry,
            "departure": exit_,
            "duration": dur,
            "minutes": minutes,
            "is_delivery": is_delivery,
            "is_passthrough": is_passthrough,
            "is_depot": is_depot,
            "source_file": source_file,
        })
    return records


def landmark_fact_key(rec: dict) -> str:
    """No single ID exists in the source data, so this composite key
    (vehicle, driver, landmark, entry time) identifies a visit, same as V1."""
    return f"{rec['vehicle_key']}|{rec['driver_name']}|{rec['customer_name']}|{rec['arrival']}"
