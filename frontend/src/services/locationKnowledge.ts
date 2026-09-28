import * as XLSX from "xlsx";
import { getPrimarySupabaseClient } from "../lib/supabase";

type Row = Record<string, unknown>;

export interface LocationKnowledgeRow {
  id?: string;
  customer_key: string;
  customer_name: string;
  shipment_to_key: string;
  shipment_to: string;
  remarks_key: string;
  remarks: string;
  area_code: string;
  area_name: string;
  latest_invoice?: string | null;
  first_seen_date?: string | null;
  last_seen_date?: string | null;
  seen_count: number;
  is_active?: boolean;
  coordinates?: string | null;
  t_nf1?: string | null;
  t_nt1?: string | null;
  t_nf2?: string | null;
  t_nt2?: string | null;
  t_ff?: string | null;
  t_ft?: string | null;
  t_sf?: string | null;
  t_st?: string | null;
  fri_off?: boolean;
  sat_off?: boolean;
  custom_days?: unknown[] | null;
}

export interface LocationImportResult {
  sourceRows: number;
  savedPatterns: number;
  excludedNotSupply: number;
  unresolvedArea: number;
  skippedEmptyCustomer: number;
  mergedOccurrences: number;
}

function clean(value: unknown): string { return String(value ?? "").trim().replace(/\s+/g, " "); }

