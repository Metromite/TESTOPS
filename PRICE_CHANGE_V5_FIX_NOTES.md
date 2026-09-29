# Price Change V5 Fix

- Fixed Supabase pgcrypto `digest()` resolution by pinning Price Change RPC search_path to `public, extensions, pg_temp`.
- Driver portal now reports exactly which required field is missing instead of combining customer/location/pharmacist into one message.
- Signature Clear fully resets the backing canvas regardless of device pixel ratio or prior resize transforms.
- Admin location lock is persisted immediately when toggled; the driver portal renders the field readonly/disabled and the server enforces the locked value.
- Added Add all drivers and Remove all drivers actions.
- Existing Price Change workflow remains: dynamic items with item name + new price, server-side visit timestamp, driver-only assigned data, photo/no-stock rules.
