# Dashboard v26 — Dynamic Dimension Canonicalization

Vehicle-type and other dashboard dimensions are not fixed enums. The frontend canonicalization key now removes case, whitespace, punctuation, and separators for grouping/matching (for example `PICKUP`, `Pick-Up`, and `pick up` share one key). The displayed label remains the authoritative Fleet value for vehicle types when available.

This is applied to the merged Dashboard snapshot and the client-side dashboard aggregation path, so charts do not create duplicate categories merely because source systems format the same value differently.
