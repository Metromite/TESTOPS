# DispatchOPS Price Change V8

## Live fixes
- Restored EXECUTE grants for the token-authenticated driver portal RPCs on Secondary Supabase.
- Driver data/login/save/delete/logout RPCs are callable by the portal anon/publishable role and still validate the driver session token internally.
- Admin Price Change RPC grants restored for the DispatchOPS manager.
- Price-change evidence Edge Function upgraded to support secure temporary signed URLs for admin viewing/export.

## Driver portal
- Attached City Pharmacy cart image is embedded directly into the standalone portal so it does not depend on a missing `{b64}` placeholder or an external asset.
- Attached PNG is also included at `frontend/public/driver-portal/price-logo-attached.png`.
- Signature Clear now replaces/reinitializes the canvas to guarantee a completely clean canvas.
- No Stock / quantity controls enlarged for mobile drivers.
- Existing menu / submitted-visits workflow retained.

## Admin Price Change Manager
- Driver Activity section shows each driver with submission/assignment counts; clicking a driver filters the completed visits.
- Submitted Results still shows the complete all-driver list.
- View Details now includes driver, date/time, pharmacy details, status, notes, repriced items and temporary evidence viewing links.
- Add All Drivers reactivates existing inactive assignments instead of creating duplicates.
- Remove All Drivers now deactivates assignments instead of deleting them, preserving historical submissions.
- Excel export is now one sheet only: `Price Change Details` with driver, date, time, customer/pharmacy, location, pharmacist, telephone, item, new price, quantity, status, notes, photo link, signature link and lock information.
- Photo/signature links are generated as temporary signed URLs when the Excel is exported.
- Tauri export remains beside the running DispatchOPS executable.
