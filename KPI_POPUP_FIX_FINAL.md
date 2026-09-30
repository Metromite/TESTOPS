# KPI Popup Fix — v35.26

The dashboard KPI detail path was replaced with a bounded 100-row preview during the UI redesign.
That changed the old behavior and could fail on schema differences because it selected a hard-coded column list.

This version restores the old detail semantics:
- paginated `select("*")` reads from `sap_invoice_facts`
- all dashboard filters are applied
- Valid Invoices / Total Boxes / Freezer / Normal use invoice detail rows
- Active Drivers / Unique Customers / Active Vehicles use the original aggregation
- newest dispatch dates are shown first
- the browser yields between Supabase pages
- detail dialogs still open immediately through the existing DetailWindow
- Total Boxes now requests its own `total_boxes` detail metric instead of incorrectly using `valid_invoices`