/** Shared normalization contract with the Chrome extension. */
export function normalizeLocationKey(value: unknown): string {
  return clean(value).toUpperCase().replace(/&/g, " AND ")
    .replace(/\b(L\.?L\.?C|LLC|LTD|LIMITED|FZE|FZCO|CO|COMPANY|TRADING|EST|ESTABLISHMENT)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function normHeader(value: unknown): string { return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function readAlias(row: Row, aliases: string[]): string {
  const wanted = new Set(aliases.map(normHeader));
  for (const [key, value] of Object.entries(row)) if (wanted.has(normHeader(key))) return clean(value);
  return "";
}

function excelDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) { const d = XLSX.SSF.parse_date_code(value); if (d) return `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`; }
  const s = clean(value); if (!s) return null;
  const iso = s.match(/^(\d{4})[-\/]([01]?\d)[-\/]([0-3]?\d)$/); if (iso) return `${iso[1]}-${iso[2].padStart(2,"0")}-${iso[3].padStart(2,"0")}`;
  const dmy = s.match(/^([0-3]?\d)[-\/]([01]?\d)[-\/](\d{4})$/); if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,"0")}-${dmy[1].padStart(2,"0")}`;
  const parsed = new Date(s); return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0,10);
}

async function rowsFromFile(file: File): Promise<Row[]> {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]]; if (!ws) return [];
  return XLSX.utils.sheet_to_json<Row>(ws, { defval: "", raw: false });
}

function isNotSupply(row: Row): boolean { return Object.values(row).some(value => /\bNOT\s*SUPPL(?:Y|IED)\b/i.test(clean(value))); }

/** Natural key: one customer/shipment/remarks pattern must have one current area. */
function patternKey(x: Pick<LocationKnowledgeRow, "customer_key" | "shipment_to_key" | "remarks_key">): string {
  return [x.customer_key, x.shipment_to_key, x.remarks_key].join("|");
}

async function getAreas(): Promise<{ code: string; name: string }[]> {
  const { data, error } = await getPrimarySupabaseClient().from("areas").select("code,name").order("code");
  if (error) throw new Error(`Failed to load Areas master: ${error.message}`);
  return (data ?? []).map((a: any) => ({ code: clean(a.code), name: clean(a.name) })).filter(a => a.code);
}

function areaMaps(areas: { code: string; name: string }[]) {
  const byCode = new Map<string, { code: string; name: string }>();
  const byName = new Map<string, { code: string; name: string }>();
  for (const a of areas) { byCode.set(normalizeLocationKey(a.code), a); if (a.name) byName.set(normalizeLocationKey(a.name), a); }
  return { byCode, byName };
}

export async function listLocationKnowledge(search = ""): Promise<LocationKnowledgeRow[]> {
  const client = getPrimarySupabaseClient();
  let q = client.from("invoice_location_knowledge").select("*").order("last_seen_date", { ascending: false, nullsFirst: false }).limit(1000);
  const s = clean(search);
  if (s) { const safe = s.replace(/[,%]/g, ""); q = q.or(`customer_name.ilike.%${safe}%,shipment_to.ilike.%${safe}%,remarks.ilike.%${safe}%,area_code.ilike.%${safe}%,area_name.ilike.%${safe}%`); }
  const { data, error } = await q; if (error) throw new Error(error.message);
  return (data ?? []) as LocationKnowledgeRow[];
}

export async function listAllLocationKnowledge(): Promise<LocationKnowledgeRow[]> {
  const client = getPrimarySupabaseClient(); const out: LocationKnowledgeRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from("invoice_location_knowledge").select("*").order("created_at", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message); const batch = (data ?? []) as LocationKnowledgeRow[]; out.push(...batch); if (batch.length < 1000) break;
  }
  return out;
}

function toDbRecord(input: Partial<LocationKnowledgeRow>, areas: { code: string; name: string }[]): LocationKnowledgeRow {
  const { byCode, byName } = areaMaps(areas);
  const customerName = clean(input.customer_name); const shipmentTo = clean(input.shipment_to); const remarks = clean(input.remarks);
  if (!customerName || !normalizeLocationKey(customerName)) throw new Error("Customer is required.");
  const area = byCode.get(normalizeLocationKey(input.area_code)) || byName.get(normalizeLocationKey(input.area_name || ""));
  if (!area) throw new Error(`Area Code '${clean(input.area_code)}' was not found in Fleet Data → Areas.`);
  const seen = Math.max(1, Number(input.seen_count ?? 1) || 1);
  return {
    id: input.id,
    customer_key: normalizeLocationKey(customerName), customer_name: customerName,
    shipment_to_key: normalizeLocationKey(shipmentTo), shipment_to: shipmentTo,
    remarks_key: normalizeLocationKey(remarks), remarks,
    area_code: area.code, area_name: area.name,
    latest_invoice: clean(input.latest_invoice) || null,
    first_seen_date: excelDate(input.first_seen_date), last_seen_date: excelDate(input.last_seen_date),
    seen_count: seen, is_active: input.is_active !== false,
    coordinates: clean(input.coordinates) || null,
    t_nf1: clean(input.t_nf1) || null, t_nt1: clean(input.t_nt1) || null,
    t_nf2: clean(input.t_nf2) || null, t_nt2: clean(input.t_nt2) || null,
    t_ff: clean(input.t_ff) || null, t_ft: clean(input.t_ft) || null,
    t_sf: clean(input.t_sf) || null, t_st: clean(input.t_st) || null,
    fri_off: input.fri_off === true, sat_off: input.sat_off === true,
    custom_days: Array.isArray(input.custom_days) ? input.custom_days : [],
  };
}

export async function createLocationKnowledge(input: Partial<LocationKnowledgeRow>): Promise<LocationKnowledgeRow> {
  const areas = await getAreas(); const row = toDbRecord(input, areas); delete row.id;
  const client = getPrimarySupabaseClient();
  const { data, error } = await client.from("invoice_location_knowledge").insert(row).select().single();
  if (error) throw new Error(error.message);
  return data as LocationKnowledgeRow;
}

export async function updateLocationKnowledge(id: string, input: Partial<LocationKnowledgeRow>): Promise<LocationKnowledgeRow> {
  const areas = await getAreas(); const row = toDbRecord({ ...input, id }, areas);
  const { id: _id, customer_key: _ck, shipment_to_key: _sk, remarks_key: _rk, ...patch } = row;
  const { data, error } = await getPrimarySupabaseClient().from("invoice_location_knowledge").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message); return data as LocationKnowledgeRow;
}

export async function deleteLocationKnowledge(id: string): Promise<void> {
  const { error } = await getPrimarySupabaseClient().from("invoice_location_knowledge").delete().eq("id", id); if (error) throw new Error(error.message);
}

export function exportLocationKnowledge(rows: LocationKnowledgeRow[]): void {
  const output = rows.map(r => ({
    ID: r.id || "", Customer: r.customer_name, "Shipment To": r.shipment_to, "Remarks / Instructions": r.remarks,
    "Area Code": r.area_code, "Area Name": r.area_name, "Latest Invoice": r.latest_invoice || "",
    "First Seen Date": r.first_seen_date || "", "Last Seen Date": r.last_seen_date || "", "Seen Count": r.seen_count,
    "Active": r.is_active !== false ? "YES" : "NO",
    Coordinates: r.coordinates || "", "Normal 1 Start": r.t_nf1 || "", "Normal 1 End": r.t_nt1 || "",
    "Normal 2 Start": r.t_nf2 || "", "Normal 2 End": r.t_nt2 || "", "Friday Start": r.t_ff || "", "Friday End": r.t_ft || "",
    "Saturday Start": r.t_sf || "", "Saturday End": r.t_st || "", "Friday Off": r.fri_off ? "YES" : "NO", "Saturday Off": r.sat_off ? "YES" : "NO",
    "Custom Days": r.custom_days ? JSON.stringify(r.custom_days) : "",
  }));
  const ws = XLSX.utils.json_to_sheet(output); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Location Knowledge");
  XLSX.writeFile(wb, `DispatchOPS_Location_Knowledge_${new Date().toISOString().slice(0,10)}.xlsx`);
}

/** Merge/update an exported management workbook without deleting existing records. */
export async function importLocationKnowledgeManagementFile(file: File): Promise<{ processed: number; created: number; updated: number }> {
  const rows = await rowsFromFile(file); if (!rows.length) throw new Error("The selected Excel file contains no readable rows.");
  const areas = await getAreas(); const existing = await listAllLocationKnowledge();
  const byId = new Map(existing.filter(r => r.id).map(r => [r.id!, r])); const byKey = new Map(existing.map(r => [patternKey(r), r]));
  const payload: LocationKnowledgeRow[] = []; let created = 0, updated = 0;
  for (const raw of rows) {
    const customer = readAlias(raw, ["Customer", "Customer Name"]); if (!customer) continue;
    const candidate = toDbRecord({
      id: readAlias(raw, ["ID"]) || undefined,
      customer_name: customer,
      shipment_to: readAlias(raw, ["Shipment To", "Ship To"]),
      remarks: readAlias(raw, ["Remarks / Instructions", "Remarks", "Instructions"]),
      area_code: readAlias(raw, ["Area Code"]), area_name: readAlias(raw, ["Area Name"]),
      latest_invoice: readAlias(raw, ["Latest Invoice", "Invoice"]),
      first_seen_date: readAlias(raw, ["First Seen Date"]), last_seen_date: readAlias(raw, ["Last Seen Date"]),
      seen_count: Number(readAlias(raw, ["Seen Count"]) || 1), is_active: !/^NO|FALSE|0$/i.test(readAlias(raw, ["Active"])),
      coordinates: readAlias(raw, ["Coordinates", "GPS", "Coords"]),
      t_nf1: readAlias(raw, ["Normal 1 Start", "NormStart", "Normal Start"]), t_nt1: readAlias(raw, ["Normal 1 End", "NormEnd", "Normal End"]),
      t_nf2: readAlias(raw, ["Normal 2 Start"]), t_nt2: readAlias(raw, ["Normal 2 End"]),
      t_ff: readAlias(raw, ["Friday Start", "FriStart"]), t_ft: readAlias(raw, ["Friday End", "FriEnd"]),
      t_sf: readAlias(raw, ["Saturday Start", "SatStart", "WkndStart"]), t_st: readAlias(raw, ["Saturday End", "SatEnd", "WkndEnd"]),
      fri_off: /^YES|TRUE|1$/i.test(readAlias(raw, ["Friday Off", "Fri Off"])),
      sat_off: /^YES|TRUE|1$/i.test(readAlias(raw, ["Saturday Off", "Sat Off"])),
      custom_days: (() => { try { const v=readAlias(raw,["Custom Days"]); return v ? JSON.parse(v) : []; } catch { return []; } })()
    }, areas);
    const old = (candidate.id && byId.get(candidate.id)) || byKey.get(patternKey(candidate));
    if (old?.id) { payload.push({ ...candidate, id: old.id }); updated++; }
    else { payload.push({ ...candidate, id: crypto.randomUUID() }); created++; }
  }
  const client = getPrimarySupabaseClient();
  for (let i = 0; i < payload.length; i += 250) { const { error } = await client.from("invoice_location_knowledge").upsert(payload.slice(i, i+250), { onConflict: "customer_key,shipment_to_key,remarks_key" }); if (error) throw new Error(error.message); }
  return { processed: payload.length, created, updated };
}

export async function resetAllLocationKnowledge(): Promise<number> {
  const { data, error } = await getPrimarySupabaseClient().from("invoice_location_knowledge").delete().not("id", "is", null).select("id");
  if (error) throw new Error(error.message); return data?.length ?? 0;
}

export async function importLocationKnowledgeFile(file: File): Promise<LocationImportResult> {
  const client = getPrimarySupabaseClient(); const rows = await rowsFromFile(file); if (!rows.length) throw new Error("The selected SAP workbook contains no readable rows.");
  const areas = await getAreas(); const { byCode, byName } = areaMaps(areas);
  const aggregate = new Map<string, LocationKnowledgeRow>(); let excludedNotSupply=0, unresolvedArea=0, skippedEmptyCustomer=0;
  for (const row of rows) {
    if (isNotSupply(row)) { excludedNotSupply++; continue; }
    const customer=readAlias(row,["Customer","Customer Name","Shipment Customer","Shipment Cust Name","Customer Description"]); if(!normalizeLocationKey(customer)){skippedEmptyCustomer++;continue;}
    const shipmentTo=readAlias(row,["Shipment To","Ship To","Shipment Address","Delivery To","Delivery Address","Address"]); const remarks=readAlias(row,["Remarks","Shipment Remarks","Shipment Instructions","Delivery Instructions","Annotation","Instructions"]);
    const rawCode=readAlias(row,["Area Code","Location Code","Route Code"]); const rawName=readAlias(row,["Area Name","Location Name","Route Name","Area","Location"]);
    const canonical=byCode.get(normalizeLocationKey(rawCode))||byName.get(normalizeLocationKey(rawCode))||byCode.get(normalizeLocationKey(rawName))||byName.get(normalizeLocationKey(rawName)); if(!canonical){unresolvedArea++;continue;}
    const date=excelDate(readAlias(row,["Dispatch Date","Invoice Date","Billing Date","Date"])); const invoice=readAlias(row,["Invoice","Invoice No","Invoice Number","Billing Document","Billing Doc","Document Number"]);
    const rec:LocationKnowledgeRow={customer_key:normalizeLocationKey(customer),customer_name:customer,shipment_to_key:normalizeLocationKey(shipmentTo),shipment_to:shipmentTo,remarks_key:normalizeLocationKey(remarks),remarks,area_code:canonical.code,area_name:canonical.name,latest_invoice:invoice||null,first_seen_date:date,last_seen_date:date,seen_count:1,is_active:true};
    const key=patternKey(rec); const prev=aggregate.get(key); if(!prev)aggregate.set(key,rec); else {prev.seen_count++;if(date&&(!prev.first_seen_date||date<prev.first_seen_date))prev.first_seen_date=date;if(date&&(!prev.last_seen_date||date>=prev.last_seen_date)){prev.last_seen_date=date;prev.latest_invoice=invoice||prev.latest_invoice;}if(shipmentTo.length>prev.shipment_to.length)prev.shipment_to=shipmentTo;if(remarks.length>prev.remarks.length)prev.remarks=remarks;}
  }
  const incoming=[...aggregate.values()]; if(!incoming.length)return{sourceRows:rows.length,savedPatterns:0,excludedNotSupply,unresolvedArea,skippedEmptyCustomer,mergedOccurrences:0};
  const keys=[...new Set(incoming.map(x=>x.customer_key))]; const existing:LocationKnowledgeRow[]=[];
  for(let i=0;i<keys.length;i+=100){const {data,error}=await client.from("invoice_location_knowledge").select("*").in("customer_key",keys.slice(i,i+100));if(error)throw new Error(error.message);existing.push(...(data??[]) as LocationKnowledgeRow[]);}
  const existingByKey=new Map(existing.map(x=>[patternKey(x),x])); let mergedOccurrences=0;
  const payload=incoming.map(x=>{const old=existingByKey.get(patternKey(x));if(!old)return{...x,id:crypto.randomUUID()};mergedOccurrences+=x.seen_count;return{...x,id:old.id,seen_count:Number(old.seen_count||0)+x.seen_count,first_seen_date:[old.first_seen_date,x.first_seen_date].filter(Boolean).sort()[0]||null,last_seen_date:(() => { const dates=[old.last_seen_date,x.last_seen_date].filter(Boolean).sort(); return dates.length ? dates[dates.length-1] : null; })(),latest_invoice:(!old.last_seen_date||(x.last_seen_date&&x.last_seen_date>=old.last_seen_date))?x.latest_invoice:old.latest_invoice};});
  for(let i=0;i<payload.length;i+=250){const {error}=await client.from("invoice_location_knowledge").upsert(payload.slice(i,i+250),{onConflict:"customer_key,shipment_to_key,remarks_key"});if(error)throw new Error(error.message);}
  return{sourceRows:rows.length,savedPatterns:payload.length,excludedNotSupply,unresolvedArea,skippedEmptyCustomer,mergedOccurrences};
}
