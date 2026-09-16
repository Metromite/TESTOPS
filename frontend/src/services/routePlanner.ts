import * as XLSX from "xlsx";
import { saveWorkbookToDispatchFolder } from "./desktopExport";
import { supabase, getSupabaseClientByProject, getFederatedSupabaseClients } from "@/lib/supabase";
import type { Area, Driver, Helper, RouteAssignment, Vacation, Vehicle } from "./types";

export interface RankedCandidate { code: string; name: string; score: number; reason: string; vac_status?: string }
export interface CandidateAreaResult { area_code: string; area_name: string; sector: string; route_type: string; required_vehicle: string; ranked_drivers: RankedCandidate[]; ranked_helpers: RankedCandidate[]; top_driver_breakdown: { factor: string; points: number | null }[]; top_helper_breakdown: { factor: string; points: number | null }[] }
export interface CandidatePlan { fleet_errors: string[]; areas: CandidateAreaResult[] }

interface ExperienceCache { areas: Record<string, string>; areaCodes: Record<string, string>; sectors: Record<string, string>; sectorAreas: Record<string, string>; vehicleTypes: Record<string, string>; }
interface CandidateBase { code: string; name: string; anchor_area?: string; health_card?: string; veh_type?: string }

const SINGLETON_ID = "00000000-0000-0000-0000-000000000001";
const NEVER_WORKED_BONUS = 10000;
const NEVER_WORKED_SECTOR_BONUS = 8000;
const ANCHOR_MATCH_BONUS = 50000;
const MONTHS_WEIGHT = 100;
const SECTOR_MONTHS_WEIGHT = 50;
const RECENT_AREA_PENALTY = -3000;
const VACATION_SOON_PENALTY = -1500;

function normalizeText(value: unknown): string {
  const s = value == null ? "" : String(value).trim();
  if (/^(nan|none|nat|null)$/i.test(s)) return "";
  if (/2\s*-\s*8/i.test(s)) return "2-8 VAN";
  const up = s.toUpperCase();
  if (up === "PHARMA") return "Pharma";
  if (up === "CONSUMER") return "Consumer";
  if (up === "PICK UP" || up === "PICK-UP") return "PICK-UP";
  if (up === "VAN" || up === "BUS") return up;
  return s;
}

