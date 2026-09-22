# Price Change V7 fixes

- Driver portal uses the supplied City Pharmacy cart logo as the actual portal logo (embedded in the standalone HTML; source PNG also included as `frontend/public/price-change-logo.png`).
- Password is no longer prefilled. Credentials are stored only when the driver checks Save username & password on this device.
- Signature Clear fully resets the backing canvas and no longer has an asynchronous redraw that can restore cleared pixels.
- Evidence uploads send raw Base64 and the existing Supabase upload function accepts the payload without a data-URI decoding failure.
- Driver portal has a hamburger menu with New submission, My submitted visits, and Refresh assignments. Submitted visits remain available for editing.
- Quantity / No Stock controls are larger and easier to use on phones.
- Driver portal receives submitted visit line quantities from Supabase so editing a visit restores the entered quantities.
- Admin can Save all, Lock all locations, Unlock all locations, Clear all customer names, Add all drivers, and Remove all drivers.
- Location lock is enforced both in the UI and server-side; locked location is not editable by the driver.
- Admin submitted-results view has View details for each visit and now receives the visit item quantities.
- Price Change Excel export uses the existing Tauri desktop export bridge and saves beside the running DispatchOPS executable, matching the app's other Excel exports. Browser fallback remains normal browser download.
- Live Secondary Supabase received migrations for admin delete/reset RPCs, visit detail payloads, and status persistence.
