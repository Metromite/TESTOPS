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
