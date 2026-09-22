# v35.26 KPI Detail + Bulk Alignment Fix

- KPI detail windows now paginate rendered rows (100 per page) so Valid Invoices, Total Boxes, Freezer Boxes and related KPI dialogs do not mount thousands of `<tr>` elements at once.
- Search and sorting continue to operate on the returned detail set; only the visible page is rendered.
- Top navigation active state uses the existing `--blue` brand accent at full opacity.
- Theme and Sign Out controls are grouped into one right-side command-bar cluster so Sign Out remains inside the top glass bar.
- Bulk Organizer planning date, empty vehicle state, customer load-plan heading/search and store/customer grid are aligned to a common desktop center axis.