function dateOnly(value: string): string { return value.slice(0, 10); }
function daysBetween(a: string, b: string): number { return (new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86400000; }
function addDays(date: string, days: number): string { const d = new Date(`${date}T00:00:00`); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }

async function loadRouteInputs() {
  const [areasR, driversR, helpersR, vehiclesR, vacationsR, experienceR, divisionsR, anchorR, groupAnchorR, groupMembersR, anchoredVehiclesR, permittedR] = await Promise.all([
    supabase.from("areas").select("*").order("route_type").order("code"),
    supabase.from("drivers").select("*").eq("status", "Active"),
    supabase.from("helpers").select("*").eq("status", "Active"),
    supabase.from("vehicles").select("*").eq("status", "Active"),
    supabase.from("vacations").select("*"),
    Promise.all(getFederatedSupabaseClients().map((c:any)=>c.from("experience_history").select("*"))).then(results=>{const err=results.map(r=>r.error).find(Boolean);if(err)throw err;const seen=new Set<string>();return {data:results.flatMap(r=>r.data||[]).filter((r:any)=>{const k=`${r.person_code}|${r.person_type}|${String(r.date||"").slice(0,10)}|${r.area_code||r.area}|${String(r.vehicle_number||"").toUpperCase().replace(/[^A-Z0-9]/g,"")}`;if(seen.has(k))return false;seen.add(k);return true;}),error:null}}),
    supabase.from("driver_daily_divisions").select("person_code,division,work_date"),
    supabase.from("driver_anchored_areas").select("driver_id,area_id,sort_order"),
    supabase.from("driver_anchored_area_groups").select("driver_id,group_id,sort_order"),
    supabase.from("area_group_members").select("group_id,area_id"),
    supabase.from("area_anchored_vehicles").select("area_id,vehicle_id"),
    supabase.from("vehicle_permitted_areas").select("vehicle_id,area_id"),
  ]);
  const errors = [areasR, driversR, helpersR, vehiclesR, vacationsR, experienceR, divisionsR, anchorR, groupAnchorR, groupMembersR, anchoredVehiclesR, permittedR].map((r) => r.error).filter(Boolean);
  if (errors.length) throw new Error(errors[0]?.message || "Failed to load route planning data");
  return {
    areas: (areasR.data || []) as Area[], drivers: (driversR.data || []) as Driver[], helpers: (helpersR.data || []) as Helper[], vehicles: (vehiclesR.data || []) as Vehicle[], vacations: (vacationsR.data || []) as Vacation[],
    experience: experienceR.data || [], divisions: divisionsR.data || [], driverAnchors: anchorR.data || [], driverGroupAnchors: groupAnchorR.data || [], groupMembers: groupMembersR.data || [], anchoredVehicles: anchoredVehiclesR.data || [], permittedAreas: permittedR.data || [],
  };
}

function buildVacationMap(vacations: Vacation[]): Map<string, Vacation[]> {
  const map = new Map<string, Vacation[]>();
  for (const v of vacations) { const list = map.get(v.person_code) || []; list.push(v); map.set(v.person_code, list); }
  return map;
}

function isOnVacation(code: string, date: string, vacs: Map<string, Vacation[]>): boolean {
  return (vacs.get(code) || []).some((v) => dateOnly(v.start_date) <= date && date <= dateOnly(v.end_date));
}

export async function getVacationStatus(code: string, date = new Date().toISOString().slice(0, 10)): Promise<{ status: string }> {
  const { data, error } = await supabase.from("vacations").select("start_date,end_date").eq("person_code", code).order("start_date");
  if (error) throw new Error(error.message);
  const rows = data || [];
  if (!rows.length) return { status: "Never" };
  for (const v of rows) if (dateOnly(v.start_date) <= date && date <= dateOnly(v.end_date)) return { status: `On leave (${Math.max(0, Math.round(daysBetween(dateOnly(v.end_date), date)))} days left)` };
  const past = rows.filter((v) => dateOnly(v.end_date) < date).sort((a, b) => dateOnly(b.end_date).localeCompare(dateOnly(a.end_date)));
  if (past.length) return { status: `Back (${Math.round(daysBetween(date, dateOnly(past[0].end_date)))} days ago)` };
  const future = rows.filter((v) => dateOnly(v.start_date) > date).sort((a, b) => dateOnly(a.start_date).localeCompare(dateOnly(b.start_date)));
  if (future.length) return { status: `Upcoming (in ${Math.round(daysBetween(dateOnly(future[0].start_date), date))} days)` };
  return { status: "Never" };
}

function buildExperience(experienceRows: Record<string, unknown>[], divisionRows: Record<string, unknown>[]): Map<string, ExperienceCache> {
  const map = new Map<string, ExperienceCache>();
  const ensure = (code: string) => { const current = map.get(code) || { areas: {}, areaCodes: {}, sectors: {}, sectorAreas: {}, vehicleTypes: {} }; map.set(code, current); return current; };
  for (const r of experienceRows) {
    const code = String(r.person_code || ""), area = normalizeText(r.experienced_area_name || r.area_name || r.area), areaCode = normalizeText(r.experienced_area_code || r.area_code), sector = normalizeText(r.sector || "Pharma"), experience = normalizeText(r.experience_division || r.experience_type || "Pharma"), vehicleType = normalizeText(r.vehicle_type || ""), end = dateOnly(String(r.end_date || r.date || ""));
    if (!code || !end) continue; const c = ensure(code); if (area && (!c.areas[area] || end > c.areas[area])) c.areas[area] = end; if (areaCode && (!c.areaCodes[areaCode] || end > c.areaCodes[areaCode])) c.areaCodes[areaCode] = end; if (!c.sectors[sector] || end > c.sectors[sector]) c.sectors[sector] = end; const sa = `${sector}|${experience}`; if (!c.sectorAreas[sa] || end > c.sectorAreas[sa]) c.sectorAreas[sa] = end; if (vehicleType && (!c.vehicleTypes[vehicleType] || end > c.vehicleTypes[vehicleType])) c.vehicleTypes[vehicleType] = end;
  }
  for (const r of divisionRows) {
    const code = String(r.person_code || ""), sector = normalizeText(r.division || "Pharma"), end = dateOnly(String(r.work_date || ""));
    if (!code || !end) continue; const c = ensure(code); if (!c.sectors[sector] || end > c.sectors[sector]) c.sectors[sector] = end;
  }
  return map;
}

function scoreCandidate(candidate: CandidateBase, area: Area, targetDate: string, exp: Map<string, ExperienceCache>, vacs: Map<string, Vacation[]>, role: "Driver" | "Helper", hcAssigned = 0): RankedCandidate | null {
  const code = candidate.code; if (isOnVacation(code, targetDate, vacs)) return null;
  const canonicalVeh = (v: unknown) => { const x=normalizeText(v).toUpperCase(); if(x.includes("PICK")) return "PICKUP"; if(x.includes("VAN")||x.includes("BUS")||x.includes("2-8")) return "VAN"; return x; };
  const reqVeh = canonicalVeh(area.vehicle_type || "VAN"), reqSector = normalizeText(area.sector || "Pharma");
  if (role === "Driver") { const p = canonicalVeh(candidate.veh_type || ""); if (p && p !== reqVeh && !(p === "VAN / PICKUP" && (reqVeh === "VAN" || reqVeh === "PICKUP"))) return null; }
  let score = 0; const reasons: string[] = [];
  const anchors = String(candidate.anchor_area || "").split(",").map((x) => normalizeText(x).toUpperCase()).filter(Boolean);
  if (anchors.length) {
    const checks = [area.name, area.code, reqSector, reqVeh].map((x) => normalizeText(x).toUpperCase());
    const matched = anchors.some((a) => checks.some((c) => a.includes(c) || c.includes(a)));
    if (!matched) return null; score += ANCHOR_MATCH_BONUS; reasons.push(`Anchor Match (+${ANCHOR_MATCH_BONUS})`);
  }
  const cache = exp.get(code);
  const lastArea = cache?.areaCodes[normalizeText(area.code)] || cache?.areas[normalizeText(area.name)];
  if (!lastArea) { score += NEVER_WORKED_BONUS; reasons.push(`Never worked Area (+${NEVER_WORKED_BONUS})`); }
  else { const months = daysBetween(targetDate, lastArea) / 30; if (months < 3) { score += RECENT_AREA_PENALTY; reasons.push(`Recent Area Visit <3m (${RECENT_AREA_PENALTY})`); } else { const pts = Math.trunc(months * MONTHS_WEIGHT); score += pts; reasons.push(`${months.toFixed(1)}m since area (+${pts})`); } }
  const lastSector = cache?.sectors[reqSector];
  if (!lastSector) { score += NEVER_WORKED_SECTOR_BONUS; reasons.push(`Never worked ${reqSector} Sector (+${NEVER_WORKED_SECTOR_BONUS})`); }
  else { const months = daysBetween(targetDate, lastSector) / 30; const pts = Math.trunc(months * SECTOR_MONTHS_WEIGHT); score += pts; reasons.push(`${months.toFixed(1)}m since ${reqSector} Sector (+${pts})`); }
  const lastSectorExperience = cache?.sectorAreas[`${reqSector}|${reqSector}`] || cache?.sectorAreas[`${reqSector}|${normalizeText(area.sector)}`];
  if (lastSectorExperience) { const months = Math.max(0, daysBetween(targetDate, lastSectorExperience) / 30); score += Math.trunc(months * 75); reasons.push(`Recent ${reqSector} Experience (+${Math.trunc(months * 75)})`); }
  const lastVehicleType = cache?.vehicleTypes[reqVeh] || cache?.vehicleTypes[reqVeh === "PICKUP" ? "PICK-UP" : "VAN"];
  if (lastVehicleType) { score += 750; reasons.push(`Experienced on ${reqVeh} (+750)`); }
  const upcoming = (vacs.get(code) || []).find((v) => targetDate < dateOnly(v.start_date) && dateOnly(v.start_date) <= addDays(targetDate, 90));
  if (upcoming) { score += VACATION_SOON_PENALTY; reasons.push(`Vacation soon (${VACATION_SOON_PENALTY})`); }
  const hasCard = String(candidate.health_card || "").toLowerCase() === "yes";
  if (reqSector.includes("Consumer")) { if (hasCard) { const pts = hcAssigned < 3 ? 5000 : 500; score += pts; reasons.push(`${hcAssigned < 3 ? "Required HC for Consumer" : "HC in Consumer"} (+${pts})`); } else if (hcAssigned < 3) { score -= 2000; reasons.push("Non-HC Penalty (-2000)"); } }
  else if (hasCard) { const pts = hcAssigned < 3 ? -3000 : -200; score += pts; reasons.push(`${hcAssigned < 3 ? "Reserved HC for Consumer" : "Saved HC"} (${pts})`); }
  return { code, name: candidate.name, score, reason: reasons.join(" | ") };
}

function breakdown(reason: string) { return reason.split(" | ").filter(Boolean).map((chunk) => { const m = chunk.match(/^(.*?)\s*\(([+-]?\d+)\)$/); return { factor: m ? m[1].trim() : chunk, points: m ? Number(m[2]) : null }; }); }

function addStructuredAnchors(drivers: Driver[], areas: Area[], direct: Record<string, unknown>[], groupAnchors: Record<string, unknown>[], groupMembers: Record<string, unknown>[]): Driver[] {
  const areaById = new Map(areas.map((a) => [a.id, a])); const memberMap = new Map<string, string[]>();
  for (const m of groupMembers) { const gid = String(m.group_id), list = memberMap.get(gid) || []; list.push(String(m.area_id)); memberMap.set(gid, list); }
  return drivers.map((d) => {
    const tokens = new Set(String(d.anchor_area || "").split(",").map((x) => x.trim()).filter(Boolean));
    for (const a of direct) if (String(a.driver_id) === d.id) { const area = areaById.get(String(a.area_id)); if (area) { tokens.add(area.code); tokens.add(area.name); } }
    for (const g of groupAnchors) if (String(g.driver_id) === d.id) for (const aid of memberMap.get(String(g.group_id)) || []) { const area = areaById.get(aid); if (area) { tokens.add(area.code); tokens.add(area.name); } }
    return { ...d, anchor_area: [...tokens].join(",") };
  });
}

function fleetErrors(areas: Area[], drivers: Driver[], vehicles: Vehicle[], vacations: Map<string, Vacation[]>, targetDate: string): string[] {
  const errors: string[] = []; const activeDrivers = drivers.filter((d) => !isOnVacation(d.code, targetDate, vacations)).length;
  const mainMandatory = areas.filter((a) => a.needs_driver === "Mandatory" && a.route_type === "Main Route").length; const totalMandatory = areas.filter((a) => a.needs_driver === "Mandatory").length;
  if (activeDrivers < mainMandatory) errors.push(`URGENT - Missing Drivers for MAIN routes: need ${mainMandatory}, only have ${activeDrivers}.`); else if (activeDrivers < totalMandatory) errors.push(`Missing Drivers: ${totalMandatory - activeDrivers} Replacement route(s) will go uncovered (Main routes are fully covered).`);
  const types = new Set(areas.map((a) => normalizeText(a.vehicle_type || "VAN")));
  for (const t of types) { const main = areas.filter((a) => a.needs_driver !== "Optional" && a.route_type === "Main Route" && normalizeText(a.vehicle_type || "VAN") === t).length; const total = areas.filter((a) => a.needs_driver !== "Optional" && normalizeText(a.vehicle_type || "VAN") === t).length; const have = vehicles.filter((v) => normalizeText(v.type) === t || (normalizeText(v.type) === "VAN / PICK-UP" && (t === "VAN" || t === "PICK-UP"))).length; if (have < main) errors.push(`URGENT - Missing ${t} Vehicles for MAIN routes: need ${main}, only have ${have} active.`); else if (have < total) errors.push(`Missing ${t} Vehicles: ${total - have} Replacement route(s) will go uncovered.`); }
  return errors;
}

export async function generateCandidatePlan(targetDate: string): Promise<CandidatePlan> {
  const input = await loadRouteInputs(); const vacs = buildVacationMap(input.vacations); const exp = buildExperience(input.experience as Record<string, unknown>[], input.divisions as Record<string, unknown>[]); const drivers = addStructuredAnchors(input.drivers, input.areas, input.driverAnchors, input.driverGroupAnchors, input.groupMembers);
  const areas = [...input.areas].sort((a, b) => (a.route_type === "Main Route" ? 0 : 1) - (b.route_type === "Main Route" ? 0 : 1) || a.code.localeCompare(b.code));
  const results = areas.map((a) => {
    const rankedDrivers = drivers.map((d) => scoreCandidate(d, a, targetDate, exp, vacs, "Driver")).filter((x): x is RankedCandidate => x !== null).sort((x, y) => y.score - x.score);
    const rankedHelpers = a.needs_helper === "Not Required" ? [] : input.helpers.map((h) => scoreCandidate(h, a, targetDate, exp, vacs, "Helper")).filter((x): x is RankedCandidate => x !== null).sort((x, y) => y.score - x.score);
    return { area_code: a.code, area_name: a.name, sector: a.sector, route_type: a.route_type === "Main Route" ? "Main" : "Replacement", required_vehicle: normalizeText(a.vehicle_type || "VAN"), ranked_drivers: rankedDrivers, ranked_helpers: rankedHelpers, top_driver_breakdown: rankedDrivers[0] ? breakdown(rankedDrivers[0].reason) : [], top_helper_breakdown: rankedHelpers[0] ? breakdown(rankedHelpers[0].reason) : [] };
  });
  return { fleet_errors: fleetErrors(input.areas, drivers, input.vehicles, vacs, targetDate), areas: results };
}

function pickVehicle(area: Area, vehicles: Vehicle[], used: Set<string>, anchoredRows: Record<string, unknown>[], permitted: Record<string, unknown>[]): { number: string; type: string; reason: string; anchored: string } {
  const anchoredIds = anchoredRows.filter((r) => String(r.area_id) === area.id).map((r) => String(r.vehicle_id));
  const permittedIds = new Set(permitted.filter((r) => String(r.area_id) === area.id).map((r) => String(r.vehicle_id)));
  const req = normalizeText(area.vehicle_type || "VAN");
  const eligible = vehicles.filter((v) => !used.has(v.id) && (normalizeText(v.type) === req || (normalizeText(v.type) === "VAN / PICK-UP" && (req === "VAN" || req === "PICK-UP"))) && (!permittedIds.size || permittedIds.has(v.id)));
  const anchored = eligible.find((v) => anchoredIds.includes(v.id)); const chosen = anchored || eligible[0];
  if (!chosen) return { number: "", type: req, reason: "No eligible active vehicle", anchored: "" };
  used.add(chosen.id); return { number: chosen.number, type: chosen.type, reason: anchored ? "Anchored vehicle" : permittedIds.size ? "Permitted vehicle" : "Matching active vehicle", anchored: anchored ? chosen.number : "" };
}

export async function generatePersistedPlan(planRole: "driver" | "helper", targetDate: string): Promise<{ batch_id: string; rows_created: number; fleet_errors: string[] }> {
  const [candidatePlan, input] = await Promise.all([generateCandidatePlan(targetDate), loadRouteInputs()]);
  const { data: sticky, error: stickyError } = await supabase.from("route_assignments").select("*").eq("plan_role", planRole).eq("is_manually_edited", true); if (stickyError) throw new Error(stickyError.message);
  const existingSticky = (sticky || []) as RouteAssignment[]; const stickyByArea = new Map(existingSticky.map((r) => [`${r.area_code}|${r.sector}`, r]));
  const batchId = crypto.randomUUID(); const usedPeople = new Set<string>(); const usedVehicles = new Set<string>(); const areaByKey = new Map(input.areas.map((a) => [`${a.code}|${a.sector}`, a]));
  const rows: Partial<RouteAssignment>[] = [];
  for (let i = 0; i < candidatePlan.areas.length; i++) {
    const result = candidatePlan.areas[i]; const key = `${result.area_code}|${result.sector}`; const stickyRow = stickyByArea.get(key);
    if (stickyRow) { rows.push({ ...stickyRow, id: undefined, plan_batch_id: batchId, created_at: undefined, updated_at: undefined, sort_order: stickyRow.sort_order ?? i }); usedPeople.add(planRole === "driver" ? stickyRow.driver_code : stickyRow.helper_code); continue; }
    const area = areaByKey.get(key); if (!area) continue;
    const candidates = planRole === "driver" ? result.ranked_drivers : result.ranked_helpers; const chosen = candidates.find((c) => !usedPeople.has(c.code)); if (chosen) usedPeople.add(chosen.code);
    const vehicle = planRole === "driver" ? pickVehicle(area, input.vehicles, usedVehicles, input.anchoredVehicles, input.permittedAreas) : { number: "", type: normalizeText(area.vehicle_type), reason: "", anchored: "" };
    rows.push({ plan_batch_id: batchId, plan_role: planRole, area_code: area.code, area_name: area.name, sector: area.sector, route_type: area.route_type, driver_requirement: area.needs_driver, helper_requirement: area.needs_helper,
      driver_code: planRole === "driver" ? chosen?.code || "" : "", driver_name: planRole === "driver" ? chosen?.name || "" : "", helper_code: planRole === "helper" ? chosen?.code || "" : "", helper_name: planRole === "helper" ? chosen?.name || "" : "", vehicle_number: vehicle.number, vehicle_type: vehicle.type, anchored_vehicle_number: vehicle.anchored, vehicle_assignment_reason: vehicle.reason,
      start_date: targetDate, end_date: addDays(targetDate, 89), driver_score: planRole === "driver" ? chosen?.score || 0 : 0, driver_reason: planRole === "driver" ? chosen?.reason || "" : "", helper_score: planRole === "helper" ? chosen?.score || 0 : 0, helper_reason: planRole === "helper" ? chosen?.reason || "" : "", assignment_reason: chosen ? "Highest eligible score while avoiding assignment conflicts" : "No eligible candidate available", restrictions_considered: "Vacation, anchor area, vehicle type, health card, experience recency, duplicate assignment", is_vacation_replacement: false, original_person_code: "", original_person_name: "", vacation_replacement_reason: "", is_manually_edited: false, status: chosen ? "Pending" : "Shortage", sort_order: i, created_by: "" });
  }
  const { error: del } = await supabase.from("route_assignments").delete().eq("plan_role", planRole); if (del) throw new Error(del.message);
  if (rows.length) { const payload = rows.map((r) => { const cleanRow = { ...r }; delete cleanRow.id; delete cleanRow.created_at; delete cleanRow.updated_at; return cleanRow; }); const { error } = await supabase.from("route_assignments").insert(payload); if (error) throw new Error(error.message); }
  await writeAudit(`route_plan_${planRole}`, batchId, "generate", { target_date: targetDate, rows_created: rows.length });
  return { batch_id: batchId, rows_created: rows.length, fleet_errors: candidatePlan.fleet_errors };
}

export async function getCurrentPlan<T>(planRole: "driver" | "helper"): Promise<T[]> {
  const { data: latest, error: e1 } = await supabase.from("route_assignments").select("plan_batch_id,created_at").eq("plan_role", planRole).order("created_at", { ascending: false }).limit(1).maybeSingle(); if (e1) throw new Error(e1.message); if (!latest) return [];
  const { data, error } = await supabase.from("route_assignments").select("*").eq("plan_role", planRole).eq("plan_batch_id", latest.plan_batch_id).order("sort_order"); if (error) throw new Error(error.message); return (data || []) as unknown as T[];
}

export async function updatePlanRow<T>(rowId: string, changes: Record<string, unknown>): Promise<T> {
  const conflictFields = [["driver_code", "Driver"], ["helper_code", "Helper"], ["vehicle_number", "Vehicle"]] as const;
  const { data: current, error: currentError } = await supabase.from("route_assignments").select("plan_batch_id,plan_role,area_code,sector").eq("id", rowId).single(); if (currentError) throw new Error(currentError.message);
  for (const [field, label] of conflictFields) { const value = String(changes[field] || ""); if (!value) continue; const { count, error } = await supabase.from("route_assignments").select("id", { head: true, count: "exact" }).eq("plan_batch_id", current.plan_batch_id).eq("plan_role", current.plan_role).eq(field, value).neq("id", rowId); if (error) throw new Error(error.message); if ((count || 0) > 0) throw new Error(`${label} ${value} is already assigned in this route plan.`); }
  const payload = { ...changes, is_manually_edited: true, assignment_reason: "Manually edited by dispatcher" }; const { data, error } = await supabase.from("route_assignments").update(payload).eq("id", rowId).select("*").single(); if (error) throw new Error(error.message); await writeAudit(`route_plan_${current.plan_role}_row`, rowId, "update", payload); return data as unknown as T;
}

export async function getCombinedSheet<T>(): Promise<T[]> {
  const [drivers, helpers] = await Promise.all([getCurrentPlan<RouteAssignment>("driver"), getCurrentPlan<RouteAssignment>("helper")]);
  const byKey = new Map<string, RouteAssignment & { sn?: number; score?: number }>(); for (const r of drivers) byKey.set(`${r.area_code}|${r.sector}`, { ...r, score: r.driver_score });
  for (const h of helpers) { const key = `${h.area_code}|${h.sector}`; const current = byKey.get(key); if (current) byKey.set(key, { ...current, helper_code: h.helper_code, helper_name: h.helper_name, helper_score: h.helper_score, helper_reason: h.helper_reason, assignment_reason: [current.assignment_reason, h.assignment_reason].filter(Boolean).join(" / ") }); else byKey.set(key, { ...h, score: h.helper_score }); }
  const rows = [...byKey.values()].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map((r, i) => ({ ...r, sn: i + 1, division: r.sector, area: r.area_name, score: Math.max(r.driver_score || 0, r.helper_score || 0) })); return rows as unknown as T[];
}

interface SheetColumnDef { key: string; label: string; width: number }
const DEFAULT_COLUMNS: SheetColumnDef[] = [
  { key: "sn", label: "S/N", width: 60 }, { key: "sector", label: "Division", width: 110 }, { key: "driver_code", label: "Driver Code", width: 100 }, { key: "driver_name", label: "Driver Name", width: 160 }, { key: "area_name", label: "Area", width: 150 }, { key: "helper_code", label: "Helper Code", width: 100 }, { key: "helper_name", label: "Helper Name", width: 160 }, { key: "vehicle_type", label: "Vehicle Type", width: 110 }, { key: "vehicle_number", label: "Vehicle Number", width: 120 }, { key: "route_type", label: "Route Type", width: 110 }, { key: "assignment_reason", label: "Assignment Reason", width: 280 }, { key: "score", label: "Score", width: 90 },
];

export async function getSheetLayout<T>(): Promise<T> {
  const { data, error } = await supabase.from("route_sheet_layout").select("*").eq("id", SINGLETON_ID).maybeSingle();
  if (error) throw new Error(error.message);
  const order: string[] = Array.isArray(data?.column_order) && data.column_order.length ? data.column_order.map(String) : DEFAULT_COLUMNS.map((x) => x.key);
  const widths = (data?.column_widths || {}) as Record<string, number>;
  const byKey = new Map<string, SheetColumnDef>(DEFAULT_COLUMNS.map((d) => [d.key, { ...d, width: widths[d.key] || d.width }]));
  const columns: SheetColumnDef[] = [];
  for (const key of order) { const col = byKey.get(key); if (col) columns.push(col); }
  for (const def of byKey.values()) if (!columns.some((c) => c.key === def.key)) columns.push(def);
  return { columns, hidden_columns: Array.isArray(data?.hidden_columns) ? data.hidden_columns.map(String) : [] } as unknown as T;
}

export async function saveSheetLayout<T>(input: { column_order?: string[]; hidden_columns?: string[]; column_widths?: Record<string, number> }): Promise<T> {
  const payload = { id: SINGLETON_ID, column_order: input.column_order || [], hidden_columns: input.hidden_columns || [], column_widths: input.column_widths || {}, updated_at: new Date().toISOString() }; const { error } = await supabase.from("route_sheet_layout").upsert(payload); if (error) throw new Error(error.message); return getSheetLayout<T>();
}

export async function reorderRouteSheet(areaCodes: string[]): Promise<void> { const rows = await getCombinedSheet<RouteAssignment>(); await Promise.all(rows.map((r) => { const idx = areaCodes.indexOf(r.area_code); return idx < 0 ? Promise.resolve() : supabase.from("route_assignments").update({ sort_order: idx }).eq("area_code", r.area_code).eq("sector", r.sector).then(({ error }) => { if (error) throw new Error(error.message); }); })); }

export async function getReplacementForecast<T>(): Promise<T[]> {
  const today = new Date().toISOString().slice(0, 10);
  const horizon = addDays(today, 90);
  const [{ data: vacations, error: vacErr }, driverPlan, helperPlan] = await Promise.all([
    supabase.from("vacations").select("person_code,person_name,person_type,start_date,end_date").gte("start_date", today).lte("start_date", horizon).order("start_date"),
    getCurrentPlan<RouteAssignment>("driver"),
    getCurrentPlan<RouteAssignment>("helper"),
  ]);
  if (vacErr) throw new Error(vacErr.message);
  const rows: Record<string, unknown>[] = [];
  for (const v of vacations || []) {
    const role = String(v.person_type || "").toLowerCase().startsWith("helper") ? "helper" : "driver";
    const plan = role === "helper" ? helperPlan : driverPlan;
    const current = plan.find((r) => (role === "helper" ? r.helper_code : r.driver_code) === v.person_code);
    if (!current) continue;
    const candidates = await generateCandidatePlan(v.start_date);
    const area = candidates.areas.find((a) => a.area_code === current.area_code && a.sector === current.sector);
    const ranked = role === "helper" ? area?.ranked_helpers || [] : area?.ranked_drivers || [];
    const replacement = ranked.find((c) => c.code !== v.person_code) || null;
    rows.push({
      area_code: current.area_code, area_name: current.area_name, role: role === "helper" ? "Helper" : "Driver",
      current_person_code: v.person_code, current_person_name: v.person_name || (role === "helper" ? current.helper_name : current.driver_name),
      vacation_start_date: v.start_date, days_until_vacation: Math.max(0, Math.round(daysBetween(v.start_date, today))),
      replacement_code: replacement?.code || null, replacement_name: replacement?.name || null, replacement_score: replacement?.score ?? null,
      no_replacement_available: !replacement,
    });
  }
  return rows as unknown as T[];
}

export async function exportCombinedSheetExcel(): Promise<void> {
  const rows = await getCombinedSheet<Record<string, unknown>>(); const exportRows = rows.map((r) => ({ "S/N": r.sn, Division: r.sector, "Driver Code": r.driver_code, "Driver Name": r.driver_name, Area: r.area_name, "Helper Code": r.helper_code, "Helper Name": r.helper_name, "Vehicle Type": r.vehicle_type, "Vehicle Number": r.vehicle_number, "Route Type": r.route_type, "Assignment Reason": r.assignment_reason, Score: r.score })); const ws = XLSX.utils.json_to_sheet(exportRows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Route Plan"); await saveWorkbookToDispatchFolder(wb, `RoutePlan_Combined_${new Date().toISOString().slice(0,10).replace(/-/g, "")}.xlsx`);
}

async function writeAudit(entityType: string, entityKey: string, action: string, after: unknown) { await supabase.from("audit_log").insert({ entity_type: entityType, entity_key: entityKey, action, actor: "", after_state: after, before_state: {} }); }
