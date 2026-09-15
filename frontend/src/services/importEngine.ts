import * as XLSX from "xlsx";
import { supabase, getSupabaseClientByProject, getFederatedSupabaseClients } from "@/lib/supabase";
import facilityKeywordMap from "@/lib/facility_keyword_map.json";
import {
  finalizeImportBatch,
  insertRawImportRows,
  listImportHistory,
  startImportBatch,
} from "./imports";
import type { ImportBatch } from "./types";

type JsonRow = Record<string, unknown>;

export interface ImportProgress {
  status: "processing" | "completed" | "partial" | "failed";
  progress_pct: number;
  current_step: string;
  processed_units: number;
  total_units: number;
  estimated_seconds_remaining: number;
  log: string;
  error: string;
}

export interface ImportPreview {
  headers: string[];
  rows: JsonRow[];
  totalRows: number;
}

const keywordRules = Object.entries(facilityKeywordMap as Record<string, string[]>)
  .flatMap(([facilityType, words]) => words.map((word) => ({ word: word.toUpperCase(), facilityType })))
  .sort((a, b) => b.word.length - a.word.length);

const clean = (value: unknown): string => {
  if (value == null) return "";
  const text = String(value).trim();
  return /^(nan|none|nat|null|n\/a)$/i.test(text) ? "" : text;
};

const intValue = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

function excelDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const p = XLSX.SSF.parse_date_code(value);
    if (p) return `${String(p.y).padStart(4, "0")}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  }
  const raw = clean(value).split(" ")[0];
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function timeValue(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    const total = Math.round(value * 86400) % 86400;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return clean(value);
}

function normalizeVehicle(value: unknown): string {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeExperienceMatch(value: unknown): string {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeExperienceVehicleType(value: unknown): string {
  const up=clean(value).toUpperCase();
  if (up.includes("PICK") || up.includes("TRUCK")) return "PICKUP";
  if (up.includes("VAN") || up.includes("BUS") || up.includes("2-8")) return "VAN";
  return up || "UNKNOWN";
}

function classifyFacility(row: JsonRow): string {
  const fields = [row["TXN Code"], row["Remarks"], row["Customer Name"], row["Division Description"], row["Division Desc"]];
  for (const field of fields) {
    const text = clean(field).toUpperCase();
    if (!text) continue;
    const hit = keywordRules.find((rule) => text.includes(rule.word));
    if (hit) return hit.facilityType;
  }
  return "Representative";
}

function parseDuration(text: string): number {
  if (!text) return 0;
  const h = text.match(/(\d+)\s*H/i);
  const m = text.match(/(\d+)\s*M/i);
  const colon = text.match(/^(\d+):(\d+)(?::(\d+))?$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]) + Math.round(Number(colon[3] || 0) / 60);
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

function extractVehiclePlate(text: string): string {
  const left = text.split("(")[0].trim().toUpperCase();
  const tokens = left.split(/[\s-]+/);
  const candidates = tokens.map((t, i) => ({ t, i })).filter(({ t }) => /^\d{3,7}$/.test(t));
  if (!candidates.length) return normalizeVehicle(left);
  candidates.sort((a, b) => b.t.length - a.t.length);
  const { t, i } = candidates[0];
  const prefix = i > 0 && /^[A-Z]{1,3}$/.test(tokens[i - 1]) ? tokens[i - 1] : "";
  return prefix + t;
}

async function workbookFromFile(file: File): Promise<XLSX.WorkBook> {
  const bytes = await file.arrayBuffer();
  return XLSX.read(bytes, { type: "array", cellDates: true, raw: false });
}

function firstSheetRows(workbook: XLSX.WorkBook): JsonRow[] {
  const ws = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<JsonRow>(ws, { defval: "", raw: false });
}

function firstSheetGrid(workbook: XLSX.WorkBook): unknown[][] {
  const ws = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false });
}

export async function previewImportFile(file: File): Promise<ImportPreview> {
  const workbook = await workbookFromFile(file);
  const rows = firstSheetRows(workbook);
  return { headers: rows.length ? Object.keys(rows[0]) : [], rows: rows.slice(0, 25), totalRows: rows.length };
}

function validateSapHeaders(rows: JsonRow[]): string[] {
  if (!rows.length) return ["The file contains no SAP rows."];
  const headers = new Set(Object.keys(rows[0]).map((h) => h.trim()));
  const required = ["Invoice No", "Driver Code", "Dispatch Date"];
  return required.filter((h) => !headers.has(h)).map((h) => `Missing required SAP column: ${h}`);
}

function parseSapFacts(rows: JsonRow[], batchId: string, filename: string): { facts: JsonRow[]; rejected: string[] } {
  const facts: JsonRow[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const invoiceNo = clean(r["Invoice No"]);
    if (!invoiceNo) continue;
    let driverCode = clean(r["Driver Code"]).toUpperCase();
    let helperCode = clean(r["Helper Code"]).toUpperCase();
    if (driverCode && !driverCode.startsWith("D")) { rejected.push(`Row ${i + 2}: invalid driver code ${driverCode}`); continue; }
    if (helperCode && !helperCode.startsWith("H")) helperCode = "";
    if (invoiceNo.startsWith("2")) continue;
    const customer = clean(r["Customer Name"]);
    const remarks = clean(r["Remarks"]);
    const division = clean(r["Division Description"]) || clean(r["Division Desc"]) || clean(r["Division"]) || clean(r["Division Name"]) || clean(r["Division Description Name"]) || "UNKNOWN";
    const area = clean(r["Location Code"]) || clean(r["Area"]) || clean(r["Area Code"]) || division;
    if (`${customer} ${remarks} ${area}`.toUpperCase().includes("KIZAD")) continue;
    const vehicleNum = clean(r["Vehicle Number"]);
    let facilityType = classifyFacility(r);
    if (facilityType === "Pharmacy" && (/^[0-9]/.test(vehicleNum) || vehicleNum.toUpperCase().includes("PICK"))) facilityType = "Store";
    const finalCustomer = customer || remarks || clean(r["Address"]);
    const dispatchDate = excelDate(r["Dispatch Date"]);
    const driverName = clean(r["Driver Name"]);
    const key = `${invoiceNo}|${dispatchDate || ""}|${driverName}|${finalCustomer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const salesman = clean(r["Salesman"]) || clean(r["Salesman Name"]) || clean(r["Salesman Description"]) || clean(r["Sales Man"]) || "";
    facts.push({
      batch_id: batchId,
      invoice_date: excelDate(r["Invoice Date"]), dispatch_date: dispatchDate,
      dispatch_num: clean(r["Dispatch Number"]), invoice_no: invoiceNo,
      driver_code: driverCode, driver_name: driverName,
      helper_code: helperCode, helper_name: clean(r["Helper Name"]),
      vehicle_num: vehicleNum, vehicle_key: normalizeVehicle(vehicleNum),
      customer_name: finalCustomer, customer_name_source: customer ? "customer_name" : remarks ? "remarks" : "address",
      remarks, address: clean(r["Address"]), area,
      boxes: intValue(r["No of Boxes"]), normal_boxes: intValue(r["No of Normal Box"]), freezer_boxes: intValue(r["No of Freezer Box"]),
      not_supplied_reason: clean(r["Supply Description"]), division_desc: division,
      txn_code: clean(r["TXN Code"]), facility_type: facilityType,
      vehicle_type: vehicleNum ? (/^[0-9]/.test(vehicleNum) ? "PICKUP" : "VAN") : "UNKNOWN",
      salesman, box_entry_time: timeValue(r["Box Entry Time"]), source_file: filename,
    });
  }
  return { facts, rejected };
}

