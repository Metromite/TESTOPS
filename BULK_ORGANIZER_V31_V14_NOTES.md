# DispatchOPS v35.26 V14 — Bulk Organizer UI / Schedule pass

Scoped changes only:
- Top navigation dropdowns: opening a non-selected group is shaded/hover-like, not blue; selected route remains blue; labels/icons stay white on hover.
- Bulk Organizer driver/helper fields are predictive from Fleet `drivers` / `helpers`, accepting code or name and canonicalizing to the Fleet name. Current-day edits remain day-only; “Use rest of month” persists the selected person to that vehicle's monthly default.
- Invoice entry is customer-linked; Store/Hospital/Warehouse/Other is derived from the customer's existing schedule/building rather than a standalone invoice destination dropdown.
- Added unscheduled invoices (`scheduled_date = null`) as persistent “Waiting for schedule” items.
- Added per-building “Schedule for today” and “Waiting for schedule” glass sections.
- Side Alerts are grouped by Store/Hospital/Warehouse/Other and show one summary row for today plus one waiting row instead of repeating “Today's invoice” for every invoice.
- Enlarged load-plan/customer/invoice typography and glass surfaces for at-a-glance readability.
- Rescheduling an invoice to another date moves it to that date's daily plan.

Dashboard code was not changed.
