# DispatchOPS UI / KPI Detail Fixes

Applied to the supplied NEW VERSION source:

- KPI detail popup: force-commits the lightweight dialog before detail scanning, yields before the scan, and ignores stale detail requests. This prevents a large Valid Invoices / Boxes / Freezer detail query from making the click appear frozen.
- KPI detail window: keeps the existing paginated table and progressive first-batch rendering.
- Top navigation: dropdown triggers now expose `aria-expanded`; active/open states use the same blue pill as Dashboard / Route Planning / Bulk Organizer; dropdown active items use blue instead of purple; inactive nav icons no longer turn blue just because the pointer is over the item.
- Top navigation hover: uses the same subtle row highlight treatment as the Dashboard tab strip.
- Bulk Organizer: Today's Schedule alerts and Total/summary KPI cells are flattened so they are not glass cards nested inside the outer glass panel.
- Bulk Organizer: Schedule and Customer Load Plan columns are equal width on desktop instead of a narrow-left / wide-right split.

Validation note: the archive does not include installed frontend dependencies. An `npm install --ignore-scripts --no-audit --no-fund` attempt timed out in the build environment, so a full production build could not be completed here.
