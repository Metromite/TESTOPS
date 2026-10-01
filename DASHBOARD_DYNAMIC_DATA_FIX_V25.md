# DispatchOPS v25 — Dynamic Dashboard Data Canonicalization

This version is based directly on DispatchOPS-main-FIXED-v24.zip.

## Fixes
- Vehicle Type is canonicalized case/spacing-insensitively across Home dashboard chart aggregation.
- Fleet `vehicles.type` remains the authoritative display label for vehicle types.
- `PICK-UP`, `Pick-Up`, `pickup`, etc. are one chart category, not separate bars.
- Facility Type chart also groups case/spacing variants into one category.
- Vehicle type chart receives the current Fleet map before chart construction; no hard-coded vehicle-type categories are used.
- Existing dashboard data and functionality are preserved.
