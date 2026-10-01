# Dashboard Valid Invoices / Pickup Filter Fix

- **Valid Invoices** now excludes SAP invoice rows where `boxes <= 0`.
- Zero-box rows remain available to the existing **Zero Boxes** informational view.
- **Vehicle Type** filtering uses the **Fleet Database** vehicle number/type as the authority.
- Vehicle-type matching is normalized so `Pick-Up`, `PICK-UP`, and `PICKUP` match the same vehicle type.
- Fleet vehicle type is used for the Dashboard vehicle-type chart when a vehicle number matches.
- No table/schema changes were made.
