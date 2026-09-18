# v35.26 KPI Detail Popup + Bulk Layout Fix

## KPI detail popup
- The KPI click now yields to the browser before starting the detail scan, allowing the existing Glass DetailWindow to paint immediately.
- Detail scanning publishes the first matching batch as soon as it is available, then continues the full scan asynchronously.
- DetailWindow itself renders only 100 rows per page, so the dialog never mounts thousands of invoice rows at once.
- Final scan still updates the exact matching total and full retained result set.

## Navigation
- Active top-nav pill uses the existing application `--blue` accent.
- Active navigation icons are white for contrast.
- Dropdown group triggers expose `aria-expanded` so their active/open state can be styled consistently.
- Sign-out remains inside the top navigation action group.

## Bulk Organizer
- Desktop planning date, fleet section, and customer load plan share a centered content axis.
- Alerts/schedule remains the left rail; customer load plan occupies the wider right side.
- Empty fleet state is centered, including `No vehicles selected` and `Choose vehicles`.
- Customer/store cards remain a responsive grid and collapse to one column on mobile.

## Dark mode
- KPI values are white in dark mode for readability.
- Navigation/action accent remains the same `--blue` in both themes.
