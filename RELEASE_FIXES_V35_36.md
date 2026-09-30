# DispatchOPS V35.36 — Mixed-Pallet Display + Price Change List Hide

## Bulk Organizer
- Keeps the exact Big-equivalent capacity calculation internally.
- User-facing mixed-pallet totals now use the Big-equivalent value instead of physical pallet count.
- Display rounding is always upward to the nearest 0.5: e.g. 8 Big + 5 Small = 11.33... exact -> 11.5 displayed.
- Schedule-for-today, invoice cards, customer summaries, vehicle invoice loads, and load dialogs now show Big-equivalent totals.
- Physical pallet counts remain available where needed for loading/assignment logic.

## Price Change Portal
- Removed the previous assignment-level Eye/EyeOff hide control.
- Added list-level Hide/Unhide next to each Price Change List in the sidebar.
- Hide changes only `price_change_campaigns.hidden_from_driver_portal`; assignments and submissions are preserved.
- Hidden lists are excluded from the driver portal while remaining visible in the manager sidebar with an Unhide control.
- Hide/Unhide is available in the Price Change Portal UI for both user and admin sessions because the portal route is shared.
- Download progress starts immediately on click.
- ZIP compression uses a lower DEFLATE level to reduce waiting time while preserving the existing output structure.

## Supabase
- Secondary live database updated with `hidden_from_driver_portal` and the list-level driver filtering RPC.
- Local migration: `0055_price_change_list_level_hide.sql`.
