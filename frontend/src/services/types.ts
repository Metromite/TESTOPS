// ============================================================================
// Row types mirroring supabase/migrations/*.sql column-for-column. Keep
// these in sync with the migrations by hand for now — once the schema
// stabilizes, `supabase gen types typescript` can generate this file
// directly from the live project instead.
// ============================================================================

export interface Driver {
  id: string;
  code: string;
  name: string;
  veh_type: string;
  anchor_area: string;
  health_card: string;
  division: string;
  preferred_helper: string;
  status: string;
  updated_at: string;
}

export interface Helper {
  id: string;
  code: string;
  name: string;
  anchor_area: string;
  health_card: string;
  division: string;
  status: string;
  updated_at: string;
}

export interface Area {
  id: string;
  code: string;
  name: string;
  sector: string;
  region: string;
  needs_driver: string;
  needs_helper: string;
  route_type: string;
  vehicle_type: string;
}

export interface Vehicle {
  id: string;
  number: string;
  type: string;
  division: string;
  status: string;
}

export interface VehiclePermittedArea {
  id: string;
  vehicle_id: string;
  area_id: string;
}

export interface AreaAnchoredVehicle {
  id: string;
  area_id: string;
  vehicle_id: string;
}

export interface Vacation {
  id: string;
  person_code: string;
  person_name: string;
  person_type: "Driver" | "Helper";
  start_date: string;
  end_date: string;
}

export interface ExperienceHistoryRow {
  id: string;
  person_code: string;
  person_name: string;
  person_type: "Driver" | "Helper";
  area: string;
  area_code?: string;
  area_name?: string;
  sector: string;
  date: string;
  end_date: string | null;
  vehicle_number: string;
  experience_division?: string;
  vehicle_type?: string;
  experience_type?: string;
  route_type?: string;
  order_count?: number;
  consumer_orders?: number;
  pharma_orders?: number;
  source_batch_id?: string | null;
}

export interface AreaGroup {
  id: string;
  name: string;
}

export interface AreaGroupMember {
  id: string;
  group_id: string;
  area_id: string;
}

export interface DriverAnchoredArea {
  id: string;
  driver_id: string;
  area_id: string;
  sort_order: number;
}

export interface DriverAnchoredAreaGroup {
  id: string;
  driver_id: string;
  group_id: string;
  sort_order: number;
}

export interface VehiclePermittedAreaGroup {
  id: string;
  vehicle_id: string;
  group_id: string;
}

export interface RouteAssignment {
  id: string;
  plan_batch_id: string;
  plan_role: "driver" | "helper";
  area_code: string;
  area_name: string;
  sector: string;
  route_type: string;
  driver_requirement: string;
  helper_requirement: string;
  driver_code: string;
  driver_name: string;
  helper_code: string;
  helper_name: string;
  vehicle_number: string;
  vehicle_type: string;
  anchored_vehicle_number: string;
  vehicle_assignment_reason: string;
  start_date: string;
  end_date: string;
  driver_score: number;
  driver_reason: string;
  helper_score: number;
  helper_reason: string;
  assignment_reason: string;
  restrictions_considered: string;
  is_vacation_replacement: boolean;
  original_person_code: string;
  original_person_name: string;
  vacation_start_date: string | null;
  vacation_end_date: string | null;
  vacation_replacement_reason: string;
  is_manually_edited: boolean;
  status: string;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ImportBatch {
  id: string;
  source_type: string;
  original_filename: string;
  imported_by: string;
  imported_by_device: string;
  imported_at: string;
  row_count: number;
  success_count: number;
  failed_count: number;
  validation_errors: unknown[];
  status: "pending" | "processing" | "completed" | "failed" | "partial";
  // Storage metadata (migration 0006) — the original file itself lives in
  // the `dispatchops-files` bucket at storage_path, never in this table.
  storage_bucket: string;
  storage_path: string | null;
  file_size_bytes: number | null;
  storage_project?: "primary" | "secondary";
  // Manual delete only — see imports.ts deleteImportFile(). Never set by
  // any automatic process.
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface RawImportRow {
  id: string;
  source_type: "sap" | "landmark";
  batch_id: string;
  source_filename: string;
  row_index: number;
  row_json: Record<string, unknown>;
  imported_at: string;
  imported_by: string;
  label: string;
}

export interface AiProviderConfig {
  id: string;
  provider: string;
  model: string;
  api_key: string; // see supabase.ts / migration 0005 — do not populate with a real secret centrally
  fallback_enabled: boolean;
  fallback_provider: string;
  fallback_model: string;
  fallback_key: string;
  fallback_chain: unknown[];
  updated_by: string;
  updated_at: string;
}

export interface AppearanceConfig {
  id: string;
  light_bg_path: string;
  dark_bg_path: string;
  updated_by: string;
  updated_at: string;
}

export interface ControlCenterConfig {
  id: string;
  config: Record<string, unknown>;
  version: number;
  updated_by: string;
  updated_at: string;
}

export interface RouteSheetLayout {
  id: string;
  column_order: string[];
  hidden_columns: string[];
  column_widths: Record<string, number>;
  updated_by: string;
  updated_at: string;
}

export interface FeatureFlag {
  name: string;
  enabled: boolean;
  description: string;
  updated_by: string;
  updated_at: string;
}

export interface AuditLogEntry {
  id: string;
  entity_type: string;
  entity_key: string;
  action: "create" | "update" | "delete";
  actor: string;
  before_state: Record<string, unknown>;
  after_state: Record<string, unknown>;
  success: boolean;
  error_message: string;
  duration_ms: number;
  undone: boolean;
  timestamp: string;
}

export interface Job {
  id: string;
  job_type: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  message: string;
  result: unknown;
  error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const SETTINGS_SINGLETON_ID = "00000000-0000-0000-0000-000000000001";
