-- =============================================================================
-- RUN_ALL_MIGRATIONS.sql — every migration (0001-0006) concatenated in
-- order. Paste this whole file into the Supabase dashboard's SQL Editor
-- (DispatchOPS project, chrokbnrlvrfejckmzuz) and run it once. Safe to
-- run on a fresh project only — this creates tables from scratch, it
-- does not handle re-running against an already-migrated database. The
-- individual 0001-0006 files in this same folder are kept as the
-- source of truth / for review; this file is just their concatenation
-- for convenience.
-- =============================================================================

-- =============================================================================
-- DispatchOPS — Supabase schema migration 1/5: core tables
-- Project: DispatchOPS (ref chrokbnrlvrfejckmzuz, ap-southeast-1)
--
-- Ported directly from the existing FastAPI/SQLAlchemy models in
-- backend/app/models/*.py. Field names and semantics are preserved 1:1
-- so existing business logic (route_planner scoring, dashboard KPIs,
-- correlation engine) needs no field-name translation when it's ported.
--
-- DESIGN DECISIONS made in this migration (flagging explicitly, not
-- burying them):
--   1. Every table gets a `uuid` primary key (gen_random_uuid()) instead
--      of the old integer autoincrement id. This replaces the old app's
--      ad-hoc `sync_uid` workaround on Vacation/ExperienceHistory/
--      RouteAssignment (those tables added a UUID column specifically
--      because an integer id couldn't safely identify a row created on
--      two different PCs) — with Supabase as the single source of
--      truth, every row is created in exactly one place, so this is no
--      longer needed anywhere; the primary key IS the sync identity.
--   2. Foreign keys that were already real FK columns in the old schema
--      (vehicle_permitted_areas, area_anchored_vehicles, area_groups,
--      driver_anchored_areas, etc.) keep being real FKs, now against
--      uuid ids.
--   3. Relationships that were ALWAYS free-text codes in the old schema
--      (SapInvoiceFact.driver_code, ExperienceHistory.person_code,
--      RouteAssignment.driver_code, Vacation.person_code, etc.) are kept
--      as free-text columns, not converted to FKs. This matches the
--      original design (SAP/Landmark data references people by code
--      string, not by internal id, and a code can appear before the
--      matching Driver/Helper row exists) and avoids introducing new
--      failure modes the original app never had.
--   4. `updated_at` triggers (migration 0002) replace SQLAlchemy's
--      onupdate=datetime.utcnow — Postgres now owns that responsibility
--      so it's correct regardless of which PC or client wrote the row.
-- =============================================================================

create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- FLEET: drivers, helpers, areas, vehicles + their association tables
-- ---------------------------------------------------------------------------

create table drivers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  veh_type text not null default '',
  anchor_area text not null default '',       -- comma-separated, legacy free-text form
  health_card text not null default 'No',
  division text not null default '',
  preferred_helper text not null default '',
  status text not null default 'Active',
  updated_at timestamptz not null default now()
);
create index ix_drivers_code on drivers (code);

create table helpers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  anchor_area text not null default '',
  health_card text not null default 'No',
  division text not null default '',
  status text not null default 'Active',
  updated_at timestamptz not null default now()
);
create index ix_helpers_code on helpers (code);

create table areas (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  sector text not null default 'Pharma',      -- Division: Pharma / Consumer
  region text not null default '',            -- kept for data preservation only, not used by the app
  needs_driver text not null default 'Mandatory',
  needs_helper text not null default 'Optional',
  route_type text not null default 'Main Route',
  vehicle_type text not null default 'Van',
  constraint uq_areas_code_name_division unique (code, name, sector)
);
create index ix_areas_code on areas (code);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  type text not null default 'VAN',           -- multi-select, " / "-joined, e.g. "VAN / PICK-UP"
  division text not null default '',
  status text not null default 'Active'       -- "Under Service" excludes it, per original app
);
create index ix_vehicles_number on vehicles (number);

create table vehicle_permitted_areas (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  area_id uuid not null references areas(id) on delete cascade,
  constraint uq_vehicle_permitted_area unique (vehicle_id, area_id)
);
create index ix_vpa_vehicle on vehicle_permitted_areas (vehicle_id);
create index ix_vpa_area on vehicle_permitted_areas (area_id);

create table area_anchored_vehicles (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references areas(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  constraint uq_area_anchored_vehicle unique (area_id, vehicle_id)
);
create index ix_aav_area on area_anchored_vehicles (area_id);
create index ix_aav_vehicle on area_anchored_vehicles (vehicle_id);

create table vacations (
  id uuid primary key default gen_random_uuid(),
  person_code text not null,
  person_name text not null default '',
  person_type text not null default 'Driver', -- "Driver" | "Helper"
  start_date date not null,
  end_date date not null
);
create index ix_vacations_person_code on vacations (person_code);

create table experience_history (
  id uuid primary key default gen_random_uuid(),
  person_code text not null,
  person_name text not null default '',
  person_type text not null default 'Driver', -- "Driver" | "Helper"
  area text not null,
  sector text not null default 'Pharma',
  date date not null,                          -- stint start date
  end_date date,                                -- null while ongoing
  vehicle_number text not null default ''
);
create index ix_experience_history_person_code on experience_history (person_code);

-- ---------------------------------------------------------------------------
-- AREA GROUPS + structured anchoring (extends the plain association tables
-- above; see area_groups.py docstring — group membership is never
-- "flattened", the app expands it at read time)
-- ---------------------------------------------------------------------------

create table area_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table area_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references area_groups(id) on delete cascade,
  area_id uuid not null references areas(id) on delete cascade,
  constraint uq_area_group_member unique (group_id, area_id)
);
create index ix_agm_group on area_group_members (group_id);
create index ix_agm_area on area_group_members (area_id);

create table vehicle_permitted_area_groups (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  group_id uuid not null references area_groups(id) on delete cascade,
  constraint uq_vehicle_permitted_area_group unique (vehicle_id, group_id)
);
create index ix_vpag_vehicle on vehicle_permitted_area_groups (vehicle_id);
create index ix_vpag_group on vehicle_permitted_area_groups (group_id);

create table driver_anchored_areas (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers(id) on delete cascade,
  area_id uuid not null references areas(id) on delete cascade,
  sort_order integer not null default 0,
  constraint uq_driver_anchored_area unique (driver_id, area_id)
);
create index ix_daa_driver on driver_anchored_areas (driver_id);
create index ix_daa_area on driver_anchored_areas (area_id);

create table driver_anchored_area_groups (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers(id) on delete cascade,
  group_id uuid not null references area_groups(id) on delete cascade,
  sort_order integer not null default 0,
  constraint uq_driver_anchored_area_group unique (driver_id, group_id)
);
create index ix_daag_driver on driver_anchored_area_groups (driver_id);
create index ix_daag_group on driver_anchored_area_groups (group_id);

-- ---------------------------------------------------------------------------
-- ROUTE PLANNING: output of the driver/helper assignment scoring engine
-- ---------------------------------------------------------------------------

create table route_assignments (
  id uuid primary key default gen_random_uuid(),
  plan_batch_id text not null,                 -- groups one generated plan run
  plan_role text not null default 'driver',    -- "driver" | "helper" — independent planners

  area_code text not null,
  area_name text not null,
  sector text not null,
  route_type text not null default 'Main Route',
  driver_requirement text not null default 'Mandatory',
  helper_requirement text not null default 'Optional',

  driver_code text not null default '',
  driver_name text not null default '',
  helper_code text not null default '',
  helper_name text not null default '',
  vehicle_number text not null default '',
  vehicle_type text not null default '',
  anchored_vehicle_number text not null default '',
  vehicle_assignment_reason text not null default '',

  start_date date not null,
  end_date date not null,

  driver_score integer not null default 0,
  driver_reason text not null default '',
  helper_score integer not null default 0,
  helper_reason text not null default '',

  assignment_reason text not null default '',
  restrictions_considered text not null default '',

  is_vacation_replacement boolean not null default false,
  original_person_code text not null default '',
  original_person_name text not null default '',
  vacation_start_date date,
  vacation_end_date date,
  vacation_replacement_reason text not null default '',

  is_manually_edited boolean not null default false,
  status text not null default 'Pending',      -- Pending / Confirmed / Shortage
  sort_order integer not null default 0,

  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_route_assignments_batch on route_assignments (plan_batch_id);
create index ix_route_assignments_role on route_assignments (plan_role);
-- =============================================================================
-- DispatchOPS — Supabase schema migration 2/5: imports, analytics facts,
-- correlation engine, master-data learning, dashboard config rules
-- =============================================================================

-- ---------------------------------------------------------------------------
-- IMPORT BATCHES (new — the old app tracked batch_id as a bare string
-- column on several tables with no owning row of its own; this migration
-- adds a real import_batches table per architecture-brief section 8, and
-- every batch_id column below is now a proper FK against it)
-- ---------------------------------------------------------------------------

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,                   -- "sap" | "landmark" | "excel" | "csv" | other declared import kinds
  original_filename text not null default '',
  imported_by text not null default '',
  imported_by_device text not null default '',
  imported_at timestamptz not null default now(),
  row_count integer not null default 0,
  success_count integer not null default 0,
  failed_count integer not null default 0,
  validation_errors jsonb not null default '[]'::jsonb,
  status text not null default 'pending'       -- pending | processing | completed | failed | partial
);
create index ix_import_batches_source_type on import_batches (source_type);
create index ix_import_batches_status on import_batches (status);

create table raw_import_rows (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,                    -- "sap" | "landmark"
  batch_id uuid not null references import_batches(id) on delete cascade,
  source_filename text not null default '',
  row_index integer not null default 0,
  row_json jsonb not null,                       -- raw row, untouched/unmutated
  imported_at timestamptz not null default now(),
  imported_by text not null default '',
  label text not null default ''
);
create index ix_raw_import_rows_batch on raw_import_rows (batch_id);

-- ---------------------------------------------------------------------------
-- ANALYTICS FACTS: parsed SAP invoice / Landmark GPS visit output
-- ---------------------------------------------------------------------------

create table sap_invoice_facts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references import_batches(id) on delete set null,

  invoice_date date,
  dispatch_date date,
  dispatch_num text not null default '',
  invoice_no text not null,
  driver_code text not null default '',
  driver_name text not null default '',
  helper_code text not null default '',
  helper_name text not null default '',
  vehicle_num text not null default '',
  vehicle_key text not null default '',
  customer_name text not null default '',
  customer_name_source text not null default '',
  remarks text not null default '',
  address text not null default '',
  area text not null default '',
  boxes integer not null default 0,
  normal_boxes integer not null default 0,
  freezer_boxes integer not null default 0,
  not_supplied_reason text not null default '',
  division_desc text not null default '',
  txn_code text not null default '',
  facility_type text not null default '',
  vehicle_type text not null default '',
  salesman text not null default '',
  box_entry_time text not null default '',
  source_file text not null default '',
  imported_at timestamptz not null default now()
);
create index ix_sap_invoice_facts_batch on sap_invoice_facts (batch_id);
create index ix_sap_invoice_facts_invoice_no on sap_invoice_facts (invoice_no);
create index ix_sap_invoice_facts_driver_code on sap_invoice_facts (driver_code);
create index ix_sap_invoice_facts_driver_name on sap_invoice_facts (driver_name);
create index ix_sap_invoice_facts_vehicle_key on sap_invoice_facts (vehicle_key);
create index ix_sap_invoice_facts_area on sap_invoice_facts (area);
create index ix_sap_invoice_facts_division_desc on sap_invoice_facts (division_desc);
create index ix_sap_invoice_facts_facility_type on sap_invoice_facts (facility_type);
create index ix_sap_invoice_facts_salesman on sap_invoice_facts (salesman);
create index ix_sap_invoice_facts_invoice_date on sap_invoice_facts (invoice_date);
create index ix_sap_invoice_facts_dispatch_date on sap_invoice_facts (dispatch_date);

create table landmark_visit_facts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references import_batches(id) on delete set null,

  driver_name text not null default '',
  customer_name text not null default '',
  vehicle_raw text not null default '',
  vehicle_key text not null default '',
  arrival text not null default '',
  departure text not null default '',
  duration text not null default '',
  minutes integer not null default 0,
  is_delivery boolean not null default false,
  is_passthrough boolean not null default false,
  is_depot boolean not null default false,
  source_file text not null default '',
  imported_at timestamptz not null default now()
);
create index ix_landmark_visit_facts_batch on landmark_visit_facts (batch_id);
create index ix_landmark_visit_facts_vehicle_key on landmark_visit_facts (vehicle_key);

create table vehicle_driver_manual_mappings (
  vehicle_key text primary key,
  sap_driver text not null,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- CUSTOMER/DRIVER IDENTITY RESOLUTION (correlation engine)
-- ---------------------------------------------------------------------------

create table customer_aliases (
  sap_name_normalized text not null,
  landmark_name_normalized text not null,
  sap_name_original text not null default '',
  landmark_name_original text not null default '',
  times_confirmed integer not null default 1,
  best_confidence double precision not null default 0,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (sap_name_normalized, landmark_name_normalized)
);

create table driver_aliases (
  sap_driver_normalized text primary key,
  sap_driver_original text not null default '',
  landmark_driver_name text not null default '',
  confidence double precision not null default 0,
  times_confirmed integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table identity_review_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references import_batches(id) on delete set null,
  role text not null,                            -- Driver | Helper
  sap_code text not null,
  sap_name text not null,
  area text not null default '',
  date date,
  vehicle text not null default '',
  confidence double precision not null default 0,
  reason text not null default '',
  suggested_code text not null default '',
  suggested_name text not null default '',
  status text not null default 'pending',        -- pending | linked | new | skipped
  created_at timestamptz not null default now()
);
create index ix_identity_review_items_batch on identity_review_items (batch_id);
create index ix_identity_review_items_status on identity_review_items (status);

create table correlation_results (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references import_batches(id) on delete set null,
  invoice_no text not null default '',
  sap_customer_name text not null default '',
  matched_landmark_name text not null default '',
  confidence double precision not null default 0,
  needs_review boolean not null default false,
  review_reason text not null default '',
  evidence jsonb not null default '{}'::jsonb,
  driver_name text not null default '',
  date date,
  created_at timestamptz not null default now()
);
create index ix_correlation_results_batch on correlation_results (batch_id);

-- ---------------------------------------------------------------------------
-- MASTER DATA LEARNING (autocomplete suggestion cache for Customer/Salesman)
-- ---------------------------------------------------------------------------

create table learned_values (
  id uuid primary key default gen_random_uuid(),
  category text not null,                        -- "customer" | "salesman"
  value text not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  constraint uq_learned_value_category_value unique (category, value)
);
create index ix_learned_values_category on learned_values (category);
create index ix_learned_values_value on learned_values (value);

-- ---------------------------------------------------------------------------
-- SALESMAN CATEGORIZATION + DIVISION DETECTION
-- ---------------------------------------------------------------------------

create table consumer_salesmen (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  assigned_by text not null default '',
  assigned_at timestamptz not null default now()
);

create table driver_daily_divisions (
  id uuid primary key default gen_random_uuid(),
  person_code text not null,
  person_name text not null default '',
  work_date date not null,
  division text not null default 'Pharma',       -- "Consumer" or "Pharma"
  consumer_invoices integer not null default 0,
  pharma_invoices integer not null default 0,
  computed_at timestamptz not null default now(),
  constraint uq_driver_daily_division unique (person_code, work_date)
);
create index ix_driver_daily_divisions_person on driver_daily_divisions (person_code);

-- ---------------------------------------------------------------------------
-- DASHBOARD CONFIGURATION RULE ENGINE
-- ---------------------------------------------------------------------------

create table dashboard_config_rules (
  id uuid primary key default gen_random_uuid(),
  rule_type text not null,                        -- invoice_prefix|area|customer|facility|salesman|driver|vehicle_type|route_type|invoice_range|invoice_type|custom|setting
  value text not null,
  note text not null default '',
  operator text not null default 'contains',       -- contains|starts_with|ends_with|exact|regex|gt|lt
  negate boolean not null default false,
  logic text not null default 'OR',                -- AND|OR vs siblings of same rule_type
  created_by text not null default '',
  created_at timestamptz not null default now(),
  constraint uq_dashboard_config_rule unique (rule_type, value)
);
create index ix_dashboard_config_rules_type on dashboard_config_rules (rule_type);
-- =============================================================================
-- DispatchOPS — Supabase schema migration 3/5: shared settings singletons,
-- feature flags, audit log, background jobs
-- =============================================================================

-- ---------------------------------------------------------------------------
-- SHARED SETTINGS SINGLETONS
-- Each of these was a single "row id=1" table in the old app. Kept as a
-- singleton pattern here too (a check constraint pins id to a fixed UUID
-- so there is never more than one row and every PC reads/writes the same
-- one) rather than switching to key/value — this preserves the shape the
-- rest of the app already expects (one JSON blob per settings surface).
-- ---------------------------------------------------------------------------

create table ai_provider_config (
  id uuid primary key default '00000000-0000-0000-0000-000000000001'::uuid,
  provider text not null default 'groq',
  model text not null default '',
  api_key text not null default '',              -- per-provider key/endpoint; see RLS note in 0004 — never exposed to unauthenticated clients
  fallback_enabled boolean not null default false,
  fallback_provider text not null default 'ollama',
  fallback_model text not null default '',
  fallback_key text not null default '',
  fallback_chain jsonb not null default '[]'::jsonb,  -- [{provider, model, api_key}, ...] tried in order after the primary fails
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  constraint chk_ai_provider_config_singleton check (id = '00000000-0000-0000-0000-000000000001'::uuid)
);

create table appearance_config (
  id uuid primary key default '00000000-0000-0000-0000-000000000001'::uuid,
  light_bg_path text not null default '',         -- Supabase Storage path, not a local file path
  dark_bg_path text not null default '',
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  constraint chk_appearance_config_singleton check (id = '00000000-0000-0000-0000-000000000001'::uuid)
);

create table control_center_config (
  id uuid primary key default '00000000-0000-0000-0000-000000000001'::uuid,
  config jsonb not null default '{}'::jsonb,      -- playlists, scheduler entries, branding, display assignments
  version integer not null default 1,             -- incremented on every write; API can still detect a stale write and refuse with 409 if desired
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  constraint chk_control_center_config_singleton check (id = '00000000-0000-0000-0000-000000000001'::uuid)
);

create table route_sheet_layout (
  id uuid primary key default '00000000-0000-0000-0000-000000000001'::uuid,
  column_order jsonb not null default '[]'::jsonb,
  hidden_columns jsonb not null default '[]'::jsonb,
  column_widths jsonb not null default '{}'::jsonb,
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  constraint chk_route_sheet_layout_singleton check (id = '00000000-0000-0000-0000-000000000001'::uuid)
);

-- ---------------------------------------------------------------------------
-- FEATURE FLAGS
-- ---------------------------------------------------------------------------

create table feature_flags (
  name text primary key,
  enabled boolean not null default false,
  description text not null default '',
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- AUDIT LOG
-- ---------------------------------------------------------------------------

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,                       -- e.g. "driver", "helper", "area"
  entity_key text not null,                         -- the natural key (code/number/id) affected
  action text not null,                              -- "create" | "update" | "delete"
  actor text not null default '',
  before_state jsonb not null default '{}'::jsonb,   -- empty for create
  after_state jsonb not null default '{}'::jsonb,    -- empty for delete
  success boolean not null default true,
  error_message text not null default '',
  duration_ms integer not null default 0,
  undone boolean not null default false,
  "timestamp" timestamptz not null default now()
);
create index ix_audit_log_entity on audit_log (entity_type, entity_key);
create index ix_audit_log_timestamp on audit_log ("timestamp");

-- ---------------------------------------------------------------------------
-- BACKGROUND JOBS
-- Every long-running operation (SAP import, correlation, route plan
-- generation, analytics rebuild) creates one row here and updates it as
-- it runs. In the old architecture the frontend polled/SSE'd this from
-- the local FastAPI backend; in the new architecture the frontend
-- subscribes to this table via Supabase Realtime instead (see the
-- Realtime manager in Phase 4) — same UX (kick off, get a job id back,
-- watch progress separately), different transport.
-- ---------------------------------------------------------------------------

create table jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,                            -- sap_import | landmark_import | correlation | route_plan_generation | analytics_rebuild | ...
  status text not null default 'queued',              -- queued | running | completed | failed
  progress integer not null default 0,                -- 0-100
  message text not null default '',
  result jsonb,
  error text,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_jobs_status on jobs (status);
create index ix_jobs_type on jobs (job_type);
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
-- =============================================================================
-- DispatchOPS — Supabase schema migration 6/6: Storage metadata on
-- import_batches
--
-- Per the file-storage architecture: the original uploaded SAP/V-Zone/
-- Excel/CSV file always goes to the `dispatchops-files` Storage bucket
-- (never as a binary column here), and this table row is its metadata
-- record — file identity/location, not file content.
-- =============================================================================

alter table import_batches
  add column storage_bucket text not null default 'dispatchops-files',
  add column storage_path text,                 -- null until the upload step completes; see imports.ts
  add column file_size_bytes bigint,
  add column deleted_at timestamptz,             -- set only by an explicit, user-confirmed manual delete — never by any automatic process (see 0005's storage-bucket comment)
  add column deleted_by text;

create index ix_import_batches_storage_path on import_batches (storage_path);

comment on column import_batches.deleted_at is
  'Manual delete only. There is no automatic cleanup/retention job anywhere in this schema or the app — do not add one against this column or the dispatchops-files bucket.';

-- 0007_migration_completion.sql is intentionally kept as a separate migration for Supabase CLI deployments.


-- ===================== MIGRATION 0007: MIGRATION COMPLETION =====================
-- DispatchOPS migration completion: import labels, portable backups, and realtime-friendly metadata.
alter table import_batches add column if not exists label text not null default '';

create table if not exists app_backups (
  id uuid primary key default gen_random_uuid(),
  label text not null default '',
  created_at timestamptz not null default now(),
  created_by text not null default '',
  payload jsonb not null default '{}'::jsonb,
  row_count integer not null default 0
);

create index if not exists ix_app_backups_created_at on app_backups(created_at desc);

-- Realtime is intentionally limited to shared operational tables only.
do $$ begin
  alter publication supabase_realtime add table route_assignments;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table vacations;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table drivers;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table helpers;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table vehicles;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table import_batches;
exception when duplicate_object then null; end $$;

-- DispatchOPS final frontend/schema repair. Safe to run repeatedly.
-- Repairs compatibility columns that were present in the source migrations but
-- were missing from the live Supabase project, plus Storage buckets/policies.

alter table public.import_batches
  add column if not exists storage_bucket text not null default 'dispatchops-files',
  add column if not exists storage_path text,
  add column if not exists file_size_bytes bigint,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists label text not null default '';

alter table public.sap_invoice_facts
  add column if not exists area text;

alter table public.consumer_salesmen
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by text;

alter table public.driver_aliases
  add column if not exists confidence double precision,
  add column if not exists first_seen timestamptz,
  add column if not exists landmark_driver_name text,
  add column if not exists last_seen timestamptz,
  add column if not exists sap_driver_normalized text,
  add column if not exists sap_driver_original text,
  add column if not exists times_confirmed integer;

alter table public.driver_daily_divisions
  add column if not exists computed_at timestamptz;

alter table public.learned_values
  add column if not exists first_seen timestamptz,
  add column if not exists last_seen timestamptz;


create index if not exists ix_import_batches_storage_path on public.import_batches(storage_path);

insert into storage.buckets (id,name,public)
values ('wallpaper','wallpaper',false),('dispatchops-files','dispatchops-files',false)
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='allow_app_access_wallpaper') then
    create policy allow_app_access_wallpaper on storage.objects for all to anon, authenticated
      using (bucket_id='wallpaper') with check (bucket_id='wallpaper');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='allow_app_access_dispatchops_files') then
    create policy allow_app_access_dispatchops_files on storage.objects for all to anon, authenticated
      using (bucket_id='dispatchops-files') with check (bucket_id='dispatchops-files');
  end if;
end $$;

-- 0011: import upsert conflict alignment
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.driver_daily_divisions'::regclass
      AND conname = 'driver_daily_divisions_person_code_work_date_key'
  ) THEN
    ALTER TABLE public.driver_daily_divisions
      ADD CONSTRAINT driver_daily_divisions_person_code_work_date_key
      UNIQUE (person_code, work_date);
  END IF;
END $$;

-- ===================== MIGRATION 0014: UNIFIED DASHBOARD SNAPSHOT =====================
-- See supabase/migrations/0014_dashboard_unified_snapshot.sql. This server-side
-- aggregate keeps the desktop dashboard responsive as SAP/V-Zone history grows.
-- Unified dashboard snapshot: one indexed server-side pass per Supabase project.
-- The desktop app receives only compact aggregates instead of downloading all SAP/GPS rows.
create or replace function public.dispatchops_dashboard_snapshot(p_start date default null, p_end date default null, p_filters jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
as $$
with base as (
  select s.invoice_no,s.invoice_date,s.dispatch_date,s.driver_name,s.customer_name,
         coalesce(s.facility_type,'') facility_type,coalesce(s.area,'') area,
         coalesce(s.division_desc,'') division_desc,coalesce(s.vehicle_type,'') vehicle_type,
         coalesce(s.vehicle_key,'') vehicle_key,coalesce(s.vehicle_num,'') vehicle_num,
         coalesce(s.boxes,0) boxes,coalesce(s.normal_boxes,0) normal_boxes,
         coalesce(s.freezer_boxes,0) freezer_boxes,coalesce(s.not_supplied_reason,'') not_supplied_reason,
         coalesce(s.salesman,'') salesman,
         (s.dispatch_date-s.invoice_date) days
  from public.sap_invoice_facts s
  where (p_start is null or s.dispatch_date>=p_start)
    and (p_end is null or s.dispatch_date<=p_end)
    and (nullif(p_filters->>'driver','') is null or s.driver_name=p_filters->>'driver')
    and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 or s.driver_name in (select jsonb_array_elements_text(p_filters->'drivers')))
    and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or s.area in (select jsonb_array_elements_text(p_filters->'areas')))
    and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
    and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or s.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type')))
    and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
    and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman')))
    and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
    and (lower(trim(coalesce(s.facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') or lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown'))
    and (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 or exists(select 1 from public.areas a where (a.code=s.area or a.name=s.area) and a.route_type in (select jsonb_array_elements_text(p_filters->'route_type'))))
), lead as (
  select * from base
  where invoice_date is not null and dispatch_date is not null and days>=0
    and (nullif(p_filters->>'lead_time_band','') is null or (case when days<=0 then '0 Days' when days=1 then '1 Day' when days<=5 then days||' Days' else 'More than 5 Days' end)=p_filters->>'lead_time_band')
    and (nullif(p_filters->>'classification','') is null or case when lower(trim(coalesce(facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then facility_type when lower(trim(coalesce(division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then division_desc end=p_filters->>'classification')
),
lead_class as (
 select coalesce(jsonb_agg(jsonb_build_object('name',class,'orders',orders,'avg_days',avg_days,'min_days',min_days,'max_days',max_days) order by class),'[]'::jsonb) v
 from (select case when lower(trim(coalesce(facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then facility_type when lower(trim(coalesce(division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then division_desc end class,count(*) orders,round(avg(days)::numeric,2) avg_days,min(days) min_days,max(days) max_days from lead group by 1)x
),
lead_stats as (select count(*) total,round(avg(days)::numeric,2) avg_days,min(days) min_days,max(days) max_days from lead),
lead_bands as (
 select b band,coalesce((select count(*) from lead s where (case when s.days<=0 then '0 Days' when s.days=1 then '1 Day' when s.days<=5 then s.days||' Days' else 'More than 5 Days' end)=b),0) n
 from unnest(array['0 Days','1 Day','2 Days','3 Days','4 Days','5 Days','More than 5 Days']) b
),
lead_classes as (select coalesce(jsonb_agg(class order by class),'[]'::jsonb) v from (select distinct case when lower(trim(coalesce(facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then facility_type when lower(trim(coalesce(division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then division_desc end class from lead)x),
lead_matrix as (
 select coalesce(jsonb_agg(jsonb_build_object('band',b.band,'counts',(select coalesce(jsonb_object_agg(class,n),'{}'::jsonb) from (select case when lower(trim(coalesce(facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then facility_type when lower(trim(coalesce(division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then division_desc end class,count(*) n from lead s where (case when s.days<=0 then '0 Days' when s.days=1 then '1 Day' when s.days<=5 then s.days||' Days' else 'More than 5 Days' end)=b.band group by 1)z),'total',b.n) order by array_position(array['0 Days','1 Day','2 Days','3 Days','4 Days','5 Days','More than 5 Days'],b.band)),'[]'::jsonb) v from lead_bands b
),
fast as (select coalesce(jsonb_agg(to_jsonb(t) order by t.days,t.dispatch_date),'[]'::jsonb) v from (select invoice_no,driver_name,customer_name,invoice_date,dispatch_date,days from lead order by days,dispatch_date limit 100)t),
slow as (select coalesce(jsonb_agg(to_jsonb(t) order by t.days desc,t.dispatch_date desc),'[]'::jsonb) v from (select invoice_no,driver_name,customer_name,invoice_date,dispatch_date,days from lead order by days desc,dispatch_date desc limit 100)t),

ord as (
 select nullif(driver_name,'') driver,coalesce(nullif(facility_type,''),'Unclassified') facility,count(*) n from base group by 1,2
),
facilities as (select coalesce(jsonb_agg(facility order by facility),'[]'::jsonb) v from (select distinct facility from ord)x),
order_rows as (
 select coalesce(jsonb_agg(jsonb_build_object('driver',d.driver,'by_facility',(select coalesce(jsonb_agg(coalesce((select n from ord o2 where o2.driver=d.driver and o2.facility=f.facility),0) order by f.facility),'[]'::jsonb) from (select distinct facility from ord) f),'total',(select coalesce(sum(n),0) from ord o3 where o3.driver=d.driver)) order by d.driver),'[]'::jsonb) v from (select distinct driver from ord)d
),

areas_agg as (
 select nullif(area,'') area,count(*) orders,sum(boxes) boxes,sum(freezer_boxes) freezer,count(*) filter(where not_supplied_reason<>'') returns,count(distinct driver_name) drivers
 from base group by 1
),
area_table as (select coalesce(jsonb_agg(jsonb_build_object('area',area,'orders',orders,'boxes',boxes,'freezer',freezer,'returns',returns,'drivers',drivers,'success_pct',case when orders>0 then round((orders-returns)::numeric/orders*10000)/100 else 0 end) order by area),'[]'::jsonb) v from areas_agg),
area_weeks as (
 select to_char(date_trunc('week',dispatch_date),'YYYY-MM-DD') week,nullif(area,'') area,count(*) n from base group by 1,2
),
area_names as (select coalesce(jsonb_agg(distinct area order by area),'[]'::jsonb) v from areas_agg),
weekly as (select coalesce(jsonb_agg(jsonb_build_object('week',w.week,'by_area',(select coalesce(jsonb_agg(coalesce((select n from area_weeks w2 where w2.week=w.week and w2.area=a.area),0) order by a.area),'[]'::jsonb) from areas_agg a)) order by w.week),'[]'::jsonb) v from (select distinct week from area_weeks)w),

ns as (select coalesce(jsonb_agg(to_jsonb(t) order by t.dispatch_date desc),'[]'::jsonb) v from (select driver_name,customer_name,facility_type,not_supplied_reason reason,boxes,coalesce(invoice_date::text,'') invoice_date,dispatch_date from base where not_supplied_reason<>'' order by dispatch_date desc limit 2000)t),
zero as (select coalesce(jsonb_agg(to_jsonb(t) order by t.dispatch_date desc),'[]'::jsonb) v from (select driver_name,customer_name,coalesce(invoice_date::text,'') invoice_date,coalesce(dispatch_date::text,'') dispatch_date from base where boxes<=0 order by dispatch_date desc limit 2000)t),

lm as (
 select l.* from public.landmark_visit_facts l
 where (p_start is null or l.visit_date>=p_start) and (p_end is null or l.visit_date<=p_end)
   and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 or l.driver_name in (select jsonb_array_elements_text(p_filters->'drivers')) or exists(select 1 from base s where s.vehicle_key=l.vehicle_key and s.driver_name in (select jsonb_array_elements_text(p_filters->'drivers'))))
   and (nullif(p_filters->>'driver','') is null or l.driver_name=p_filters->>'driver' or exists(select 1 from base s where s.vehicle_key=l.vehicle_key and s.driver_name=p_filters->>'driver'))
   and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or exists(select 1 from base s where s.vehicle_key=l.vehicle_key and s.area in (select jsonb_array_elements_text(p_filters->'areas'))))
   and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or exists(select 1 from base s where s.vehicle_key=l.vehicle_key and s.division_desc in (select jsonb_array_elements_text(p_filters->'division'))))
   and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or exists(select 1 from base s where s.vehicle_key=l.vehicle_key and s.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type'))))
   and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or exists(select 1 from base s where s.vehicle_key=l.vehicle_key and s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type'))))
   and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or exists(select 1 from base s where s.vehicle_key=l.vehicle_key and s.salesman in (select jsonb_array_elements_text(p_filters->'salesman'))))
),
lm_cards as (
 select coalesce(l.vehicle_key,'') vehicle_key,
        nullif(max(l.driver_name) filter(where l.driver_name<>''),'') gps_driver,
        count(*) filter(where not l.is_passthrough and not l.is_depot) stops,
        round(avg(l.minutes) filter(where not l.is_passthrough and not l.is_depot)) avg_stop,
        count(*) filter(where l.is_passthrough) passthru,
        min(l.departed_at) filter(where l.is_depot) route_start,
        max(l.departed_at) filter(where not l.is_passthrough and not l.is_depot) route_end
 from lm l group by 1
),
manual as (select vehicle_key,coalesce(sap_driver,'') sap_driver from public.vehicle_driver_manual_mappings),
perf_cards as (
 select c.vehicle_key,coalesce(nullif(m.sap_driver,''),nullif(s.driver_name,''),c.gps_driver) display_driver,
        c.vehicle_key vehicle_num,
        case when s.vehicle_key is not null then 'vehicle' when m.sap_driver<>'' then 'manual' when s2.driver_name is not null then 'name' else 'none' end match_method,
        c.route_start,c.route_end,
        case when c.route_start is not null and c.route_end is not null and c.route_end>=c.route_start then floor(extract(epoch from c.route_end-c.route_start)/3600)::int||'h '||floor(mod(extract(epoch from c.route_end-c.route_start)/60,60))::int||'m' else '0h 0m' end route_duration_hm,
        c.stops,
        floor(coalesce(c.avg_stop,0)/60)::int||'h '||floor(mod(coalesce(c.avg_stop,0),60))::int||'m' avg_stop_hm,
        c.passthru passthru_count,
        case when s.vehicle_key is not null then jsonb_build_object('invoices',s.invoices,'boxes',s.boxes,'freezer',s.freezer) else null end sap_orders,
        case when c.route_start is not null and c.route_end is not null and c.route_end>=c.route_start then round((extract(epoch from c.route_end-c.route_start)/3600)::numeric,2) else 0 end _hours
 from lm_cards c
 left join manual m on m.vehicle_key=c.vehicle_key
 left join lateral (select min(driver_name) driver_name,min(vehicle_key) vehicle_key,count(*) invoices,sum(boxes) boxes,sum(freezer_boxes) freezer from base x where x.vehicle_key=c.vehicle_key group by x.vehicle_key limit 1)s on true
 left join lateral (select min(driver_name) driver_name from base x where lower(trim(x.driver_name))=lower(trim(c.gps_driver)) limit 1)s2 on true
),
perf as (
 select coalesce(jsonb_agg(to_jsonb(x)-'_hours'),'[]'::jsonb) cards,count(*) gps_vehicles,coalesce(sum(stops),0) total_stops,coalesce(avg(_hours) filter(where _hours>0),null) avg_hours from perf_cards x
)
select jsonb_build_object(
 'lead_time',jsonb_build_object('kpis',jsonb_build_object('total_invoices',ls.total,'overall_avg_days',ls.avg_days,'fastest_days',ls.min_days,'longest_days',ls.max_days),'by_classification',lc.v,'distribution',jsonb_build_object('bins',jsonb_build_array('0 Days','1 Day','2 Days','3 Days','4 Days','5 Days','More than 5 Days'),'counts',(select coalesce(jsonb_agg(n order by array_position(array['0 Days','1 Day','2 Days','3 Days','4 Days','5 Days','More than 5 Days'],band)),'[]'::jsonb) from lead_bands)),'fastest_detail',fast.v,'longest_detail',slow.v,'band_classification_matrix',jsonb_build_object('classifications',(select v from lead_classes),'rows',(select v from lead_matrix),'col_totals',(select coalesce(jsonb_object_agg(class,n),'{}'::jsonb) from (select case when lower(trim(coalesce(facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then facility_type when lower(trim(coalesce(division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then division_desc end class,count(*) n from lead group by 1)z),'grand_total',ls.total),'available_bands',(select coalesce(jsonb_agg(band order by array_position(array['0 Days','1 Day','2 Days','3 Days','4 Days','5 Days','More than 5 Days'],band)),'[]'::jsonb) from lead_bands where n>0),'available_classifications',(select v from lead_classes)),
 'order_summary',jsonb_build_object('facility_types',facilities.v,'rows',(select v from order_rows),'facility_totals',(select coalesce(jsonb_agg(t.n order by t.facility),'[]'::jsonb) from (select facility,sum(n) n from ord group by facility) t),'grand_total',(select count(*) from base)),
 'area_analytics',jsonb_build_object('table',area_table.v,'totals',jsonb_build_object('orders',(select coalesce(sum(orders),0) from areas_agg),'boxes',(select coalesce(sum(boxes),0) from areas_agg),'freezer',(select coalesce(sum(freezer),0) from areas_agg),'returns',(select coalesce(sum(returns),0) from areas_agg),'drivers',(select count(distinct driver_name) from base),'success_pct',case when (select sum(orders) from areas_agg)>0 then round(((select sum(orders-returns) from areas_agg)::numeric/(select sum(orders) from areas_agg))*10000)/100 else 0 end),'area_names',area_names.v,'weekly_table',(select v from weekly),'chart',jsonb_build_object('labels',(select coalesce(jsonb_agg(t.area order by t.orders desc),'[]'::jsonb) from (select area,orders from areas_agg order by orders desc limit 15) t),'values',(select coalesce(jsonb_agg(t.orders order by t.orders desc),'[]'::jsonb) from (select orders from areas_agg order by orders desc limit 15) t))),
 'not_supplied',jsonb_build_object('not_supplied',ns.v,'zero_box_excluded_from_kpis',zero.v),
 'driver_performance',jsonb_build_object('standalone_mode',coalesce(p.gps_vehicles,0)>0 and not exists(select 1 from perf_cards where match_method<>'none'),'validation_results','[]'::jsonb,'kpis',jsonb_build_object('gps_vehicles',p.gps_vehicles,'total_gps_stops',p.total_stops,'avg_stops_per_vehicle',case when p.gps_vehicles>0 then round(p.total_stops::numeric/p.gps_vehicles,2) else 0 end,'avg_route_duration_hrs',p.avg_hours,'avg_stop_duration','','sap_orders',(select count(*) from base),'sap_total_boxes',(select coalesce(sum(boxes),0) from base)),'chart_stops',jsonb_build_object('labels',(select coalesce(jsonb_agg(display_driver order by stops desc),'[]'::jsonb) from perf_cards),'values',(select coalesce(jsonb_agg(stops order by stops desc),'[]'::jsonb) from perf_cards)),'chart_route_hours',jsonb_build_object('labels',(select coalesce(jsonb_agg(display_driver order by _hours desc),'[]'::jsonb) from perf_cards),'values',(select coalesce(jsonb_agg(_hours order by _hours desc),'[]'::jsonb) from perf_cards)),'route_cards',p.cards)
)
from lead_stats ls,lead_class lc,fast,slow,facilities,area_table,area_names,weekly,ns,zero,perf p;
$$;

grant execute on function public.dispatchops_dashboard_snapshot(date,date,jsonb) to anon, authenticated;

create index if not exists idx_sap_dashboard_filter on public.sap_invoice_facts (dispatch_date, driver_name, area, division_desc, vehicle_type, facility_type, salesman, vehicle_key);
create index if not exists idx_lm_dashboard_driver_vehicle_date on public.landmark_visit_facts (visit_date, driver_name, vehicle_key);

-- 0017 dashboard timeout elimination: indexes and targeted dashboard RPCs are applied by migration dashboard_timeout_elimination_v17_driver + dashboard_timeout_elimination_v17_lead + dashboard_timeout_elimination_v17_order.
create index if not exists idx_sap_dashboard_vehicle_scope_date on public.sap_invoice_facts (vehicle_key, dispatch_date);
create index if not exists idx_landmark_vehicle_date_perf on public.landmark_visit_facts (vehicle_key, visit_date);
analyze public.sap_invoice_facts;
analyze public.landmark_visit_facts;


-- ===== 0018_dashboard_instant_slicers_zero_timeout.sql =====
-- DispatchOPS Dashboard performance architecture v18
-- Each visible tab has a dedicated compact RPC. No Area/Not-Supplied request
-- invokes the old all-tabs snapshot. Overview is aggregated in PostgreSQL.

create index if not exists idx_sap_dashboard_driver_date_v18 on public.sap_invoice_facts (driver_name, dispatch_date);
create index if not exists idx_sap_dashboard_area_date_v18 on public.sap_invoice_facts (area, dispatch_date);
create index if not exists idx_sap_dashboard_division_date_v18 on public.sap_invoice_facts (division_desc, dispatch_date);
create index if not exists idx_lm_dashboard_vehicle_date_v18 on public.landmark_visit_facts (vehicle_key, visit_date);

create or replace function public.dispatchops_dashboard_area_snapshot(
  p_start date default null,
  p_end date default null,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language sql stable
set statement_timeout='20s'
as $$
with base as materialized (
  select s.dispatch_date, coalesce(s.area,'') area, coalesce(s.driver_name,'') driver_name,
         coalesce(s.boxes,0) boxes, coalesce(s.freezer_boxes,0) freezer_boxes,
         coalesce(s.not_supplied_reason,'') not_supplied_reason
  from public.sap_invoice_facts s
  where (p_start is null or s.dispatch_date>=p_start)
    and (p_end is null or s.dispatch_date<=p_end)
    and (nullif(p_filters->>'driver','') is null or s.driver_name=p_filters->>'driver')
    and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 or s.driver_name in (select jsonb_array_elements_text(p_filters->'drivers')))
    and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or s.area in (select jsonb_array_elements_text(p_filters->'areas')))
    and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
    and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
    and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman')))
    and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
    and (lower(trim(coalesce(s.facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') or lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown'))
    and (
      (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 and jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0)
      or exists (
        select 1 from public.areas a
        where (coalesce(nullif(a.code,''),a.area_code)=s.area or coalesce(nullif(a.name,''),a.area_name)=s.area)
          and (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 or a.route_type in (select jsonb_array_elements_text(p_filters->'route_type')))
          and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or a.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type')))
      )
    )
), agg as (
  select nullif(area,'') area, count(*)::int orders, coalesce(sum(boxes),0)::bigint boxes,
         coalesce(sum(freezer_boxes),0)::bigint freezer,
         count(*) filter(where not_supplied_reason<>'')::int returns,
         count(distinct nullif(driver_name,''))::int drivers
  from base group by 1
), area_table as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'area',area,'orders',orders,'boxes',boxes,'freezer',freezer,'returns',returns,'drivers',drivers,
    'success_pct',case when orders>0 then round((orders-returns)::numeric/orders*10000)/100 else 0 end
  ) order by area),'[]'::jsonb) v from agg
), names as (
  select coalesce(jsonb_agg(area order by area),'[]'::jsonb) v from agg
), weekly_counts as (
  select to_char(date_trunc('week',dispatch_date),'YYYY-MM-DD') week, nullif(area,'') area, count(*)::int n
  from base group by 1,2
), weekly as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'week',w.week,
    'by_area',(select coalesce(jsonb_agg(coalesce(wc.n,0) order by a.area),'[]'::jsonb)
               from agg a left join weekly_counts wc on wc.week=w.week and wc.area=a.area)
  ) order by w.week),'[]'::jsonb) v
  from (select distinct week from weekly_counts) w
), totals as (
  select count(*)::int orders, coalesce(sum(boxes),0)::bigint boxes, coalesce(sum(freezer_boxes),0)::bigint freezer,
         count(*) filter(where not_supplied_reason<>'')::int returns,
         count(distinct nullif(driver_name,''))::int drivers
  from base
)
select jsonb_build_object(
  'table',area_table.v,
  'totals',jsonb_build_object('orders',totals.orders,'boxes',totals.boxes,'freezer',totals.freezer,'returns',totals.returns,'drivers',totals.drivers,
      'success_pct',case when totals.orders>0 then round((totals.orders-totals.returns)::numeric/totals.orders*10000)/100 else 0 end),
  'area_names',names.v,
  'weekly_table',weekly.v,
  'chart',jsonb_build_object(
      'labels',(select coalesce(jsonb_agg(t.area order by t.orders desc),'[]'::jsonb) from (select area,orders from agg order by orders desc limit 15)t),
      'values',(select coalesce(jsonb_agg(t.orders order by t.orders desc),'[]'::jsonb) from (select area,orders from agg order by orders desc limit 15)t))
) from area_table,names,weekly,totals;
$$;

grant execute on function public.dispatchops_dashboard_area_snapshot(date,date,jsonb) to anon,authenticated;

create or replace function public.dispatchops_dashboard_not_supplied_snapshot(
  p_start date default null,
  p_end date default null,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language sql stable
set statement_timeout='20s'
as $$
with base as materialized (
  select s.driver_name,s.customer_name,coalesce(s.facility_type,'') facility_type,
         coalesce(s.not_supplied_reason,'') not_supplied_reason,coalesce(s.boxes,0) boxes,
         s.invoice_date,s.dispatch_date,s.area,s.division_desc,s.vehicle_type,s.salesman
  from public.sap_invoice_facts s
  where (p_start is null or s.dispatch_date>=p_start)
    and (p_end is null or s.dispatch_date<=p_end)
    and (nullif(p_filters->>'driver','') is null or s.driver_name=p_filters->>'driver')
    and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 or s.driver_name in (select jsonb_array_elements_text(p_filters->'drivers')))
    and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or s.area in (select jsonb_array_elements_text(p_filters->'areas')))
    and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
    and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
    and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman')))
    and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
    and (lower(trim(coalesce(s.facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') or lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown'))
    and (
      (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 and jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0)
      or exists (
        select 1 from public.areas a
        where (coalesce(nullif(a.code,''),a.area_code)=s.area or coalesce(nullif(a.name,''),a.area_name)=s.area)
          and (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 or a.route_type in (select jsonb_array_elements_text(p_filters->'route_type')))
          and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or a.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type')))
      )
    )
), ns as (
  select coalesce(jsonb_agg(to_jsonb(t) order by t.dispatch_date desc),'[]'::jsonb) v
  from (select driver_name,customer_name,facility_type,not_supplied_reason reason,boxes,coalesce(invoice_date::text,'') invoice_date,dispatch_date
        from base where not_supplied_reason<>'' order by dispatch_date desc limit 2000)t
), zero as (
  select coalesce(jsonb_agg(to_jsonb(t) order by t.dispatch_date desc),'[]'::jsonb) v
  from (select driver_name,customer_name,coalesce(invoice_date::text,'') invoice_date,coalesce(dispatch_date::text,'') dispatch_date
        from base where boxes<=0 order by dispatch_date desc limit 2000)t
)
select jsonb_build_object('not_supplied',ns.v,'zero_box_excluded_from_kpis',zero.v) from ns,zero;
$$;

grant execute on function public.dispatchops_dashboard_not_supplied_snapshot(date,date,jsonb) to anon,authenticated;

create or replace function public.dispatchops_dashboard_home_snapshot(
  p_start date default null,
  p_end date default null,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language sql stable
set statement_timeout='20s'
as $$
with base as materialized (
  select s.invoice_no,s.invoice_date,s.dispatch_date,coalesce(s.driver_name,'') driver_name,
         coalesce(s.vehicle_num,'') vehicle_num,coalesce(s.vehicle_key,'') vehicle_key,coalesce(s.vehicle_type,'') vehicle_type,
         coalesce(s.customer_name,'') customer_name,coalesce(s.area,'') area,coalesce(s.division_desc,'') division_desc,
         coalesce(s.facility_type,'') facility_type,coalesce(s.salesman,'') salesman,
         coalesce(s.boxes,0) boxes,coalesce(s.normal_boxes,0) normal_boxes,coalesce(s.freezer_boxes,0) freezer_boxes,
         coalesce(s.not_supplied_reason,'') not_supplied_reason
  from public.sap_invoice_facts s
  where (p_start is null or s.dispatch_date>=p_start)
    and (p_end is null or s.dispatch_date<=p_end)
    and (nullif(p_filters->>'driver','') is null or s.driver_name=p_filters->>'driver')
    and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 or s.driver_name in (select jsonb_array_elements_text(p_filters->'drivers')))
    and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or s.area in (select jsonb_array_elements_text(p_filters->'areas')))
    and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
    and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
    and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman')))
    and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
    and (lower(trim(coalesce(s.facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') or lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown'))
    and (not exists(select 1 from public.drivers) or exists(select 1 from public.drivers d where coalesce(nullif(d.name,''),d.driver_name)=s.driver_name))
    and (not exists(select 1 from public.areas) or exists(select 1 from public.areas a where coalesce(nullif(a.name,''),a.area_name)=s.area))
    and (
      (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 and jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0)
      or exists (
        select 1 from public.areas a
        where coalesce(nullif(a.name,''),a.area_name)=s.area
          and (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 or a.route_type in (select jsonb_array_elements_text(p_filters->'route_type')))
          and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or a.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type')))
      )
    )
), stats as (
  select count(*)::int valid_invoices,coalesce(sum(boxes),0)::bigint total_boxes,coalesce(sum(normal_boxes),0)::bigint normal_boxes,
         coalesce(sum(freezer_boxes),0)::bigint freezer_boxes,count(distinct nullif(driver_name,''))::int active_drivers,
         count(*) filter(where not_supplied_reason<>'')::int not_supplied,count(distinct nullif(customer_name,''))::int unique_customers,
         round(avg((dispatch_date-invoice_date)) filter(where invoice_date is not null and dispatch_date is not null and dispatch_date>=invoice_date)::numeric,1) avg_lead
  from base
), driver_groups as (
  select driver_name,min(nullif(vehicle_num,'')) vehicle_num,min(vehicle_type) vehicle_type,count(*)::int orders,
         coalesce(sum(boxes),0)::bigint boxes,coalesce(sum(freezer_boxes),0)::bigint freezer,
         count(*) filter(where not_supplied_reason<>'')::int not_supplied
  from base where driver_name<>'' group by driver_name
), facility_groups as (
  select facility_type,count(*)::int n from base where facility_type<>'' group by facility_type
), vehicle_type_groups as (
  select vehicle_type,coalesce(sum(normal_boxes),0)::bigint normal,coalesce(sum(freezer_boxes),0)::bigint freezer
  from base group by vehicle_type
), scoped_vehicles as (
  select distinct vehicle_key from base where vehicle_key<>''
), daily_routes as (
  select l.vehicle_key,l.visit_date,
         min(l.departed_at) filter(where l.is_depot) route_start,
         max(l.departed_at) filter(where not l.is_passthrough and not l.is_depot) route_end
  from public.landmark_visit_facts l join scoped_vehicles v on v.vehicle_key=l.vehicle_key
  where (p_start is null or l.visit_date>=p_start) and (p_end is null or l.visit_date<=p_end)
  group by l.vehicle_key,l.visit_date
), route_stats as (
  select round(avg(extract(epoch from (route_end-route_start))/3600.0) filter(where route_start is not null and route_end is not null and route_end>route_start)::numeric,1) avg_route_hours
  from daily_routes
), active_vehicle_count as (
  select count(distinct b.vehicle_key)::int n from base b
  where b.vehicle_key<>'' and exists(
    select 1 from public.vehicles v
    where regexp_replace(upper(trim(coalesce(nullif(v.number,''),v.vehicle_number,''))),'[^A-Z0-9]','','g')=b.vehicle_key
  )
), drivers_json as (
  select coalesce(jsonb_agg(jsonb_build_object('driver_name',driver_name,'vehicle_num',coalesce(vehicle_num,'-'),'vehicle_type',vehicle_type,
           'orders',orders,'boxes',boxes,'freezer',freezer,'not_supplied',not_supplied) order by boxes desc),'[]'::jsonb) v from driver_groups
), driver_chart as (
  select jsonb_build_object('labels',coalesce(jsonb_agg(driver_name order by boxes desc),'[]'::jsonb),'values',coalesce(jsonb_agg(boxes order by boxes desc),'[]'::jsonb)) v from driver_groups
), facility_chart as (
  select jsonb_build_object('labels',coalesce(jsonb_agg(facility_type order by facility_type),'[]'::jsonb),'values',coalesce(jsonb_agg(n order by facility_type),'[]'::jsonb)) v from facility_groups
), vehicle_chart as (
  select jsonb_build_object('labels',coalesce(jsonb_agg(vehicle_type order by vehicle_type),'[]'::jsonb),'normal',coalesce(jsonb_agg(normal order by vehicle_type),'[]'::jsonb),'freezer',coalesce(jsonb_agg(freezer order by vehicle_type),'[]'::jsonb)) v from vehicle_type_groups
)
select jsonb_build_object(
 'kpis',jsonb_build_object(
   'valid_invoices',stats.valid_invoices,'total_boxes',stats.total_boxes,'freezer_boxes',stats.freezer_boxes,'normal_boxes',stats.normal_boxes,
   'active_drivers',stats.active_drivers,'avg_boxes_per_driver',case when stats.active_drivers>0 then round(stats.total_boxes::numeric/stats.active_drivers,1) else 0 end,
   'not_supplied',stats.not_supplied,'avg_lead_time_days',stats.avg_lead,'unique_customers',stats.unique_customers,
   'avg_route_hours',route_stats.avg_route_hours,'orders_per_driver',case when stats.active_drivers>0 then round(stats.valid_invoices::numeric/stats.active_drivers,1) else 0 end,
   'active_vehicles',active_vehicle_count.n
 ),
 'driver_overview',drivers_json.v,
 'charts',jsonb_build_object('driver_boxes',driver_chart.v,'facility',facility_chart.v,'vantype',vehicle_chart.v,
          'returns',jsonb_build_object('delivered',stats.valid_invoices-stats.not_supplied,'not_supplied',stats.not_supplied))
) from stats,route_stats,active_vehicle_count,drivers_json,driver_chart,facility_chart,vehicle_chart;
$$;

grant execute on function public.dispatchops_dashboard_home_snapshot(date,date,jsonb) to anon,authenticated;

analyze public.sap_invoice_facts;
analyze public.landmark_visit_facts;
notify pgrst,'reload schema';


-- ===== 0019_dashboard_landmark_time_and_driver_final.sql =====
-- v19: Landmark imports store the original timestamp strings in arrival/departure.
-- Native departed_at is intentionally nullable, so Dashboard timing must parse the
-- authoritative text value instead of treating every route as 0/N/A.
create or replace function public.dispatchops_landmark_timestamp(p_value text)
returns timestamptz language sql stable strict as $$
  select case
    when trim(p_value) ~ '^[0-9]{1,2} [A-Za-z]{3} [0-9]{4} [0-9]{1,2}:[0-9]{2}:[0-9]{2}$'
      then to_timestamp(trim(p_value), 'DD Mon YYYY HH24:MI:SS')
    else null
  end;
$$;

grant execute on function public.dispatchops_landmark_timestamp(text) to anon,authenticated;

create or replace function public.dispatchops_dashboard_driver_performance_snapshot(p_start date default null,p_end date default null,p_filters jsonb default '{}'::jsonb)
returns jsonb language sql stable set statement_timeout='20s' as $$
with sap as materialized (
 select s.vehicle_key,min(s.driver_name) driver_name,count(*) invoices,sum(coalesce(s.boxes,0)) boxes,sum(coalesce(s.freezer_boxes,0)) freezer
 from public.sap_invoice_facts s
 where (p_start is null or s.dispatch_date>=p_start) and (p_end is null or s.dispatch_date<=p_end)
 and (nullif(p_filters->>'driver','') is null or s.driver_name=p_filters->>'driver')
 and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 or s.driver_name in (select jsonb_array_elements_text(p_filters->'drivers')))
 and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or s.area in (select jsonb_array_elements_text(p_filters->'areas')))
 and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
 and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or s.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type')))
 and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
 and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman')))
 and (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 or exists(select 1 from public.areas a where (coalesce(nullif(a.code,''),a.area_code)=s.area or coalesce(nullif(a.name,''),a.area_name)=s.area) and a.route_type in (select jsonb_array_elements_text(p_filters->'route_type'))))
 and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
 and lower(trim(coalesce(s.facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
 group by s.vehicle_key
), scope as materialized (select vehicle_key from sap where nullif(vehicle_key,'') is not null),
lm as materialized (
 select l.vehicle_key,l.visit_date,l.driver_name,l.minutes,l.is_passthrough,l.is_depot,
        coalesce(l.departed_at,public.dispatchops_landmark_timestamp(l.departure)) dep_ts
 from public.landmark_visit_facts l join scope x on x.vehicle_key=l.vehicle_key
 where (p_start is null or l.visit_date>=p_start) and (p_end is null or l.visit_date<=p_end)
), daily as (
 select l.vehicle_key,l.visit_date,
        count(*) filter(where not l.is_passthrough and not l.is_depot) stops,
        avg(l.minutes) filter(where not l.is_passthrough and not l.is_depot) avg_stop,
        count(*) filter(where l.is_passthrough) passthru,
        min(l.dep_ts) filter(where l.is_depot) route_start,
        max(l.dep_ts) filter(where not l.is_passthrough and not l.is_depot) route_end
 from lm l group by l.vehicle_key,l.visit_date
), cards as (
 select d.vehicle_key,min(d.route_start) route_start,max(d.route_end) route_end,
        sum(d.stops)::int stops,round(avg(d.avg_stop)) avg_stop,sum(d.passthru)::int passthru,
        round(avg(extract(epoch from (d.route_end-d.route_start))/3600.0) filter(where d.route_start is not null and d.route_end is not null and d.route_end>d.route_start)::numeric,2) avg_hours,
        max(s.driver_name) display_driver,max(s.invoices) invoices,max(s.boxes) boxes,max(s.freezer) freezer
 from daily d join sap s on s.vehicle_key=d.vehicle_key group by d.vehicle_key
), manual as (select distinct on (vehicle_key) vehicle_key,coalesce(sap_driver,'') sap_driver from public.vehicle_driver_manual_mappings order by vehicle_key),
final as (
 select c.vehicle_key,coalesce(nullif(m.sap_driver,''),c.display_driver) display_driver,c.vehicle_key vehicle_num,
        case when coalesce(m.sap_driver,'')<>'' then 'manual' else 'vehicle' end match_method,
        c.route_start,c.route_end,
        case when c.avg_hours is not null then floor(c.avg_hours)::int||'h '||floor(mod(c.avg_hours*60,60))::int||'m' else '0h 0m' end route_duration_hm,
        c.stops,floor(coalesce(c.avg_stop,0)/60)::int||'h '||floor(mod(coalesce(c.avg_stop,0),60))::int||'m' avg_stop_hm,
        c.passthru passthru_count,jsonb_build_object('invoices',c.invoices,'boxes',c.boxes,'freezer',c.freezer) sap_orders,
        coalesce(c.avg_hours,0) _hours
 from cards c left join manual m on m.vehicle_key=c.vehicle_key
), agg as (
 select coalesce(jsonb_agg(to_jsonb(f)-'_hours' order by f.stops desc),'[]'::jsonb) cards,
        count(*) gps_vehicles,coalesce(sum(stops),0) total_stops,round(avg(_hours) filter(where _hours>0)::numeric,2) avg_hours
 from final f
)
select jsonb_build_object(
 'standalone_mode',false,'validation_results','[]'::jsonb,
 'kpis',jsonb_build_object('gps_vehicles',agg.gps_vehicles,'total_gps_stops',agg.total_stops,'avg_stops_per_vehicle',case when agg.gps_vehicles>0 then round(agg.total_stops::numeric/agg.gps_vehicles,2) else 0 end,'avg_route_duration_hrs',agg.avg_hours,'avg_stop_duration','','sap_orders',(select coalesce(sum(invoices),0) from sap),'sap_total_boxes',(select coalesce(sum(boxes),0) from sap)),
 'chart_stops',jsonb_build_object('labels',(select coalesce(jsonb_agg(display_driver order by stops desc),'[]'::jsonb) from final),'values',(select coalesce(jsonb_agg(stops order by stops desc),'[]'::jsonb) from final)),
 'chart_route_hours',jsonb_build_object('labels',(select coalesce(jsonb_agg(display_driver order by _hours desc),'[]'::jsonb) from final),'values',(select coalesce(jsonb_agg(_hours order by _hours desc),'[]'::jsonb) from final)),
 'route_cards',agg.cards
) from agg;
$$;

grant execute on function public.dispatchops_dashboard_driver_performance_snapshot(date,date,jsonb) to anon,authenticated;

-- Home snapshot override: keep v18 filtering/aggregation but calculate Avg Route
-- Hours from date-scoped daily routes using the actual Landmark departure text.
create or replace function public.dispatchops_dashboard_home_snapshot(
  p_start date default null,p_end date default null,p_filters jsonb default '{}'::jsonb
) returns jsonb language sql stable set statement_timeout='20s' as $$
with base as materialized (
  select s.invoice_no,s.invoice_date,s.dispatch_date,coalesce(s.driver_name,'') driver_name,
         coalesce(s.vehicle_num,'') vehicle_num,coalesce(s.vehicle_key,'') vehicle_key,coalesce(s.vehicle_type,'') vehicle_type,
         coalesce(s.customer_name,'') customer_name,coalesce(s.area,'') area,coalesce(s.division_desc,'') division_desc,
         coalesce(s.facility_type,'') facility_type,coalesce(s.salesman,'') salesman,
         coalesce(s.boxes,0) boxes,coalesce(s.normal_boxes,0) normal_boxes,coalesce(s.freezer_boxes,0) freezer_boxes,
         coalesce(s.not_supplied_reason,'') not_supplied_reason
  from public.sap_invoice_facts s
  where (p_start is null or s.dispatch_date>=p_start) and (p_end is null or s.dispatch_date<=p_end)
    and (nullif(p_filters->>'driver','') is null or s.driver_name=p_filters->>'driver')
    and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 or s.driver_name in (select jsonb_array_elements_text(p_filters->'drivers')))
    and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or s.area in (select jsonb_array_elements_text(p_filters->'areas')))
    and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
    and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
    and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman')))
    and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
    and (lower(trim(coalesce(s.facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') or lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown'))
    and (not exists(select 1 from public.drivers) or exists(select 1 from public.drivers d where coalesce(nullif(d.name,''),d.driver_name)=s.driver_name))
    and (not exists(select 1 from public.areas) or exists(select 1 from public.areas a where coalesce(nullif(a.name,''),a.area_name)=s.area))
    and ((jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 and jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0) or exists(select 1 from public.areas a where coalesce(nullif(a.name,''),a.area_name)=s.area and (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 or a.route_type in (select jsonb_array_elements_text(p_filters->'route_type'))) and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or a.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type')))))
), stats as (
  select count(*)::int valid_invoices,coalesce(sum(boxes),0)::bigint total_boxes,coalesce(sum(normal_boxes),0)::bigint normal_boxes,coalesce(sum(freezer_boxes),0)::bigint freezer_boxes,
         count(distinct nullif(driver_name,''))::int active_drivers,count(*) filter(where not_supplied_reason<>'')::int not_supplied,count(distinct nullif(customer_name,''))::int unique_customers,
         round(avg((dispatch_date-invoice_date)) filter(where invoice_date is not null and dispatch_date is not null and dispatch_date>=invoice_date)::numeric,1) avg_lead from base
), driver_groups as (
  select driver_name,min(nullif(vehicle_num,'')) vehicle_num,min(vehicle_type) vehicle_type,count(*)::int orders,coalesce(sum(boxes),0)::bigint boxes,coalesce(sum(freezer_boxes),0)::bigint freezer,count(*) filter(where not_supplied_reason<>'')::int not_supplied
  from base where driver_name<>'' group by driver_name
), facility_groups as (select facility_type,count(*)::int n from base where facility_type<>'' group by facility_type),
vehicle_type_groups as (select vehicle_type,coalesce(sum(normal_boxes),0)::bigint normal,coalesce(sum(freezer_boxes),0)::bigint freezer from base group by vehicle_type),
scoped_vehicles as (select distinct vehicle_key from base where vehicle_key<>''),
daily_routes as (
  select l.vehicle_key,l.visit_date,
         min(coalesce(l.departed_at,public.dispatchops_landmark_timestamp(l.departure))) filter(where l.is_depot) route_start,
         max(coalesce(l.departed_at,public.dispatchops_landmark_timestamp(l.departure))) filter(where not l.is_passthrough and not l.is_depot) route_end
  from public.landmark_visit_facts l join scoped_vehicles v on v.vehicle_key=l.vehicle_key
  where (p_start is null or l.visit_date>=p_start) and (p_end is null or l.visit_date<=p_end)
  group by l.vehicle_key,l.visit_date
), route_stats as (
  select round(avg(extract(epoch from (route_end-route_start))/3600.0) filter(where route_start is not null and route_end is not null and route_end>route_start)::numeric,1) avg_route_hours from daily_routes
), active_vehicle_count as (
  select count(distinct b.vehicle_key)::int n from base b where b.vehicle_key<>'' and exists(select 1 from public.vehicles v where regexp_replace(upper(trim(coalesce(nullif(v.number,''),v.vehicle_number,''))),'[^A-Z0-9]','','g')=b.vehicle_key)
), drivers_json as (
  select coalesce(jsonb_agg(jsonb_build_object('driver_name',driver_name,'vehicle_num',coalesce(vehicle_num,'-'),'vehicle_type',vehicle_type,'orders',orders,'boxes',boxes,'freezer',freezer,'not_supplied',not_supplied) order by boxes desc),'[]'::jsonb) v from driver_groups
), driver_chart as (select jsonb_build_object('labels',coalesce(jsonb_agg(driver_name order by boxes desc),'[]'::jsonb),'values',coalesce(jsonb_agg(boxes order by boxes desc),'[]'::jsonb)) v from driver_groups),
facility_chart as (select jsonb_build_object('labels',coalesce(jsonb_agg(facility_type order by facility_type),'[]'::jsonb),'values',coalesce(jsonb_agg(n order by facility_type),'[]'::jsonb)) v from facility_groups),
vehicle_chart as (select jsonb_build_object('labels',coalesce(jsonb_agg(vehicle_type order by vehicle_type),'[]'::jsonb),'normal',coalesce(jsonb_agg(normal order by vehicle_type),'[]'::jsonb),'freezer',coalesce(jsonb_agg(freezer order by vehicle_type),'[]'::jsonb)) v from vehicle_type_groups)
select jsonb_build_object('kpis',jsonb_build_object('valid_invoices',stats.valid_invoices,'total_boxes',stats.total_boxes,'freezer_boxes',stats.freezer_boxes,'normal_boxes',stats.normal_boxes,'active_drivers',stats.active_drivers,'avg_boxes_per_driver',case when stats.active_drivers>0 then round(stats.total_boxes::numeric/stats.active_drivers,1) else 0 end,'not_supplied',stats.not_supplied,'avg_lead_time_days',stats.avg_lead,'unique_customers',stats.unique_customers,'avg_route_hours',route_stats.avg_route_hours,'orders_per_driver',case when stats.active_drivers>0 then round(stats.valid_invoices::numeric/stats.active_drivers,1) else 0 end,'active_vehicles',active_vehicle_count.n),'driver_overview',drivers_json.v,'charts',jsonb_build_object('driver_boxes',driver_chart.v,'facility',facility_chart.v,'vantype',vehicle_chart.v,'returns',jsonb_build_object('delivered',stats.valid_invoices-stats.not_supplied,'not_supplied',stats.not_supplied)))
from stats,route_stats,active_vehicle_count,drivers_json,driver_chart,facility_chart,vehicle_chart;
$$;

grant execute on function public.dispatchops_dashboard_home_snapshot(date,date,jsonb) to anon,authenticated;
notify pgrst,'reload schema';


-- ===== 0020_landmark_native_timestamp_cache.sql =====
-- v20: parse Landmark text timestamps once on ingest, not on every dashboard query.
create or replace function public.dispatchops_fill_landmark_native_timestamps()
returns trigger language plpgsql as $$
begin
  if new.arrived_at is null and nullif(trim(coalesce(new.arrival,'')),'') is not null then
    new.arrived_at := public.dispatchops_landmark_timestamp(new.arrival);
  end if;
  if new.departed_at is null and nullif(trim(coalesce(new.departure,'')),'') is not null then
    new.departed_at := public.dispatchops_landmark_timestamp(new.departure);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_landmark_native_timestamps on public.landmark_visit_facts;
create trigger trg_landmark_native_timestamps
before insert or update of arrival,departure on public.landmark_visit_facts
for each row execute function public.dispatchops_fill_landmark_native_timestamps();

update public.landmark_visit_facts
set arrived_at = coalesce(arrived_at,public.dispatchops_landmark_timestamp(arrival)),
    departed_at = coalesce(departed_at,public.dispatchops_landmark_timestamp(departure))
where arrived_at is null or departed_at is null;

create index if not exists idx_lm_vehicle_visit_departed_v20 on public.landmark_visit_facts(vehicle_key,visit_date,departed_at);
analyze public.landmark_visit_facts;

-- Once native timestamps are populated, remove per-query text parsing from Home.
create or replace function public.dispatchops_dashboard_home_snapshot(p_start date default null,p_end date default null,p_filters jsonb default '{}'::jsonb)
returns jsonb language sql stable set statement_timeout='20s' as $$
with base as materialized (
 select s.invoice_no,s.invoice_date,s.dispatch_date,coalesce(s.driver_name,'') driver_name,coalesce(s.vehicle_num,'') vehicle_num,coalesce(s.vehicle_key,'') vehicle_key,coalesce(s.vehicle_type,'') vehicle_type,coalesce(s.customer_name,'') customer_name,coalesce(s.area,'') area,coalesce(s.division_desc,'') division_desc,coalesce(s.facility_type,'') facility_type,coalesce(s.salesman,'') salesman,coalesce(s.boxes,0) boxes,coalesce(s.normal_boxes,0) normal_boxes,coalesce(s.freezer_boxes,0) freezer_boxes,coalesce(s.not_supplied_reason,'') not_supplied_reason
 from public.sap_invoice_facts s
 where (p_start is null or s.dispatch_date>=p_start) and (p_end is null or s.dispatch_date<=p_end)
 and (nullif(p_filters->>'driver','') is null or s.driver_name=p_filters->>'driver')
 and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 or s.driver_name in (select jsonb_array_elements_text(p_filters->'drivers')))
 and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or s.area in (select jsonb_array_elements_text(p_filters->'areas')))
 and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
 and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
 and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman')))
 and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
 and (lower(trim(coalesce(s.facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') or lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown'))
 and (not exists(select 1 from public.drivers) or exists(select 1 from public.drivers d where coalesce(nullif(d.name,''),d.driver_name)=s.driver_name))
 and (not exists(select 1 from public.areas) or exists(select 1 from public.areas a where coalesce(nullif(a.name,''),a.area_name)=s.area))
 and ((jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 and jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0) or exists(select 1 from public.areas a where coalesce(nullif(a.name,''),a.area_name)=s.area and (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 or a.route_type in (select jsonb_array_elements_text(p_filters->'route_type'))) and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or a.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type')))))
),stats as (select count(*)::int valid_invoices,coalesce(sum(boxes),0)::bigint total_boxes,coalesce(sum(normal_boxes),0)::bigint normal_boxes,coalesce(sum(freezer_boxes),0)::bigint freezer_boxes,count(distinct nullif(driver_name,''))::int active_drivers,count(*) filter(where not_supplied_reason<>'')::int not_supplied,count(distinct nullif(customer_name,''))::int unique_customers,round(avg((dispatch_date-invoice_date)) filter(where invoice_date is not null and dispatch_date is not null and dispatch_date>=invoice_date)::numeric,1) avg_lead from base),
driver_groups as (select driver_name,min(nullif(vehicle_num,'')) vehicle_num,min(vehicle_type) vehicle_type,count(*)::int orders,coalesce(sum(boxes),0)::bigint boxes,coalesce(sum(freezer_boxes),0)::bigint freezer,count(*) filter(where not_supplied_reason<>'')::int not_supplied from base where driver_name<>'' group by driver_name),
facility_groups as (select facility_type,count(*)::int n from base where facility_type<>'' group by facility_type),vehicle_type_groups as (select vehicle_type,coalesce(sum(normal_boxes),0)::bigint normal,coalesce(sum(freezer_boxes),0)::bigint freezer from base group by vehicle_type),scoped_vehicles as (select distinct vehicle_key from base where vehicle_key<>''),
daily_routes as (select l.vehicle_key,l.visit_date,min(l.departed_at) filter(where l.is_depot) route_start,max(l.departed_at) filter(where not l.is_passthrough and not l.is_depot) route_end from public.landmark_visit_facts l join scoped_vehicles v on v.vehicle_key=l.vehicle_key where (p_start is null or l.visit_date>=p_start) and (p_end is null or l.visit_date<=p_end) group by l.vehicle_key,l.visit_date),
route_stats as (select round(avg(extract(epoch from (route_end-route_start))/3600.0) filter(where route_start is not null and route_end is not null and route_end>route_start)::numeric,1) avg_route_hours from daily_routes),
active_vehicle_count as (select count(distinct b.vehicle_key)::int n from base b where b.vehicle_key<>'' and exists(select 1 from public.vehicles v where regexp_replace(upper(trim(coalesce(nullif(v.number,''),v.vehicle_number,''))),'[^A-Z0-9]','','g')=b.vehicle_key)),
drivers_json as (select coalesce(jsonb_agg(jsonb_build_object('driver_name',driver_name,'vehicle_num',coalesce(vehicle_num,'-'),'vehicle_type',vehicle_type,'orders',orders,'boxes',boxes,'freezer',freezer,'not_supplied',not_supplied) order by boxes desc),'[]'::jsonb) v from driver_groups),driver_chart as (select jsonb_build_object('labels',coalesce(jsonb_agg(driver_name order by boxes desc),'[]'::jsonb),'values',coalesce(jsonb_agg(boxes order by boxes desc),'[]'::jsonb)) v from driver_groups),facility_chart as (select jsonb_build_object('labels',coalesce(jsonb_agg(facility_type order by facility_type),'[]'::jsonb),'values',coalesce(jsonb_agg(n order by facility_type),'[]'::jsonb)) v from facility_groups),vehicle_chart as (select jsonb_build_object('labels',coalesce(jsonb_agg(vehicle_type order by vehicle_type),'[]'::jsonb),'normal',coalesce(jsonb_agg(normal order by vehicle_type),'[]'::jsonb),'freezer',coalesce(jsonb_agg(freezer order by vehicle_type),'[]'::jsonb)) v from vehicle_type_groups)
select jsonb_build_object('kpis',jsonb_build_object('valid_invoices',stats.valid_invoices,'total_boxes',stats.total_boxes,'freezer_boxes',stats.freezer_boxes,'normal_boxes',stats.normal_boxes,'active_drivers',stats.active_drivers,'avg_boxes_per_driver',case when stats.active_drivers>0 then round(stats.total_boxes::numeric/stats.active_drivers,1) else 0 end,'not_supplied',stats.not_supplied,'avg_lead_time_days',stats.avg_lead,'unique_customers',stats.unique_customers,'avg_route_hours',route_stats.avg_route_hours,'orders_per_driver',case when stats.active_drivers>0 then round(stats.valid_invoices::numeric/stats.active_drivers,1) else 0 end,'active_vehicles',active_vehicle_count.n),'driver_overview',drivers_json.v,'charts',jsonb_build_object('driver_boxes',driver_chart.v,'facility',facility_chart.v,'vantype',vehicle_chart.v,'returns',jsonb_build_object('delivered',stats.valid_invoices-stats.not_supplied,'not_supplied',stats.not_supplied))) from stats,route_stats,active_vehicle_count,drivers_json,driver_chart,facility_chart,vehicle_chart;
$$;

grant execute on function public.dispatchops_dashboard_home_snapshot(date,date,jsonb) to anon,authenticated;

-- Driver Performance also reads only native timestamps now.
create or replace function public.dispatchops_dashboard_driver_performance_snapshot(p_start date default null,p_end date default null,p_filters jsonb default '{}'::jsonb)
returns jsonb language sql stable set statement_timeout='20s' as $$
with sap as materialized (
 select s.vehicle_key,min(s.driver_name) driver_name,count(*) invoices,sum(coalesce(s.boxes,0)) boxes,sum(coalesce(s.freezer_boxes,0)) freezer
 from public.sap_invoice_facts s where (p_start is null or s.dispatch_date>=p_start) and (p_end is null or s.dispatch_date<=p_end)
 and (nullif(p_filters->>'driver','') is null or s.driver_name=p_filters->>'driver') and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 or s.driver_name in (select jsonb_array_elements_text(p_filters->'drivers')))
 and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or s.area in (select jsonb_array_elements_text(p_filters->'areas'))) and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
 and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or s.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type'))) and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
 and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman'))) and (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 or exists(select 1 from public.areas a where (coalesce(nullif(a.code,''),a.area_code)=s.area or coalesce(nullif(a.name,''),a.area_name)=s.area) and a.route_type in (select jsonb_array_elements_text(p_filters->'route_type'))))
 and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') and lower(trim(coalesce(s.facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') group by s.vehicle_key
),scope as materialized (select vehicle_key from sap where nullif(vehicle_key,'') is not null),
lm as materialized (select l.vehicle_key,l.visit_date,l.driver_name,l.minutes,l.is_passthrough,l.is_depot,l.departed_at dep_ts from public.landmark_visit_facts l join scope x on x.vehicle_key=l.vehicle_key where (p_start is null or l.visit_date>=p_start) and (p_end is null or l.visit_date<=p_end)),
daily as (select l.vehicle_key,l.visit_date,count(*) filter(where not l.is_passthrough and not l.is_depot) stops,avg(l.minutes) filter(where not l.is_passthrough and not l.is_depot) avg_stop,count(*) filter(where l.is_passthrough) passthru,min(l.dep_ts) filter(where l.is_depot) route_start,max(l.dep_ts) filter(where not l.is_passthrough and not l.is_depot) route_end from lm l group by l.vehicle_key,l.visit_date),
cards as (select d.vehicle_key,min(d.route_start) route_start,max(d.route_end) route_end,sum(d.stops)::int stops,round(avg(d.avg_stop)) avg_stop,sum(d.passthru)::int passthru,round(avg(extract(epoch from (d.route_end-d.route_start))/3600.0) filter(where d.route_start is not null and d.route_end is not null and d.route_end>d.route_start)::numeric,2) avg_hours,max(s.driver_name) display_driver,max(s.invoices) invoices,max(s.boxes) boxes,max(s.freezer) freezer from daily d join sap s on s.vehicle_key=d.vehicle_key group by d.vehicle_key),manual as (select distinct on (vehicle_key) vehicle_key,coalesce(sap_driver,'') sap_driver from public.vehicle_driver_manual_mappings order by vehicle_key),
final as (select c.vehicle_key,coalesce(nullif(m.sap_driver,''),c.display_driver) display_driver,c.vehicle_key vehicle_num,case when coalesce(m.sap_driver,'')<>'' then 'manual' else 'vehicle' end match_method,c.route_start,c.route_end,case when c.avg_hours is not null then floor(c.avg_hours)::int||'h '||floor(mod(c.avg_hours*60,60))::int||'m' else '0h 0m' end route_duration_hm,c.stops,floor(coalesce(c.avg_stop,0)/60)::int||'h '||floor(mod(coalesce(c.avg_stop,0),60))::int||'m' avg_stop_hm,c.passthru passthru_count,jsonb_build_object('invoices',c.invoices,'boxes',c.boxes,'freezer',c.freezer) sap_orders,coalesce(c.avg_hours,0) _hours from cards c left join manual m on m.vehicle_key=c.vehicle_key),agg as (select coalesce(jsonb_agg(to_jsonb(f)-'_hours' order by f.stops desc),'[]'::jsonb) cards,count(*) gps_vehicles,coalesce(sum(stops),0) total_stops,round(avg(_hours) filter(where _hours>0)::numeric,2) avg_hours from final f)
select jsonb_build_object('standalone_mode',false,'validation_results','[]'::jsonb,'kpis',jsonb_build_object('gps_vehicles',agg.gps_vehicles,'total_gps_stops',agg.total_stops,'avg_stops_per_vehicle',case when agg.gps_vehicles>0 then round(agg.total_stops::numeric/agg.gps_vehicles,2) else 0 end,'avg_route_duration_hrs',agg.avg_hours,'avg_stop_duration','','sap_orders',(select coalesce(sum(invoices),0) from sap),'sap_total_boxes',(select coalesce(sum(boxes),0) from sap)),'chart_stops',jsonb_build_object('labels',(select coalesce(jsonb_agg(display_driver order by stops desc),'[]'::jsonb) from final),'values',(select coalesce(jsonb_agg(stops order by stops desc),'[]'::jsonb) from final)),'chart_route_hours',jsonb_build_object('labels',(select coalesce(jsonb_agg(display_driver order by _hours desc),'[]'::jsonb) from final),'values',(select coalesce(jsonb_agg(_hours order by _hours desc),'[]'::jsonb) from final)),'route_cards',agg.cards) from agg;
$$;

grant execute on function public.dispatchops_dashboard_driver_performance_snapshot(date,date,jsonb) to anon,authenticated;
notify pgrst,'reload schema';

-- 0021_experience_daily_smart.sql

-- 0021_experience_daily_smart.sql
alter table public.experience_history add column if not exists experience_division text not null default 'Pharma';
alter table public.experience_history add column if not exists vehicle_type text not null default 'UNKNOWN';
alter table public.experience_history add column if not exists order_count integer not null default 0;
alter table public.experience_history add column if not exists consumer_orders integer not null default 0;
alter table public.experience_history add column if not exists pharma_orders integer not null default 0;
alter table public.experience_history add column if not exists source_batch_id uuid;
create index if not exists ix_experience_history_person_date on public.experience_history(person_code,person_type,date desc);
create index if not exists ix_experience_history_area on public.experience_history(area);
create index if not exists ix_experience_history_division on public.experience_history(experience_division);
create index if not exists ix_experience_history_vehicle_type on public.experience_history(vehicle_type);
create unique index if not exists ux_experience_history_daily on public.experience_history(person_code,person_type,date,area,vehicle_number);
create or replace function public.dispatchops_normalize_vehicle(v text) returns text language sql immutable as $$ select regexp_replace(upper(coalesce(v,'')),'[^A-Z0-9]','','g') $$;
create or replace function public.dispatchops_normalize_vehicle_type(v text, plate text default '') returns text language sql immutable as $$ select case when upper(coalesce(v,'')) like '%PICK%' or upper(coalesce(v,'')) like '%TRUCK%' then 'PICKUP' when upper(coalesce(v,'')) like '%VAN%' or upper(coalesce(v,'')) like '%BUS%' or upper(coalesce(v,'')) like '%2-8%' then 'VAN' when regexp_replace(upper(coalesce(plate,'')),'[^A-Z0-9]','','g') ~ '^[0-9]' then 'PICKUP' when regexp_replace(upper(coalesce(plate,'')),'[^A-Z0-9]','','g') <> '' then 'VAN' else 'UNKNOWN' end $$;
create or replace function public.dispatchops_rebuild_experience_history() returns jsonb language plpgsql as $$ declare inserted_count integer:=0; begin truncate table public.experience_history; insert into public.experience_history (person_code,person_name,person_type,area,sector,date,end_date,vehicle_number,experience_division,vehicle_type,order_count,consumer_orders,pharma_orders,source_batch_id) with base as (select s.dispatch_date work_date,coalesce(nullif(trim(s.area),''),nullif(trim(s.division_desc),''),'UNKNOWN') area,nullif(trim(s.driver_code),'') driver_code,nullif(trim(s.driver_name),'') driver_name,nullif(trim(s.helper_code),'') helper_code,nullif(trim(s.helper_name),'') helper_name,nullif(trim(s.vehicle_num),'') vehicle_number,dispatchops_normalize_vehicle(s.vehicle_num) vehicle_key,nullif(trim(s.salesman),'') salesman,s.batch_id source_batch_id from public.sap_invoice_facts s where s.dispatch_date is not null and coalesce(s.is_order,1)=1 and coalesce(s.excluded,false)=false and coalesce(s.is_resupply,false)=false and (nullif(trim(s.driver_code),'') is not null or nullif(trim(s.helper_code),'') is not null)), classified as (select b.*,case when cs.id is not null then 'Consumer' else 'Pharma' end order_division,dispatchops_normalize_vehicle_type(coalesce(v.vehicle_type,v.type,''),b.vehicle_number) resolved_vehicle_type from base b left join lateral(select c.id from public.consumer_salesmen c where lower(regexp_replace(trim(coalesce(c.name,c.salesman_name,'')),'\\s+',' ','g'))=lower(regexp_replace(trim(coalesce(b.salesman,'')),'\\s+',' ','g')) and trim(coalesce(b.salesman,''))<>'' limit 1) cs on true left join lateral(select vv.vehicle_type,vv.type from public.vehicles vv where dispatchops_normalize_vehicle(coalesce(vv.vehicle_number,vv.number,''))=b.vehicle_key order by vv.updated_at desc nulls last limit 1) v on true), persons as (select work_date,area,driver_code person_code,driver_name person_name,'Driver' person_type,vehicle_number,resolved_vehicle_type,order_division,source_batch_id from classified where driver_code is not null union all select work_date,area,helper_code,helper_name,'Helper',vehicle_number,resolved_vehicle_type,order_division,source_batch_id from classified where helper_code is not null), grouped as (select person_code,max(person_name) person_name,person_type,area,work_date,vehicle_number,max(resolved_vehicle_type) vehicle_type,count(*)::integer order_count,count(*) filter(where order_division='Consumer')::integer consumer_orders,count(*) filter(where order_division='Pharma')::integer pharma_orders,case when count(*) filter(where order_division='Consumer')>count(*) filter(where order_division='Pharma') then 'Consumer' else 'Pharma' end experience_division,max(source_batch_id::text)::uuid source_batch_id from persons group by person_code,person_type,area,work_date,vehicle_number) select person_code,person_name,person_type,area,experience_division,work_date,work_date,coalesce(vehicle_number,''),experience_division,coalesce(vehicle_type,'UNKNOWN'),order_count,consumer_orders,pharma_orders,source_batch_id from grouped; get diagnostics inserted_count=row_count; return jsonb_build_object('rows',inserted_count,'rebuilt_at',now()); end; $$;
create or replace function public.dispatchops_rebuild_daily_divisions() returns jsonb language plpgsql as $$ declare n integer:=0; begin truncate table public.driver_daily_divisions; insert into public.driver_daily_divisions(person_code,person_name,work_date,division,consumer_invoices,pharma_invoices) select person_code,max(person_name),date,case when sum(consumer_orders)>sum(pharma_orders) then 'Consumer' else 'Pharma' end,sum(consumer_orders)::integer,sum(pharma_orders)::integer from public.experience_history group by person_code,date; get diagnostics n=row_count; return jsonb_build_object('rows',n,'rebuilt_at',now()); end; $$;
create or replace function public.dispatchops_refresh_experience_after_salesman_change() returns trigger language plpgsql as $$ begin perform public.dispatchops_rebuild_experience_history(); perform public.dispatchops_rebuild_daily_divisions(); return coalesce(new,old); end; $$;
drop trigger if exists trg_refresh_experience_after_salesman_change on public.consumer_salesmen;
create trigger trg_refresh_experience_after_salesman_change after insert or update or delete on public.consumer_salesmen for each row execute function public.dispatchops_refresh_experience_after_salesman_change();

-- 0022_experience_route_planner_unification.sql
alter table public.experience_history add column if not exists area_code text not null default 'UNKNOWN';
alter table public.experience_history add column if not exists area_name text;
alter table public.experience_history add column if not exists experience_type text;
alter table public.experience_history add column if not exists route_type text;
alter table public.experience_history add column if not exists canonical_person_code text;
alter table public.experience_history add column if not exists canonical_person_name text;
alter table public.experience_history add column if not exists canonical_vehicle_number text;
create index if not exists ix_experience_history_person_area_date on public.experience_history(person_code,area_code,date desc);
create index if not exists ix_experience_history_route_lookup on public.experience_history(area_code,experience_division,vehicle_type,date desc);
drop trigger if exists trg_refresh_experience_after_salesman_change on public.consumer_salesmen;

-- 0024_experience_stable_key_and_dedup.sql
begin;
with ranked as (
  select id,row_number() over (partition by upper(coalesce(person_code,'')),upper(coalesce(person_type,'')),date,upper(regexp_replace(coalesce(nullif(area_code,'UNKNOWN'),area,''),'[^A-Z0-9]','','g')),upper(regexp_replace(coalesce(vehicle_number,''),'[^A-Z0-9]','','g')) order by created_at desc nulls last,id desc) rn from public.experience_history)
delete from public.experience_history e using ranked r where e.id=r.id and r.rn>1;
alter table public.experience_history add column if not exists experience_key text;
update public.experience_history set experience_key=upper(coalesce(person_code,''))||'|'||upper(coalesce(person_type,''))||'|'||coalesce(date::text,'')||'|'||upper(regexp_replace(coalesce(nullif(area_code,'UNKNOWN'),area,''),'[^A-Z0-9]','','g'))||'|'||upper(regexp_replace(coalesce(vehicle_number,''),'[^A-Z0-9]','','g'));
create or replace function public.set_experience_key() returns trigger language plpgsql set search_path=public as $$ begin new.experience_key:=upper(coalesce(new.person_code,''))||'|'||upper(coalesce(new.person_type,''))||'|'||coalesce(new.date::text,'')||'|'||upper(regexp_replace(coalesce(nullif(new.area_code,'UNKNOWN'),new.area,''),'[^A-Z0-9]','','g'))||'|'||upper(regexp_replace(coalesce(new.vehicle_number,''),'[^A-Z0-9]','','g')); return new; end; $$;
drop trigger if exists trg_set_experience_key on public.experience_history;
create trigger trg_set_experience_key before insert or update of person_code,person_type,date,area_code,area,vehicle_number on public.experience_history for each row execute function public.set_experience_key();
create unique index if not exists ux_experience_history_stable_key on public.experience_history(experience_key);
commit;
