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
