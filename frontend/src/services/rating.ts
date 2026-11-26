import { getPrimarySupabaseClient } from "../lib/supabase";

export type RatingPersonType = "Driver" | "Helper";
export type RatingSeverity = "Low" | "Medium" | "High";
export type RatingEntryType = "negative" | "positive";
export type RatingStatus = "pending" | "approved" | "rejected";
export interface RatingPermissions { user_id: string; username: string; is_admin: boolean; is_supervisor: boolean }
export interface RatingIncident {
  id: string; person_type: RatingPersonType; person_id: string; person_code: string; person_name: string;
  occurred_at: string; category: string; category_other: string; severity: RatingSeverity; entry_type: RatingEntryType; points_deducted: number; points_awarded: number;
  details: string; status: RatingStatus; created_by: string; created_by_name: string; approved_by: string | null;
  approved_by_name: string; approved_at: string | null; review_note: string; created_at: string; updated_at: string;
}
const db = () => getPrimarySupabaseClient();
function raise(error: any, context: string): never | void { if (error) throw new Error(`${context}: ${error.message || error}`); }
export async function openRatingSession(username: string, password: string): Promise<string> {
  const { data, error } = await db().rpc("dispatchops_rating_session_open", { p_username: username, p_password: password });
  raise(error, "Could not establish Rating session");
  if (!data?.token) throw new Error("Rating session token was not returned");
  return String(data.token);
}
export async function getRatingPermissions(sessionToken: string): Promise<RatingPermissions> {
  const { data, error } = await db().rpc("dispatchops_rating_bootstrap", { p_session_token: sessionToken });
  raise(error, "Could not load Rating permissions"); return data as RatingPermissions;
}
export async function listRatingIncidents(sessionToken: string): Promise<RatingIncident[]> {
  const { data, error } = await db().rpc("dispatchops_rating_list", { p_session_token: sessionToken });
  raise(error, "Could not load incidents"); return (Array.isArray(data) ? data : []) as RatingIncident[];
}
export async function createRatingIncident(sessionToken: string, input: {personType: RatingPersonType; personId: string; category: string; categoryOther: string; entryType: RatingEntryType; severity: RatingSeverity; details: string; occurredAt: string}): Promise<RatingIncident> {
  const { data, error } = await db().rpc("dispatchops_rating_create_entry", {
    p_session_token: sessionToken, p_person_type: input.personType, p_person_id: input.personId,
    p_category: input.category, p_category_other: input.categoryOther, p_entry_type: input.entryType,
    p_severity: input.severity, p_details: input.details, p_occurred_at: input.occurredAt,
  });
  raise(error, "Could not save incident"); return data as RatingIncident;
}
export async function reviewRatingIncident(sessionToken: string, incidentId: string, decision: "approved" | "rejected", note = ""): Promise<RatingIncident> {
  const { data, error } = await db().rpc("dispatchops_rating_review", { p_session_token: sessionToken, p_incident_id: incidentId, p_decision: decision, p_review_note: note });
  raise(error, "Could not review incident"); return data as RatingIncident;
}
export async function listRatingSupervisors(adminUsername: string, adminPassword: string): Promise<string[]> {
  const { data, error } = await db().rpc("dispatchops_rating_supervisor_list", { p_admin_username: adminUsername, p_admin_password: adminPassword });
  raise(error, "Could not load Rating supervisors"); return Array.isArray(data) ? data.map(String) : [];
}
export async function setRatingSupervisor(adminUsername: string, adminPassword: string, userId: string, enabled: boolean): Promise<void> {
  const { error } = await db().rpc("dispatchops_rating_supervisor_set", { p_admin_username: adminUsername, p_admin_password: adminPassword, p_user_id: userId, p_enabled: enabled });
  raise(error, "Could not update supervisor permission");
}
export async function resetAllRatings(adminUsername: string, adminPassword: string): Promise<number> {
  const { data, error } = await db().rpc("dispatchops_rating_reset", { p_admin_username: adminUsername, p_admin_password: adminPassword });
  raise(error, "Could not reset Rating records"); return Number(data || 0);
}

export async function deleteRatingIncident(adminUsername: string, adminPassword: string, incidentId: string): Promise<void> {
  const { error } = await db().rpc("dispatchops_rating_delete_incident", { p_admin_username: adminUsername, p_admin_password: adminPassword, p_incident_id: incidentId });
  raise(error, "Could not delete incident");
}
