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