function landmarkVisitDate(arrival: string): string | null {
  const m = arrival.match(/^(\d{2}) ([A-Za-z]{3}) (\d{4})/);
  if (!m) return null;
  const months: Record<string,string> = {Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12"};
  const month = months[m[2]];
  return month ? `${m[3]}-${month}-${m[1]}` : null;
}

function parseLandmarkFacts(grid: unknown[][], batchId: string, filename: string): JsonRow[] {
  let dataStart = 18, driverCol = 1, landmarkCol = 2, entryCol = 6, exitCol = 7, durationCol = 9;
  for (let i = 0; i < Math.min(30, grid.length); i++) {
    const row = (grid[i] || []).map((c) => clean(c).toLowerCase());
    const d = row.findIndex((c) => c === "driver");
    const l = row.findIndex((c) => c === "landmark" || c.startsWith("landmark"));
    const dur = row.findIndex((c) => c === "duration" || c.startsWith("duration"));
    const en = row.findIndex((c) => c.includes("entry") && c.includes("date"));
    const ex = row.findIndex((c) => c.includes("exit") && c.includes("date"));
    if (d >= 0 && (l >= 0 || dur >= 0)) {
      dataStart = i + 1; driverCol = d; if (l >= 0) landmarkCol = l; if (dur >= 0) durationCol = dur; if (en >= 0) entryCol = en; if (ex >= 0) exitCol = ex; break;
    }
  }
  const facts: JsonRow[] = [];
  const seen = new Set<string>();
  let vehicleRaw = "", vehicleKey = "";
  const cell = (row: unknown[], i: number) => clean(row?.[i]);
  for (let i = dataStart; i < grid.length; i++) {
    const row = grid[i] || [];
    const driver = cell(row, driverCol), landmark = cell(row, landmarkCol), arrival = cell(row, entryCol), departure = cell(row, exitCol), duration = cell(row, durationCol);
    if (!driver && !landmark && !arrival && !duration) continue;
    const isHeader = !!driver && !landmark && !arrival && !duration && (driver.includes("(") || normalizeVehicle(driver).length >= 4);
    if (isHeader) { vehicleRaw = driver; vehicleKey = extractVehiclePlate(driver); continue; }
    if (!landmark || landmark.toLowerCase() === "landmark" || (!duration && !arrival)) continue;
    const key = `${vehicleKey}|${driver}|${landmark}|${arrival}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const minutes = parseDuration(duration);
    facts.push({ batch_id: batchId, visit_date: landmarkVisitDate(arrival), driver_name: driver || "Unknown", customer_name: landmark,
      vehicle_raw: vehicleRaw, vehicle_key: vehicleKey, arrival, departure, duration, minutes,
      is_delivery: /^\d+H:\d+M$/i.test(duration) && minutes > 0,
      is_passthrough: duration.toLowerCase().includes("pass"),
      is_depot: landmark.toUpperCase().includes("CITY PHARMACY") && landmark.toUpperCase().includes("IND"),
      source_file: filename });
  }
  return facts;
}

async function insertChunks(table: string, rows: JsonRow[], client = supabase, chunkSize = 400): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const { error } = await client.from(table).insert(rows.slice(i, i + chunkSize));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function updateLearnedValues(rows: JsonRow[], client = supabase): Promise<void> {
  const learned = new Map<string, { category: string; value: string }>();
  for (const r of rows) {
    const customer = clean(r["Customer Name"]); if (customer) learned.set(`customer|${customer.toUpperCase()}`, { category: "customer", value: customer });
    const salesman = clean(r["Salesman"]) || clean(r["Salesman Name"]) || clean(r["Salesman Description"]); if (salesman) learned.set(`salesman|${salesman.toUpperCase()}`, { category: "salesman", value: salesman });
  }
  if (!learned.size) return;
  const payload = [...learned.entries()].map(([key, v]) => ({ key, ...v, last_seen: new Date().toISOString() }));
  const { error } = await client.from("learned_values").upsert(payload, { onConflict: "category,value" });
  if (error) throw new Error(error.message);
}

async function updateExperienceFromSap(rows: JsonRow[], client = supabase): Promise<void> {
  const [driversR, helpersR, vehiclesR, salesmenR] = await Promise.all([
    client.from("drivers").select("code,name"), client.from("helpers").select("code,name"),
    client.from("vehicles").select("id,vehicle_number,number,vehicle_type,type,updated_at"), client.from("consumer_salesmen").select("name,salesman_name"),
  ]);
  const err=[driversR.error,helpersR.error,vehiclesR.error,salesmenR.error].find(Boolean); if(err) throw new Error(err.message);
  const names=new Map<string,string>(); for(const r of [...(driversR.data||[]),...(helpersR.data||[])]) names.set(clean(r.code).toUpperCase(),clean(r.name));
  const vehicleTypes=new Map<string,string>(); for(const v of vehiclesR.data||[]){const key=normalizeVehicle(v.vehicle_number||v.number);if(key&&!vehicleTypes.has(key))vehicleTypes.set(key,normalizeExperienceVehicleType(v.vehicle_type||v.type));}
  const consumers=new Set((salesmenR.data||[]).map((r:any)=>normalizeExperienceMatch(r.name||r.salesman_name)).filter(Boolean));
  const orders:any[]=[]; const daily=new Map<string,{consumer:number;pharma:number}>();
  for(const r of rows){const date=excelDate(r["Dispatch Date"]);if(!date)continue;const area=clean(r["Location Code"])||clean(r["Area"])||clean(r["Area Code"])||clean(r["Division Description"])||"UNKNOWN";const vehicle=clean(r["Vehicle Number"]);const vkey=normalizeVehicle(vehicle);const vt=normalizeExperienceVehicleType(vehicleTypes.get(vkey)||r["Vehicle Type"]||(vehicle&&/^[0-9]/.test(vehicle)?"PICKUP":vehicle?"VAN":"UNKNOWN"));const sm=clean(r["Salesman"])||clean(r["Salesman Name"])||clean(r["Salesman Description"])||clean(r["Sales Man"]);const consumer=consumers.has(normalizeExperienceMatch(sm));for(const [type,rawCode,rawName] of [["Driver",r["Driver Code"],r["Driver Name"]],["Helper",r["Helper Code"],r["Helper Name"]] as const]){const code=clean(rawCode).toUpperCase();if(!code)continue;const k=`${type}|${code}|${date}`;const d=daily.get(k)||{consumer:0,pharma:0};if(consumer)d.consumer++;else d.pharma++;daily.set(k,d);orders.push({date,area,vehicle,vehicle_type:vt,person_code:code,person_name:names.get(code)||clean(rawName)||code,person_type:type,consumer});}}
  const grouped=new Map<string,any>(); for(const o of orders){const d=daily.get(`${o.person_type}|${o.person_code}|${o.date}`)!;const division=d.consumer>d.pharma?"Consumer":"Pharma";const key=`${o.person_type}|${o.person_code}|${o.date}|${o.area}|${o.vehicle}|${division}`;const g=grouped.get(key)||{person_code:o.person_code,person_name:o.person_name,person_type:o.person_type,area:o.area,sector:division,date:o.date,end_date:o.date,vehicle_number:o.vehicle,experience_division:division,vehicle_type:o.vehicle_type,order_count:0,consumer_orders:0,pharma_orders:0};g.order_count++;if(o.consumer)g.consumer_orders++;else g.pharma_orders++;grouped.set(key,g)}
  const payload=[...grouped.values()]; for(let i=0;i<payload.length;i+=250){const{error}=await client.from("experience_history").upsert(payload.slice(i,i+250),{onConflict:"person_code,person_type,date,area,vehicle_number"});if(error)throw new Error(error.message)}
}

async function updateDailyDivisions(facts: JsonRow[], client = supabase): Promise<void> {
  const [salesmenR]=await Promise.all([client.from("consumer_salesmen").select("name,salesman_name")]);
  if(salesmenR.error) throw new Error(salesmenR.error.message);
  const consumers=new Set((salesmenR.data||[]).map((r:any)=>normalizeExperienceMatch(r.name||r.salesman_name)).filter(Boolean));
  const counts=new Map<string,{person_code:string;person_name:string;work_date:string;consumer:number;pharma:number}>();
  for(const f of facts){const date=clean(f.dispatch_date);if(!date)continue;const sm=clean(f.salesman);const isConsumer=consumers.has(normalizeExperienceMatch(sm));for(const [type,codeRaw,nameRaw] of [["Driver",f.driver_code,f.driver_name],["Helper",f.helper_code,f.helper_name] as const]){const code=clean(codeRaw).toUpperCase();if(!code)continue;const k=`${type}|${code}|${date}`;const x=counts.get(k)||{person_code:code,person_name:clean(nameRaw),work_date:date,consumer:0,pharma:0};if(isConsumer)x.consumer++;else x.pharma++;counts.set(k,x)}}
  // driver_daily_divisions has a legacy name but now intentionally contains both roles.
  for(const x of counts.values()){const payload={person_code:x.person_code,person_name:x.person_name,work_date:x.work_date,division:x.consumer>x.pharma?"Consumer":"Pharma",consumer_invoices:x.consumer,pharma_invoices:x.pharma};const{error}=await client.from("driver_daily_divisions").upsert(payload,{onConflict:"person_code,work_date"});if(error)throw new Error(error.message)}
}

export async function processExperienceExport(
  file: File,
  onProgress?: (p: ImportProgress) => void,
): Promise<{ rows: number; days: number; people: number }> {
  const progress = (patch: Partial<ImportProgress>) => onProgress?.({ status: "processing", progress_pct: 0, current_step: "", processed_units: 0, total_units: 0, estimated_seconds_remaining: 0, log: "", error: "", ...patch });
  const workbook = await workbookFromFile(file);
  const rows = firstSheetRows(workbook);
  if (!rows.length) throw new Error("The experience export contains no rows.");
  const errors = validateSapHeaders(rows);
  if (errors.length) throw new Error(errors.join("\n"));
  progress({ current_step: "Reading Fleet, People, Areas and Consumer Salesmen masters", progress_pct: 5, total_units: rows.length });

  const clients=getFederatedSupabaseClients();
  const masterResults=await Promise.all(clients.map(async client=>Promise.all([
    client.from("drivers").select("code,name"),
    client.from("helpers").select("code,name"),
    client.from("vehicles").select("id,vehicle_number,number,vehicle_type,type,updated_at"),
    client.from("areas").select("id,code,name,sector,route_type"),
    client.from("area_anchored_vehicles").select("area_id,vehicle_id"),
    client.from("consumer_salesmen").select("salesman_code,name,salesman_name"),
  ])));
  const masterError=masterResults.flat().map((r:any)=>r.error).find(Boolean); if(masterError) throw new Error(masterError.message);
  // Primary owns the canonical people/fleet/area masters. Consumer Salesmen are
  // federated configuration, so read the union from BOTH clouds; this fixes the
  // case where Dashboard Configuration was saved on Secondary while Experience
  // was previously reading only Primary.
  const [driversR,helpersR,vehiclesR,areasR,anchoredVehiclesR]=masterResults[0] as any[];
  const salesmanRows=(masterResults.flatMap(m=>((m[5] as any)?.data||[]))) as any[];
  const names=new Map<string,string>(); for(const r of [...(driversR.data||[]),...(helpersR.data||[])]) { const code=clean(r.code).toUpperCase(); if(code) names.set(code,clean(r.name)||code); }
  const personTypeByCode=new Map<string,"Driver"|"Helper">(); for(const r of driversR.data||[]){const c=clean(r.code).toUpperCase();if(c)personTypeByCode.set(c,"Driver");} for(const r of helpersR.data||[]){const c=clean(r.code).toUpperCase();if(c&&!personTypeByCode.has(c))personTypeByCode.set(c,"Helper");}
  const vehicleMap=new Map<string,{number:string;type:string}>();
  for(const v of vehiclesR.data||[]){const number=clean(v.vehicle_number||v.number);const key=normalizeVehicle(number);if(key&&!vehicleMap.has(key))vehicleMap.set(key,{number,type:normalizeExperienceVehicleType(v.vehicle_type||v.type)});}
  const areaByCode=new Map<string,{code:string;name:string;sector:string;route_type:string}>();
  const areaByName=new Map<string,{code:string;name:string;sector:string;route_type:string}>();
  for(const a of areasR.data||[]){const rec={code:clean(a.code),name:clean(a.name),sector:normalizeExperienceMatch(a.sector)||clean(a.sector)||"Pharma",route_type:clean(a.route_type)};if(rec.code)areaByCode.set(normalizeAreaKey(rec.code),rec);if(rec.name)areaByName.set(normalizeAreaKey(rec.name),rec);}
  const areaById=new Map<string,any>((areasR.data||[]).map((a:any)=>[String(a.id),{code:clean(a.code),name:clean(a.name)}])); const vehicleAnchorById=new Map<string,any>(); for(const x of anchoredVehiclesR.data||[]){const a=areaById.get(String(x.area_id)); if(a&&!vehicleAnchorById.has(String(x.vehicle_id))) vehicleAnchorById.set(String(x.vehicle_id),a);}
  // Consumer classification is driven ONLY by the existing Dashboard Configuration > Salesman Categorization.
  // We intentionally do not expose or store the salesman names in Experience records.
  // Read the union from both clouds because configuration is mirrored/federated.
  const consumerSalesmen=new Set<string>();
  for(const r of salesmanRows) for(const value of [r.salesman_code,r.name,r.salesman_name]) {const n=normalizeExperienceMatch(value);if(n)consumerSalesmen.add(n);}

  type Order={date:string;areaCode:string;areaName:string;areaSector:string;routeType:string;vehicleNumber:string;vehicleType:string;anchoredAreaCode?:string|null;anchoredAreaName?:string|null;code:string;name:string;personType:"Driver"|"Helper";isConsumer:boolean};
  const orders:Order[]=[]; const daily=new Map<string,{consumer:number;pharma:number}>();
  for(let i=0;i<rows.length;i++){
    const r=rows[i]; const date=excelDate(r["Dispatch Date"]); if(!date) continue;
    const rawAreaCode=clean(r["Area Code"])||clean(r["Location Code"]); const rawAreaName=clean(r["Area Name"])||clean(r["Location Name"]); const rawArea=clean(r["Area"])||clean(r["Location"]);
    const area=areaByCode.get(normalizeAreaKey(rawAreaCode))||areaByName.get(normalizeAreaKey(rawAreaCode))||areaByCode.get(normalizeAreaKey(rawArea))||areaByName.get(normalizeAreaKey(rawArea))||areaByCode.get(normalizeAreaKey(rawAreaName))||areaByName.get(normalizeAreaKey(rawAreaName));
    const areaCode=area?.code||"UNKNOWN"; const areaName=area?.name||rawAreaName||rawArea||rawAreaCode||"UNKNOWN"; const areaSector=area?.sector||"Pharma"; const routeType=area?.route_type||clean(r["Route Type"]);
    const rawVehicle=clean(r["Vehicle Number"]); const v=vehicleMap.get(normalizeVehicle(rawVehicle));
    const vehicleNumber=v?.number||rawVehicle||"UNKNOWN"; const vehicleType=v?.type||normalizeExperienceVehicleType(clean(r["Vehicle Type"])||(vehicleNumber&&/^[0-9]/.test(vehicleNumber)?"PICKUP":vehicleNumber?"VAN":"UNKNOWN")); const matchedVehicleRow=(vehiclesR.data||[]).find((vv:any)=>normalizeVehicle(clean(vv.vehicle_number||vv.number))===normalizeVehicle(vehicleNumber)); const anchored=matchedVehicleRow?vehicleAnchorById.get(String(matchedVehicleRow.id)):undefined;
    const salesmanCandidates=[r["Salesman"],r["Salesman Name"],r["Salesman Description"],r["Sales Man"],r["Salesman Code"],r["Salesman ID"],r["Sales Code"]].map(normalizeExperienceMatch).filter(Boolean); const isConsumer=salesmanCandidates.some(x=>consumerSalesmen.has(x));
    for(const [personType,rawCode,rawName] of [["Driver",r["Driver Code"],r["Driver Name"]],["Helper",r["Helper Code"],r["Helper Name"]] as const]){
      const code=clean(rawCode).toUpperCase(); if(!code) continue;
      // Experience is only for people who currently exist in the Drivers/Helpers masters.
      // Never create history rows for departed/unlisted people just because their name/code
      // appears in an old SAP export. If the person is added to the master later, a future
      // Experience upload will pick them up automatically.
      const canonicalType=personTypeByCode.get(code); if(!canonicalType) continue;
      const name=names.get(code)!;
      orders.push({date,areaCode,areaName,areaSector,routeType,vehicleNumber,vehicleType,anchoredAreaCode:anchored?.code||null,anchoredAreaName:anchored?.name||null,code,name,personType:canonicalType,isConsumer});
      const k=`${canonicalType}|${code}|${date}`; const d=daily.get(k)||{consumer:0,pharma:0}; if(isConsumer)d.consumer++;else d.pharma++; daily.set(k,d);
    }
    if(i%250===0) progress({current_step:"Classifying exact daily experience",progress_pct:10+Math.round(i/rows.length*50),processed_units:i+1,total_units:rows.length});
  }
  // One compact record per person/day/area/vehicle. The Experience label is the person's
  // daily majority; ties deliberately resolve to Pharma. No date ranges are fabricated.
  const grouped=new Map<string,any>();
  for(const o of orders){const m=daily.get(`${o.personType}|${o.code}|${o.date}`)!;const exp=m.consumer>m.pharma?"Consumer":"Pharma";const key=`${o.personType}|${o.code}|${o.date}|${o.areaCode}|${normalizeVehicle(o.vehicleNumber)}`;const g=grouped.get(key)||{person_code:o.code,person_name:o.name,person_type:o.personType,area:o.areaName,area_code:o.areaCode,area_name:o.areaName,sector:o.areaSector,date:o.date,end_date:o.date,vehicle_number:o.vehicleNumber,vehicle_type:o.vehicleType,experience_division:exp,experience_type:exp,route_type:o.routeType,experienced_area_code:o.areaCode,experienced_area_name:o.areaName,anchored_area_code:o.anchoredAreaCode||null,anchored_area_name:o.anchoredAreaName||null,order_count:0,consumer_orders:0,pharma_orders:0};g.order_count++;if(o.isConsumer)g.consumer_orders++;else g.pharma_orders++;grouped.set(key,g);}
  // The database conflict target is (person_code, person_type, date, area, vehicle_number).
  // Deduplicate against that exact target before every upsert. This prevents Postgres
  // from receiving two rows that target the same existing/new row in one statement.
  const payloadByConflictKey=new Map<string,any>();
  for(const r of grouped.values()){
    const key=`${clean(r.person_code).toUpperCase()}|${clean(r.person_type)}|${clean(r.date)}|${clean(r.area)}|${clean(r.vehicle_number)}`;
    const existing=payloadByConflictKey.get(key);
    if(existing){
      existing.order_count=Number(existing.order_count||0)+Number(r.order_count||0);
      existing.consumer_orders=Number(existing.consumer_orders||0)+Number(r.consumer_orders||0);
      existing.pharma_orders=Number(existing.pharma_orders||0)+Number(r.pharma_orders||0);
    }else payloadByConflictKey.set(key,r);
  }
  const payload=[...payloadByConflictKey.values()]; progress({current_step:"Saving unified daily Experience records",progress_pct:70,processed_units:payload.length,total_units:payload.length});
  for(const client of clients){for(let i=0;i<payload.length;i+=250){const batch=payload.slice(i,i+250);const {error}=await client.from("experience_history").upsert(batch,{onConflict:"experience_key"});if(error)throw new Error(`Experience save failed: ${error.message}`);}}
  progress({status:"completed",current_step:"Experience upload complete",progress_pct:100,processed_units:payload.length,total_units:payload.length,log:`${payload.length} exact daily unified experience records saved. The uploaded workbook was processed in memory only; it was not imported into SAP Dashboard data or retained as an SAP import.`});
  return {rows:payload.length,days:new Set(payload.map(x=>`${x.person_type}|${x.person_code}|${x.date}`)).size,people:new Set(payload.map(x=>`${x.person_type}|${x.person_code}`)).size};
}

function normalizeAreaKey(value: unknown): string { return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, ""); }


export async function resetExperiencePeriod(year:number, month:number): Promise<{ rows:number }> {
  const clients=getFederatedSupabaseClients();
  const startDate=`${year}-${String(month).padStart(2,"0")}-01`;
  const endDate=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10);
  let deleted=0;
  for(const client of clients){
    // Delete only Experience rows for the selected month. Never touch SAP facts, V-Zone, or route assignments.
    const {data,error}=await client.from("experience_history").select("id").gte("date",startDate).lt("date",endDate);
    if(error) throw new Error(`Experience reset failed: ${error.message}`);
    const ids=(data||[]).map((r:any)=>r.id).filter(Boolean);
    for(let i=0;i<ids.length;i+=500){
      const {error:e}=await client.from("experience_history").delete().in("id",ids.slice(i,i+500));
      if(e) throw new Error(`Experience reset failed: ${e.message}`);
    }
    deleted+=ids.length;
  }
  // Verify both clouds are actually empty for the selected month before reporting success.
  for(const client of clients){
    const {count,error}=await client.from("experience_history").select("id",{count:"exact",head:true}).gte("date",startDate).lt("date",endDate);
    if(error) throw new Error(`Experience reset verification failed: ${error.message}`);
    if(Number(count||0)!==0) throw new Error(`Experience reset could not fully remove ${startDate} to ${endDate}. Remaining records: ${count}`);
  }
  return {rows:deleted};
}

export async function resetAllExperienceData(): Promise<{ rows: number }> {
  const now=new Date();
  const clients=getFederatedSupabaseClients();
  let deleted=0;
  for(const client of clients){
    const {data,error}=await client.from("experience_history").select("id");
    if(error) throw new Error(`Experience reset failed: ${error.message}`);
    const ids=(data||[]).map((r:any)=>r.id).filter(Boolean);
    for(let i=0;i<ids.length;i+=500){
      const {error:e}=await client.from("experience_history").delete().in("id",ids.slice(i,i+500));
      if(e) throw new Error(`Experience reset failed: ${e.message}`);
    }
    deleted+=ids.length;
  }
  for(const client of clients){
    const {count,error}=await client.from("experience_history").select("id",{count:"exact",head:true});
    if(error) throw new Error(`Experience reset verification failed: ${error.message}`);
    if(Number(count||0)!==0) throw new Error(`Experience reset could not fully remove all data. Remaining records: ${count}`);
  }
  return {rows:deleted};
}


/** Reclassifies existing Experience rows using the CURRENT Dashboard Configuration
 * Salesman Categorization and the SAP facts already stored in the Dashboard.
 * It updates only rows that can be matched; it never deletes history and never
 * creates missing people. This keeps Experience independent while allowing a
 * newly assigned Consumer salesman to immediately change Consumer/Pharma counts.
 */
export async function refreshExperienceClassification(onProgress?: (p: ImportProgress) => void): Promise<{ updated: number }> {
  const progress=(patch:Partial<ImportProgress>)=>onProgress?.({status:"processing",progress_pct:0,current_step:"",processed_units:0,total_units:0,estimated_seconds_remaining:0,log:"",error:"",...patch});
  const clients=getFederatedSupabaseClients();
  progress({current_step:"Reading current Dashboard Configuration and SAP history",progress_pct:5});
  const [masters, expResults, sapResults]=await Promise.all([
    Promise.all(clients.map(c=>Promise.all([c.from("drivers").select("code,name"),c.from("helpers").select("code,name"),c.from("vehicles").select("vehicle_number,number,vehicle_type,type"),c.from("areas").select("code,name,sector,route_type"),c.from("consumer_salesmen").select("salesman_code,name,salesman_name")]))),
    Promise.all(clients.map(c=>c.from("experience_history").select("id,person_code,person_name,person_type,area_code,area_name,area,sector,route_type,date,end_date,vehicle_number,vehicle_type,experience_division,experience_type,order_count,consumer_orders,pharma_orders"))),
    Promise.all(clients.map(async c=>{const out:any[]=[];for(let from=0;;from+=1000){const {data,error}=await c.from("sap_invoice_facts").select("dispatch_date,driver_code,driver_name,helper_code,helper_name,vehicle_num,vehicle_number,vehicle_type,area,division_desc,salesman,is_order,is_resupply,excluded").range(from,from+999);if(error)throw error;out.push(...(data||[]));if((data||[]).length<1000)break;}return {data:out,error:null};}))
  ]);
  const error=[...masters.flat(),...expResults,...sapResults].map((r:any)=>r.error).find(Boolean);if(error)throw new Error(error.message);
  const [driversR,helpersR,vehiclesR,areasR,salesmenR]=masters[0] as any[];
  const people=new Set<string>();for(const r of driversR.data||[])people.add(`Driver|${clean(r.code).toUpperCase()}`);for(const r of helpersR.data||[])people.add(`Helper|${clean(r.code).toUpperCase()}`);
  const vehicles=new Map<string,string>();for(const r of vehiclesR.data||[]){const n=clean(r.vehicle_number||r.number);const k=normalizeVehicle(n);if(k&&!vehicles.has(k))vehicles.set(k,normalizeExperienceVehicleType(r.vehicle_type||r.type));}
  const areaByCode=new Map<string,any>();const areaByName=new Map<string,any>();for(const a of areasR.data||[]){const rec={code:clean(a.code),name:clean(a.name),sector:clean(a.sector)||"Pharma",route_type:clean(a.route_type)};if(rec.code)areaByCode.set(normalizeAreaKey(rec.code),rec);if(rec.name)areaByName.set(normalizeAreaKey(rec.name),rec);}
  const consumers=new Set<string>();
  for(const master of masters) for(const r of ((master[4] as any)?.data||[])) for(const v of [r.salesman_code,r.name,r.salesman_name]) { const n=normalizeExperienceMatch(v); if(n) consumers.add(n); }
  const counts=new Map<string,{consumer:number;pharma:number}>();
  for(const result of sapResults){for(const r of result.data||[]){if(r.is_order===0||r.is_resupply===true||r.excluded===true)continue;const date=clean(r.dispatch_date);if(!date)continue;const rawCode=clean(r.driver_code);const rawHelper=clean(r.helper_code);const vehicle=clean(r.vehicle_number||r.vehicle_num);const vt=vehicles.get(normalizeVehicle(vehicle))||normalizeExperienceVehicleType(r.vehicle_type||vehicle);const rawArea=clean(r.area);const area=areaByCode.get(normalizeAreaKey(rawArea))||areaByName.get(normalizeAreaKey(rawArea));const areaKey=area?.code||"UNKNOWN";const salesman=[r.salesman].map(normalizeExperienceMatch).filter(Boolean);const isConsumer=salesman.some((x:string)=>consumers.has(x));for(const [type,code] of [["Driver",rawCode],["Helper",rawHelper]] as const){const c=clean(code).toUpperCase();if(!c||!people.has(`${type}|${c}`))continue;const k=`${type}|${c}|${date}|${normalizeAreaKey(areaKey)}|${normalizeVehicle(vehicle)}`;const x=counts.get(k)||{consumer:0,pharma:0};if(isConsumer)x.consumer++;else x.pharma++;counts.set(k,x);}}}
  let updated=0;
  for(let projectIndex=0;projectIndex<expResults.length;projectIndex++){
    const result=expResults[projectIndex];
    const byId=new Map<string,any>();
    for(const row of result.data||[]){
      const key=`${row.person_type}|${clean(row.person_code).toUpperCase()}|${String(row.date).slice(0,10)}|${normalizeAreaKey(row.area_code&&row.area_code!=="UNKNOWN"?row.area_code:(row.area_name||row.area||"UNKNOWN"))}|${normalizeVehicle(row.vehicle_number)}`;
      const c=counts.get(key); if(!c) continue;
      const total=c.consumer+c.pharma; const exp=c.consumer>c.pharma?"Consumer":"Pharma";
      byId.set(String(row.id),{id:row.id,person_code:row.person_code,person_name:row.person_name,person_type:row.person_type,area:row.area,area_code:row.area_code,area_name:row.area_name,sector:row.sector,route_type:row.route_type,date:row.date,end_date:row.end_date||row.date,vehicle_number:row.vehicle_number,vehicle_type:row.vehicle_type,experience_division:exp,experience_type:exp,order_count:total,consumer_orders:c.consumer,pharma_orders:c.pharma});
    }
    const local=[...byId.values()]; updated+=local.length;
    progress({current_step:`Updating ${updated} existing Experience records`,progress_pct:70+Math.min(25,Math.round((projectIndex+1)/expResults.length*25)),processed_units:updated,total_units:Math.max(updated,1)});
    const client=clients[projectIndex];
    for(let i=0;i<local.length;i+=250){const {error:e}=await client.from("experience_history").upsert(local.slice(i,i+250),{onConflict:"id"});if(e)throw new Error(`Experience reclassification failed: ${e.message}`);}
  }
  progress({status:"completed",current_step:"Experience classification refreshed",progress_pct:100,processed_units:updated,total_units:updated,log:`${updated} existing Experience records were reclassified using the current Dashboard Configuration. Salesman names are not stored or displayed in Experience.`});
  return {updated};
}

export async function exportExperienceData(onProgress?: (p: ImportProgress) => void): Promise<{ rows: number }> {
  const progress = (patch: Partial<ImportProgress>) => onProgress?.({ status: "processing", progress_pct: 0, current_step: "", processed_units: 0, total_units: 0, estimated_seconds_remaining: 0, log: "", error: "", ...patch });
  progress({ current_step: "Reading unified Experience history", progress_pct: 10 });
  const clients=getFederatedSupabaseClients();
  const rows:any[]=[]; const pageSize=1000;
  for(const client of clients){for(let from=0;;from+=pageSize){
    const {data,error}=await client.from("experience_history").select("person_code,person_name,person_type,area_code,area_name,area,sector,route_type,date,end_date,experience_division,experience_type,vehicle_type,vehicle_number,order_count,consumer_orders,pharma_orders").order("date",{ascending:true}).range(from,from+pageSize-1);
    if(error) throw new Error(`Experience export failed: ${error.message}`);
    const page=data||[]; rows.push(...page); if(page.length<pageSize) break;
  }}
  const unique=new Map<string,any>(); for(const r of rows){const key=`${String(r.person_code||"").toUpperCase()}|${String(r.person_type||"")}|${String(r.date||"").slice(0,10)}|${String(r.area_code||r.area||"").toUpperCase()}|${String(r.vehicle_number||"").toUpperCase().replace(/[^A-Z0-9]/g,"")}`; if(!unique.has(key)) unique.set(key,r);} const deduped=[...unique.values()];
  progress({current_step:`Reading Experience history (${deduped.length} unique rows)`,progress_pct:60,processed_units:deduped.length,total_units:Math.max(deduped.length,1)});
  const XLSX = await import("xlsx");
  const exportRows=deduped.map(r=>({
    "Person Code":r.person_code||"", "Person Name":r.person_name||"", "Person Type":r.person_type||"",
    "Area Code":r.area_code||"", "Area Name":r.area_name||r.area||"", "Area":r.area||r.area_name||"",
    "Sector":r.sector||"", "Route Type":r.route_type||"", "Date":r.date||"", "End Date":r.end_date||r.date||"",
    "Experience":r.experience_division||r.experience_type||"", "Vehicle Type":r.vehicle_type||"", "Vehicle Number":r.vehicle_number||"",
    "Order Count":Number(r.order_count||0), "Consumer Orders":Number(r.consumer_orders||0), "Pharma Orders":Number(r.pharma_orders||0),
  }));
  const ws=XLSX.utils.json_to_sheet(exportRows); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Experience");
  const {saveWorkbookToDispatchFolder}=await import("./desktopExport");
  await saveWorkbookToDispatchFolder(wb,`Experience_Data_${new Date().toISOString().slice(0,10).replace(/-/g,"")}.xlsx`);
  progress({status:"completed",current_step:"Experience export complete",progress_pct:100,processed_units:rows.length,total_units:rows.length,log:`${deduped.length} unique Experience records exported. This export is a backup/snapshot and can be imported again later.`});
  return {rows:deduped.length};
}

export async function importExperienceDataExport(file: File, onProgress?: (p: ImportProgress) => void): Promise<{ rows: number; skipped_people: number }> {
  const progress = (patch: Partial<ImportProgress>) => onProgress?.({ status: "processing", progress_pct: 0, current_step: "", processed_units: 0, total_units: 0, estimated_seconds_remaining: 0, log: "", error: "", ...patch });
  const workbook=await workbookFromFile(file); const rows=firstSheetRows(workbook); if(!rows.length) throw new Error("The Experience data file contains no rows.");
  const required=["Person Code","Person Type","Date","Area Code","Vehicle Number"];
  const headers=Object.keys(rows[0]||{}).map(x=>String(x).trim()); const missing=required.filter(h=>!headers.some(x=>x.toLowerCase()===h.toLowerCase())); if(missing.length) throw new Error(`This is not a DispatchOPS Experience export. Missing: ${missing.join(", ")}`);
  progress({current_step:"Checking current Drivers, Helpers, Fleet and Areas masters",progress_pct:10,total_units:rows.length});
  const clients=getFederatedSupabaseClients();
  const masterResults=await Promise.all(clients.map(c=>Promise.all([c.from("drivers").select("code,name"),c.from("helpers").select("code,name"),c.from("vehicles").select("vehicle_number,number,vehicle_type,type"),c.from("areas").select("code,name,sector,route_type")]))) ;
  const err=masterResults.flat().map((r:any)=>r.error).find(Boolean); if(err) throw new Error(err.message);
  const [driversR,helpersR,vehiclesR,areasR]=masterResults[0] as any[];
  const people=new Map<string,{type:"Driver"|"Helper";name:string}>(); for(const r of driversR.data||[]){const c=clean(r.code).toUpperCase();if(c)people.set(`Driver|${c}`,{type:"Driver",name:clean(r.name)||c});} for(const r of helpersR.data||[]){const c=clean(r.code).toUpperCase();if(c)people.set(`Helper|${c}`,{type:"Helper",name:clean(r.name)||c});}
  const vehicles=new Map<string,{number:string;type:string}>(); for(const r of vehiclesR.data||[]){const n=clean(r.vehicle_number||r.number);const k=normalizeVehicle(n);if(k&&!vehicles.has(k))vehicles.set(k,{number:n,type:normalizeExperienceVehicleType(r.vehicle_type||r.type)});}
  const areasByCode=new Map<string,any>(); const areasByName=new Map<string,any>(); for(const a of areasR.data||[]){const rec={code:clean(a.code),name:clean(a.name),sector:clean(a.sector)||"Pharma",route_type:clean(a.route_type)};if(rec.code)areasByCode.set(normalizeAreaKey(rec.code),rec);if(rec.name)areasByName.set(normalizeAreaKey(rec.name),rec);}
  const payload:any[]=[]; let skipped=0;
  for(let i=0;i<rows.length;i++){
    const r:any=rows[i]; const code=clean(r["Person Code"]).toUpperCase(); const type=clean(r["Person Type"]) as "Driver"|"Helper"; const person=people.get(`${type}|${code}`); if(!person){skipped++;continue;}
    const date=excelDate(r["Date"]); if(!date) continue;
    const rawAreaCode=clean(r["Area Code"]); const rawAreaName=clean(r["Area Name"]); const rawArea=clean(r["Area"]);
    const area=areasByCode.get(normalizeAreaKey(rawAreaCode))||areasByName.get(normalizeAreaKey(rawAreaCode))||areasByCode.get(normalizeAreaKey(rawArea))||areasByName.get(normalizeAreaKey(rawArea))||areasByName.get(normalizeAreaKey(rawAreaName))||areasByCode.get(normalizeAreaKey(rawAreaName));
    const areaCode=area?.code||"UNKNOWN"; const areaName=area?.name||rawAreaName||rawArea||rawAreaCode||"UNKNOWN";
    const rawVehicle=clean(r["Vehicle Number"]); const v=vehicles.get(normalizeVehicle(rawVehicle)); const vehicleNumber=v?.number||rawVehicle||"UNKNOWN";
    const vehicleType=v?.type||normalizeExperienceVehicleType(clean(r["Vehicle Type"])||"UNKNOWN"); const exp=clean(r["Experience"])||clean(r["Experience Division"])||"Pharma";
    payload.push({person_code:code,person_name:person.name,person_type:person.type,area:areaName,area_code:areaCode,area_name:areaName,sector:area?.sector||clean(r["Sector"])||"Pharma",route_type:area?.route_type||clean(r["Route Type"]),date,end_date:excelDate(r["End Date"])||date,vehicle_number:vehicleNumber,vehicle_type:vehicleType,experience_division:exp,experience_type:exp,order_count:Number(r["Order Count"]||0),consumer_orders:Number(r["Consumer Orders"]||0),pharma_orders:Number(r["Pharma Orders"]||0)});
    if(i%250===0) progress({current_step:"Validating Experience backup",progress_pct:15+Math.round(i/rows.length*45),processed_units:i+1,total_units:rows.length});
  }
  // Backup imports must deduplicate on the exact database conflict columns.
  // Do not use normalized Area Code / Vehicle keys here because Postgres conflicts
  // on the canonical stored Area + Vehicle Number values.
  const dedupe=new Map<string,any>(); for(const r of payload){const k=`${clean(r.person_code).toUpperCase()}|${clean(r.person_type)}|${clean(r.date)}|${clean(r.area)}|${clean(r.vehicle_number)}`; const old=dedupe.get(k); if(old){old.order_count=Math.max(Number(old.order_count||0),Number(r.order_count||0));old.consumer_orders=Math.max(Number(old.consumer_orders||0),Number(r.consumer_orders||0));old.pharma_orders=Math.max(Number(old.pharma_orders||0),Number(r.pharma_orders||0));}else dedupe.set(k,r);}
  const cleanPayload=[...dedupe.values()]; progress({current_step:"Merging Experience without duplicates",progress_pct:70,processed_units:0,total_units:cleanPayload.length});
  for(const c of clients) for(let i=0;i<cleanPayload.length;i+=250){const {error}=await c.from("experience_history").upsert(cleanPayload.slice(i,i+250),{onConflict:"experience_key"});if(error) throw new Error(`Experience backup import failed: ${error.message}`);}
  progress({status:"completed",current_step:"Experience backup import complete",progress_pct:100,processed_units:cleanPayload.length,total_units:cleanPayload.length,log:`${cleanPayload.length} records merged. ${skipped} records were skipped because the Driver/Helper code is not currently in the master.`});
  return {rows:cleanPayload.length,skipped_people:skipped};
}

export async function processImportFile(
  file: File,
  sourceType: "sap" | "landmark",
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportBatch> {
  const progress = (patch: Partial<ImportProgress>) => onProgress?.({ status: "processing", progress_pct: 0, current_step: "", processed_units: 0, total_units: 0, estimated_seconds_remaining: 0, log: "", error: "", ...patch });
  let batch: ImportBatch | null = null;
  try {
    progress({ current_step: "Uploading original source file", progress_pct: 5 });
    batch = await startImportBatch(file, { source_type: sourceType, imported_by_device: navigator.userAgent });
    const importClient = getSupabaseClientByProject((batch.storage_project as any) || "primary");
    const workbook = await workbookFromFile(file);
    const rows = firstSheetRows(workbook);
    progress({ current_step: "Validating file", total_units: rows.length, progress_pct: 15 });
    const errors = sourceType === "sap" ? validateSapHeaders(rows) : [];
    if (errors.length) {
      await finalizeImportBatch(batch.id, { row_count: rows.length, success_count: 0, failed_count: rows.length, validation_errors: errors });
      throw new Error(errors.join("\n"));
    }
    progress({ current_step: "Saving raw audit rows", processed_units: 0, total_units: rows.length, progress_pct: 25 });
    await insertRawImportRows(rows.map((row, index) => ({ source_type: sourceType, batch_id: batch!.id, source_filename: file.name, row_index: index, row_json: row, imported_by: "", label: "" })), importClient);
    let facts: JsonRow[] = [], rejected: string[] = [];
    if (sourceType === "sap") {
      ({ facts, rejected } = parseSapFacts(rows, batch.id, file.name));
      progress({ current_step: "Saving SAP invoice facts", processed_units: rows.length, total_units: rows.length, progress_pct: 55 });
      await insertChunks("sap_invoice_facts", facts, importClient);
      await updateLearnedValues(rows, importClient);
      // Experience is intentionally independent from the normal SAP Dashboard import.
      // Only the dedicated Experience upload is allowed to write experience_history.
      await updateDailyDivisions(facts, importClient);
    } else {
      facts = parseLandmarkFacts(firstSheetGrid(workbook), batch.id, file.name);
      progress({ current_step: "Saving V-Zone / Landmark visit facts", processed_units: rows.length, total_units: rows.length, progress_pct: 60 });
      await insertChunks("landmark_visit_facts", facts, importClient);
    }
    const failed = rejected.length;
    const finished = await finalizeImportBatch(batch.id, { row_count: rows.length, success_count: facts.length, failed_count: failed, validation_errors: rejected.slice(0, 200) });
    progress({ status: failed ? "partial" : "completed", current_step: "Import complete", progress_pct: 100, processed_units: rows.length, total_units: rows.length, log: `${facts.length} parsed facts stored. Original file retained in Supabase Storage.` });
    return finished;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (batch) {
      const ownerClient = getSupabaseClientByProject((batch.storage_project as any) || "primary");
      await ownerClient.from("import_batches").update({ status: "failed", validation_errors: [message] }).eq("id", batch.id);
    }
    progress({ status: "failed", current_step: "Import failed", error: message });
    throw error;
  }
}

export async function getImportBatchesForUi() {
  const batches = await listImportHistory();
  return Promise.all(batches.map(async (b) => {
    const table = b.source_type === "sap" ? "sap_invoice_facts" : "landmark_visit_facts";
    const { count } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("batch_id", b.id);
    return { batch_id: b.id, source_type: b.source_type, filename: b.original_filename, imported_by: b.imported_by, label: (b as ImportBatch & { label?: string }).label || "", imported_at: b.imported_at, raw_row_count: b.row_count, parsed_fact_count: count || b.success_count, storage_path: b.storage_path };
  }));
}

export async function getImportBatchRows(batchId: string, limit = 25) {
  const { data, error, count } = await supabase.from("raw_import_rows").select("row_index,row_json", { count: "exact" }).eq("batch_id", batchId).order("row_index").limit(limit);
  if (error) throw new Error(error.message);
  return { total: count || 0, limit, offset: 0, rows: (data || []).map((r) => ({ row_index: r.row_index, data: JSON.stringify(r.row_json) })) };
}

export async function labelImportBatch(batchId: string, label: string) {
  const { data: batch, error: findError } = await supabase.from("import_batches").select("storage_project").eq("id", batchId).maybeSingle();
  if (findError) throw new Error(findError.message);
  const client = getSupabaseClientByProject((batch?.storage_project as any) || "primary");
  const { error } = await client.from("import_batches").update({ label }).eq("id", batchId); if (error) throw new Error(error.message);
  await client.from("raw_import_rows").update({ label }).eq("batch_id", batchId);
}

export async function deleteImportedData(batchId: string) {
  // Delete from the project that owns the batch. Reads remain federated.
  const { data: batch, error: findError } = await supabase.from("import_batches").select("storage_project").eq("id", batchId).maybeSingle();
  if (findError) throw new Error(findError.message);
  const client = getSupabaseClientByProject((batch?.storage_project as any) || "primary");
  for (const table of ["sap_invoice_facts", "landmark_visit_facts", "raw_import_rows"] as const) {
    const { error } = await client.from(table).delete().eq("batch_id", batchId);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  const { error } = await client.from("import_batches").delete().eq("id", batchId);
  if (error) throw new Error(error.message);
}
