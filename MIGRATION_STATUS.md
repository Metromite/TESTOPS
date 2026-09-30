# DispatchOPS — Supabase Database Status

## Fixed on September 2, 2026

The connected Supabase project **DispatchOPS** (`chrokbnrlvrfejckmzuz`) has been initialized successfully.

Verified tables include:
- `public.sap_invoice_facts`
- `public.landmark_visit_facts`
- `public.import_batches`
- `public.drivers`
- `public.helpers`
- `public.areas`
- `public.vehicles`
- `public.feature_flags`
- and the remaining DispatchOPS configuration/analytics tables.

RLS is enabled on the DispatchOPS public tables and the publishable-key API roles have the required table access for the current internal desktop-app setup.

`feature_flags` contains `dispatchops_initialized = true`.

The original runtime error:

> Could not find the table 'public.sap_invoice_facts' in the schema cache

was caused by the Supabase database schema not having the DispatchOPS migrations applied. The database has now been created and verified.

## App configuration

The frontend is configured for:

`https://chrokbnrlvrfejckmzuz.supabase.co`

The publishable key remains in the frontend environment as intended. No service-role key or database password is embedded in the app.

## Important

The `SUPABASE_DATABASE_SETUP.bat` and SQL files are retained as recovery/documentation tools. **Do not run the setup SQL again on the production DispatchOPS project unless you intentionally need to repair/reset the schema.**

## 2026-09-02 — Final frontend schema audit

The live Supabase project was audited against the frontend's legacy contract. The following missing pieces were repaired in the live database and added to migration `0010_final_frontend_schema_repair.sql`:

- `import_batches`: `storage_bucket`, `storage_path`, `file_size_bytes`, `deleted_at`, `deleted_by`, `label`
- `sap_invoice_facts`: `area`
- `consumer_salesmen`: `assigned_at`, `assigned_by`
- `driver_aliases`: legacy alias/learning fields
- `driver_daily_divisions`: `computed_at`
- `learned_values`: `first_seen`, `last_seen`
- Storage buckets: `wallpaper`, `dispatchops-files`
- Storage object policies required by the desktop client
- Fixed the frontend salesman candidate search so it does not apply `ILIKE` directly to the `jsonb` `learned_values.value` column.

Verification completed after repair: the frontend's expected legacy columns returned no missing-column results, representative Dashboard/SAP/Landmark/Fleet/import queries executed successfully, and the required Storage bucket/policies exist.

V10.1 Price Change fixes: signature immediate-use/reset, edit prefill/evidence preview, driver-authorized evidence viewing, campaign area dropdown synchronization, and unified Price Change header styling. Existing Excel/offline export behavior preserved.
