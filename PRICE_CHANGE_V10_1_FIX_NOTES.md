# DispatchOPS Price Change V10.1 Fixes

Applied on top of V10 without removing or changing the existing Price Change workflow.

## Fixed
- Driver signature canvas is initialized cleanly and can be signed immediately; Clear Signature remains available and fully resets the canvas.
- Existing submitted visit fields are pre-filled when editing: customer, area/location, telephone, quantities, pharmacist, notes and No Stock status.
- Existing pharmacy photo and signature are explicitly shown as saved evidence during edit, with Open buttons.
- Driver evidence Open uses a short-lived signed URL authorized by the driver's active portal session and restricted to that driver's storage path.
- Campaign-specific manually entered Price Change areas remain the source for the driver's Area dropdown.
- Price Change admin header now uses the application's normal glass theme variables instead of the separate blue/purple-looking gradient.
- Evidence signing in the admin service now uses the configured Secondary Supabase URL/key instead of a hard-coded endpoint.

## Preserved
- Existing Excel export format and offline attachment folder/link behavior.
- Existing application <-> driver portal relationship and Supabase RPC workflow.
- Existing price-change items, driver assignments, location locking, submissions, reset/delete behavior and activity/results panels.
- Existing logos and overall UI structure.
