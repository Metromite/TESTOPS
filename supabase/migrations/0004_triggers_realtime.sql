-- =============================================================================
-- DispatchOPS — Supabase schema migration 4/5: updated_at triggers +
-- Realtime publication
-- =============================================================================

-- ---------------------------------------------------------------------------
-- updated_at trigger — replaces SQLAlchemy's onupdate=datetime.utcnow.
-- Postgres now stamps this on every UPDATE regardless of which PC/client
-- issued it, so it's correct even with multiple machines writing directly.
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'drivers', 'helpers', 'route_assignments',
    'vehicle_driver_manual_mappings', 'ai_provider_config',
    'appearance_config', 'control_center_config', 'route_sheet_layout',
    'feature_flags', 'jobs'
  ]
  loop
    execute format(
      'create trigger trg_%I_updated_at before update on %I
       for each row execute function set_updated_at();',
      t, t
    );
  end loop;
end $$;

-- learned_values and driver_daily_divisions use last_seen/computed_at
-- instead of updated_at (matching the original models) — same mechanism,
-- named triggers per-table since the column name differs.

create or replace function set_last_seen()
returns trigger
language plpgsql
as $$
begin
  new.last_seen = now();
  return new;
end;
$$;
create trigger trg_learned_values_last_seen before update on learned_values
  for each row execute function set_last_seen();
create trigger trg_customer_aliases_last_seen before update on customer_aliases
  for each row execute function set_last_seen();
create trigger trg_driver_aliases_last_seen before update on driver_aliases
  for each row execute function set_last_seen();

create or replace function set_computed_at()
returns trigger
language plpgsql
as $$
begin
  new.computed_at = now();
  return new;
end;
$$;
create trigger trg_driver_daily_divisions_computed_at before update on driver_daily_divisions
  for each row execute function set_computed_at();

-- ---------------------------------------------------------------------------
-- REALTIME PUBLICATION
-- Every table an open DispatchOPS window should live-update from goes into
-- supabase_realtime. Pure historical/log tables (raw_import_rows,
-- sap_invoice_facts, landmark_visit_facts, audit_log) are intentionally
-- left out — they're written once by an import job and read via normal
-- queries/pagination, not something another open window needs pushed to
-- it live. Add them later if a concrete screen needs it.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table
  drivers,
  helpers,
  areas,
  vehicles,
  vehicle_permitted_areas,
  area_anchored_vehicles,
  vacations,
  experience_history,
  area_groups,
  area_group_members,
  vehicle_permitted_area_groups,
  driver_anchored_areas,
  driver_anchored_area_groups,
  route_assignments,
  import_batches,
  vehicle_driver_manual_mappings,
  identity_review_items,
  dashboard_config_rules,
  ai_provider_config,
  appearance_config,
  control_center_config,
  route_sheet_layout,
  feature_flags,
  jobs;
