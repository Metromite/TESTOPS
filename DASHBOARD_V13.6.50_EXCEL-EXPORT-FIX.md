# V13.6.50 - Dashboard Excel Export Fix

- Restored Dashboard Excel export using the same persistent local analytical dataset used by the working Dashboard.
- Full Dashboard and each individual export view now use the current Dashboard date range and active slicer filters.
- Driver, Area, Division, Vehicle Type, Facility Type, Salesman, Lead Time Band and Classification filters are carried into the exported workbook.
- Valid Invoice KPI in exports uses the existing rule: boxes > 0 OR freezer_boxes > 0.
- Added Filtered Data to individual exports so the downloaded workbook reflects the currently visible filtered dataset.
- No Dashboard rendering, loading, theme, filtering, or data-loading logic was changed.
