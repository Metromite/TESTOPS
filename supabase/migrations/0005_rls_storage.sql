-- =============================================================================
-- DispatchOPS — Supabase schema migration 5/5: Row Level Security + Storage
--
-- TRUST MODEL (flagging this explicitly — it's the key decision in this
-- migration): the architecture brief removes the local username/password
-- login entirely and mandates the frontend use only the anon/publishable
-- key. There is no other identity layer. So for this internal company
-- app, "possession of the anon key" (i.e. running the officially
-- distributed DispatchOPS.exe) IS the access control — the same trust
-- model the old app effectively had (anyone who could run the EXE could
-- reach the local backend). RLS is still enabled on every table (so nothing
-- is ever accidentally public to the internet at large / Supabase's default
-- posture), with an explicit policy granting the `anon` role full
-- select/insert/update/delete. If you later want per-user restrictions
-- (e.g. read-only Viewer role), that needs Supabase Auth wired into the
-- app, which is a bigger change than this migration — flag it and we can
-- scope that separately.
--
-- ⚠️ SECRETS WARNING: ai_provider_config.api_key / fallback_key columns
-- are kept for schema compatibility with the old model, but under this
-- trust model anything in this table is readable by anyone with the
-- distributed anon key (extractable from the packaged EXE with `strings`).
-- Do NOT put real provider API keys in these columns. The Phase-3 AI
-- settings service should keep provider/model/fallback-chain STRUCTURE in
-- this table (so it syncs) and keep actual key values in the existing
-- local_config.json / Tauri local storage per PC (matching the old
-- architecture's already-solved design — keys never synced, structure
-- matched by position). This is called out again in the frontend build
-- notes so it isn't silently forgotten.
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'drivers', 'helpers', 'areas', 'vehicles',
    'vehicle_permitted_areas', 'area_anchored_vehicles',
    'vacations', 'experience_history',
    'area_groups', 'area_group_members', 'vehicle_permitted_area_groups',
    'driver_anchored_areas', 'driver_anchored_area_groups',
    'route_assignments',
    'import_batches', 'raw_import_rows',
    'sap_invoice_facts', 'landmark_visit_facts', 'vehicle_driver_manual_mappings',
    'customer_aliases', 'driver_aliases', 'identity_review_items', 'correlation_results',
    'learned_values',
    'consumer_salesmen', 'driver_daily_divisions',
    'dashboard_config_rules',
    'ai_provider_config', 'appearance_config', 'control_center_config', 'route_sheet_layout',
    'feature_flags', 'audit_log', 'jobs'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy %I on %I for all to anon, authenticated using (true) with check (true);',
      'allow_app_access_' || t, t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- STORAGE
-- Two buckets: `wallpaper` for shared appearance assets, and
-- `dispatchops-files` for every original uploaded SAP/V-Zone/Excel/CSV
-- source file (per the file-storage brief: originals live in Storage,
-- never as a binary column in Postgres; Postgres holds only the
-- metadata row in import_batches - see migration 0006). Both private;
-- access goes through the anon key like everything else in this app,
-- matching the trust model above.
--
-- `dispatchops-files` objects are organized as
-- imports/<SOURCE_TYPE>/<yyyy>/<mm>/<dd>/<uuid>_<original filename> (see
-- uploadImportSourceFile() in frontend/src/services/imports.ts) so two
-- files with the same name never collide, and NOTHING in this schema or
-- the app ever deletes or overwrites an object here automatically -
-- deletion is only ever a direct, explicit, user-confirmed action
-- (deleteImportFile() in imports.ts). Do not add an automatic
-- cleanup/retention job against this bucket.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values
  ('wallpaper', 'wallpaper', false),
  ('dispatchops-files', 'dispatchops-files', false)
on conflict (id) do nothing;

create policy "allow_app_access_wallpaper"
on storage.objects for all
to anon, authenticated
using (bucket_id = 'wallpaper')
with check (bucket_id = 'wallpaper');

create policy "allow_app_access_dispatchops_files"
on storage.objects for all
to anon, authenticated
using (bucket_id = 'dispatchops-files')
with check (bucket_id = 'dispatchops-files');
