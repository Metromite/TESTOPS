import { supabase, getPrimarySupabaseClient, getSupabaseClientByProject, getFederatedSupabaseClients } from "@/lib/supabase";
import { getReplacementForecast } from "./routePlanner";

const SINGLETON = "00000000-0000-0000-0000-000000000001";
const today = () => new Date().toISOString().slice(0, 10);

export async function getAvailability<T>(): Promise<T> {
  // Route Status is an operational KPI and must come from the canonical Primary
  // DispatchOPS database only. Do not merge the three federated read replicas here.
  const db = getPrimarySupabaseClient();
  const [d,h,v,a] = await Promise.all([
    db.from("drivers").select("code,name,status"),
    db.from("helpers").select("code,name,status"),
    db.from("vacations").select("person_code,start_date,end_date"),
    db.from("areas").select("needs_driver,needs_helper,route_type")
  ]);
  const error=[d.error,h.error,v.error,a.error].find(Boolean); if(error) throw new Error(error.message);
  const date=today();
  const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase();
  const activeDriverRows=(d.data||[]).filter(x=>normalize(x.status)==="active");
  const activeHelperRows=(h.data||[]).filter(x=>normalize(x.status)==="active");
  const vacationCodes=new Set((v.data||[])
    .filter(x=>String(x.start_date||"").slice(0,10)<=date && date<=String(x.end_date||"").slice(0,10))
    .map(x=>String(x.person_code||"").trim())
    .filter(Boolean));
  const availableDrivers=activeDriverRows.filter(x=>!vacationCodes.has(String(x.code||"").trim()));
  const availableHelpers=activeHelperRows.filter(x=>!vacationCodes.has(String(x.code||"").trim()));
  const mandatoryDriverRoutes=(a.data||[]).filter(x=>normalize(x.needs_driver)==="mandatory").length;
  const mandatoryHelperRoutes=(a.data||[]).filter(x=>normalize(x.needs_helper)==="mandatory").length;
  const driverShortage=Math.max(0,mandatoryDriverRoutes-availableDrivers.length);
  const helperShortage=Math.max(0,mandatoryHelperRoutes-availableHelpers.length);
  const hasShortage=driverShortage>0 || helperShortage>0;
  return {
    drivers:{available_count:availableDrivers.length,total_count:activeDriverRows.length,available_names:availableDrivers.map(x=>x.name),on_vacation_names:activeDriverRows.filter(x=>vacationCodes.has(String(x.code||"").trim())).map(x=>x.name)},
    helpers:{available_count:availableHelpers.length,total_count:activeHelperRows.length,available_names:availableHelpers.map(x=>x.name),on_vacation_names:activeHelperRows.filter(x=>vacationCodes.has(String(x.code||"").trim())).map(x=>x.name)},
    extra_drivers:{count:Math.max(0,availableDrivers.length-mandatoryDriverRoutes),names:availableDrivers.slice(mandatoryDriverRoutes).map(x=>x.name)},
    extra_helpers:{count:Math.max(0,availableHelpers.length-mandatoryHelperRoutes),names:availableHelpers.slice(mandatoryHelperRoutes).map(x=>x.name)},
    shortage:{current_driver_shortage:driverShortage,future_driver_shortage:driverShortage,current_helper_shortage:helperShortage,future_helper_shortage:helperShortage,has_shortage:hasShortage}
  } as unknown as T;
}

export async function getCustomerStats<T>(): Promise<T>{ const {data,error}=await supabase.from("customer_aliases").select("times_confirmed");if(error)throw new Error(error.message);return{total_aliases_learned:(data||[]).length,aliases_confirmed_more_than_once:(data||[]).filter(x=>x.times_confirmed>1).length} as unknown as T; }
export async function getCustomerAliases<T>(search=""):Promise<T[]>{let q=supabase.from("customer_aliases").select("*").order("last_seen",{ascending:false});if(search)q=q.or(`sap_name_original.ilike.%${search.replace(/,/g,"")}%,landmark_name_original.ilike.%${search.replace(/,/g,"")}%`);const{data,error}=await q.limit(500);if(error)throw new Error(error.message);return(data||[]) as unknown as T[];}
export async function deleteCustomerAlias(sap:string,landmark:string){const{error}=await supabase.from("customer_aliases").delete().eq("sap_name_normalized",sap).eq("landmark_name_normalized",landmark);if(error)throw new Error(error.message);}

export async function getDriverMappingReview<T>():Promise<T>{const [lm,sap,map]=await Promise.all([supabase.from("landmark_visit_facts").select("vehicle_key,vehicle_raw,driver_name"),supabase.from("sap_invoice_facts").select("vehicle_key,vehicle_num,driver_name"),supabase.from("vehicle_driver_manual_mappings").select("*")]);const error=[lm.error,sap.error,map.error].find(Boolean);if(error)throw new Error(error.message);const manual=new Map((map.data||[]).map(x=>[x.vehicle_key,x.sap_driver]));const sapBy=new Map<string,string>();for(const r of sap.data||[])if(r.vehicle_key&&r.driver_name)sapBy.set(r.vehicle_key,r.driver_name);const keys=[...new Set((lm.data||[]).map(x=>x.vehicle_key).filter(Boolean))];const entries=keys.map(key=>{const gps=(lm.data||[]).find(x=>x.vehicle_key===key);const current=manual.get(key)||sapBy.get(key)||null;return{vehicle_key:key,vehicle_display:gps?.vehicle_raw||key,gps_driver_name:gps?.driver_name||null,current_sap_driver:current,match_method:manual.has(key)?"manual":sapBy.has(key)?"vehicle":"none"}});const options=[...new Set((sap.data||[]).map(x=>x.driver_name).filter(Boolean))].sort();return{sap_driver_options:options,entries,counts:{vehicle:entries.filter(x=>x.match_method==="vehicle").length,name:entries.filter(x=>x.match_method==="name").length,manual:entries.filter(x=>x.match_method==="manual").length,none:entries.filter(x=>x.match_method==="none").length,total:entries.length}} as unknown as T;}
export async function applyDriverMapping(vehicle_key:string,sap_driver:string){const{error}=await supabase.from("vehicle_driver_manual_mappings").upsert({vehicle_key,sap_driver,updated_at:new Date().toISOString()});if(error)throw new Error(error.message);}
export async function resetDriverMappings(){const{error}=await supabase.from("vehicle_driver_manual_mappings").delete().neq("vehicle_key","");if(error)throw new Error(error.message);}

export async function getConfigRules<T>():Promise<T>{const{data,error}=await supabase.from("dashboard_config_rules").select("*").order("rule_type").order("created_at");if(error)throw new Error(error.message);const rules:Record<string,unknown[]>={};for(const r of data||[]){(rules[r.rule_type]??=[]).push(r);}return{rules,enforced_types:["invoice_prefix","area","customer","facility","salesman","driver","vehicle_type","route_type","invoice_range","invoice_type","custom"]} as unknown as T;}
export async function addConfigRule(input:Record<string,unknown>){const{error}=await supabase.from("dashboard_config_rules").insert(input);if(error)throw new Error(error.message);}
export async function deleteConfigRule(id:string){const{error}=await supabase.from("dashboard_config_rules").delete().eq("id",id);if(error)throw new Error(error.message);}
export async function getConsumerSalesmen<T>():Promise<T[]>{
  const clients=getFederatedSupabaseClients();
  const results=await Promise.all(clients.map(c=>c.from("consumer_salesmen").select("*")));
  const error=results.map(r=>r.error).find(Boolean); if(error)throw new Error(error.message);
  const seen=new Set<string>(); const out:any[]=[];
  for(const result of results) for(const row of result.data||[]){const key=String(row.name||row.salesman_name||row.salesman_code||"").trim().toUpperCase();if(!key||seen.has(key))continue;seen.add(key);out.push(row);}
  return out.sort((a,b)=>String(a.name||a.salesman_name||"").localeCompare(String(b.name||b.salesman_name||""))) as unknown as T[];
}
export async function getSalesmanCandidates<T>(q:string):Promise<T[]>{
  const clients=getFederatedSupabaseClients();
  const results=await Promise.all(clients.map(c=>Promise.all([c.from("learned_values").select("value").eq("category","salesman").limit(500),c.from("consumer_salesmen").select("name,salesman_name").limit(500)])));
  const error=results.flat().map((r:any)=>r.error).find(Boolean); if(error)throw new Error(error.message);
  const needle=q.trim().toLowerCase(); const values=new Map<string,string>(); const assigned=new Set<string>();
  for(const pair of results){for(const x of pair[0].data||[]){const v=typeof x.value==="string"?x.value:(typeof x.value?.value==="string"?x.value.value:String(x.value??""));if(v)values.set(v.trim().toUpperCase(),v.trim());}for(const x of pair[1].data||[]){const n=String(x.name||x.salesman_name||"").trim();if(n)assigned.add(n.toUpperCase());}}
  return [...values.values()].filter(v=>!needle||v.toLowerCase().includes(needle)).slice(0,30).map(name=>({name,is_consumer:assigned.has(name.toUpperCase())})) as unknown as T[];
}
export async function addConsumerSalesman(name:string){
  const value=name.trim(); if(!value)throw new Error("Salesman name is required.");
  const clients=getFederatedSupabaseClients();
  const results=await Promise.all(clients.map(c=>c.from("consumer_salesmen").upsert({name:value},{onConflict:"name"})));
  const error=results.map(r=>r.error).find(Boolean); if(error)throw new Error(error.message);
}
export async function deleteConsumerSalesman(idOrName:string){
  const clients=getFederatedSupabaseClients();
  const results=await Promise.all(clients.map(c=>c.from("consumer_salesmen").delete().or(`id.eq.${idOrName},name.eq.${idOrName}`)));
  const error=results.map(r=>r.error).find(Boolean); if(error)throw new Error(error.message);
}
export async function getDriverDivisionMajority<T>():Promise<T>{
  const {data,error}=await supabase.from("driver_daily_divisions").select("person_code,person_name,consumer_invoices,pharma_invoices");
  if(error)throw new Error(error.message);
  const acc:Record<string,{person_name:string;consumer_orders:number;pharma_orders:number}>={};
  for(const r of data||[]){const a=acc[r.person_code]||(acc[r.person_code]={person_name:r.person_name||"",consumer_orders:0,pharma_orders:0});a.consumer_orders+=Number(r.consumer_invoices||0);a.pharma_orders+=Number(r.pharma_invoices||0);if(r.person_name)a.person_name=r.person_name;}
  const out:Record<string,unknown>={};for(const[k,v]of Object.entries(acc))out[k]={person_name:v.person_name,division:v.consumer_orders>v.pharma_orders?"Consumer":"Pharma",consumer_orders:v.consumer_orders,pharma_orders:v.pharma_orders,total_orders:v.consumer_orders+v.pharma_orders};return out as unknown as T;
}

export async function getMetaOptions<T>():Promise<T>{const{data,error}=await supabase.from("areas").select("vehicle_type,route_type");if(error)throw new Error(error.message);return{vehicle_types:[...new Set((data||[]).map(x=>x.vehicle_type).filter(Boolean))],route_types:[...new Set((data||[]).map(x=>x.route_type).filter(Boolean))]} as unknown as T;}
export async function getDrivers<T>():Promise<T[]>{const{data,error}=await supabase.from("drivers").select("*").order("name");if(error)throw new Error(error.message);return(data||[]) as unknown as T[];}

function dateFromArrival(s:string):string{const m=s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return`${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;const d=new Date(s);return Number.isNaN(d.getTime())?"":d.toISOString().slice(0,10)}
export async function getRouteDriverDates<T>():Promise<T[]>{const [sap,lm]=await Promise.all([supabase.from("sap_invoice_facts").select("driver_name,dispatch_date"),supabase.from("landmark_visit_facts").select("driver_name,arrival")]);const error=sap.error||lm.error;if(error)throw new Error(error.message);const set=new Set<string>();for(const r of sap.data||[])if(r.driver_name&&r.dispatch_date)set.add(`${r.driver_name}|${r.dispatch_date}`);for(const r of lm.data||[]){const d=dateFromArrival(r.arrival||"");if(r.driver_name&&d)set.add(`${r.driver_name}|${d}`)}return[...set].map(x=>{const[driver_name,date]=x.split("|");return{driver_name,date}}).sort((a,b)=>b.date.localeCompare(a.date)) as unknown as T[];}
export async function reconstructRoute<T>(driver:string,date:string):Promise<T>{const [sap,lm]=await Promise.all([supabase.from("sap_invoice_facts").select("invoice_no,customer_name,customer_name_source,box_entry_time,boxes,area,vehicle_key,vehicle_num").eq("driver_name",driver).eq("dispatch_date",date),supabase.from("landmark_visit_facts").select("customer_name,arrival,departure,minutes,vehicle_key,driver_name").eq("driver_name",driver)]);const error=sap.error||lm.error;if(error)throw new Error(error.message);const l=(lm.data||[]).filter(x=>dateFromArrival(x.arrival||"")===date);return{sap_route:{stops_missing_time:(sap.data||[]).filter(x=>!x.box_entry_time).length,stops:(sap.data||[])},landmark_route:{all_stops_count:l.length,delivery_stops:l.map(x=>({customer_name:x.customer_name,arrival:x.arrival,departure:x.departure,duration_minutes:x.minutes}))}} as unknown as unknown as T;}

async function getFederatedExperienceRows():Promise<any[]>{
  const clients=getFederatedSupabaseClients();
  const results=await Promise.all(clients.map(c=>{let q=c.from("experience_history").select("*").order("date",{ascending:false});return q;}));
  const error=results.map(r=>r.error).find(Boolean); if(error) throw new Error(error.message);
  const seen=new Map<string,any>();
  for(const result of results) for(const r of result.data||[]){
    const key=`${String(r.person_code||"").toUpperCase()}|${String(r.person_type||"")}|${String(r.date||"").slice(0,10)}|${String(r.area_code||r.area||"").toUpperCase()}|${String(r.vehicle_number||"").toUpperCase().replace(/[^A-Z0-9]/g,"")}`;
    if(!seen.has(key)) seen.set(key,r);
  }
  return [...seen.values()].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
}

export async function getExperienceSummary<T>():Promise<T[]>{
  const data=await getFederatedExperienceRows(); const map=new Map<string,any>();
  for(const r of data){const k=`${r.person_type}|${r.person_code}`;const x=map.get(k)||{person_code:r.person_code,person_name:r.person_name,person_type:r.person_type,dates:new Set<string>(),areas:new Set<string>(),divisions:{Consumer:0,Pharma:0},vehicles:{VAN:0,PICKUP:0},last_date:"",last_area:""};x.dates.add(String(r.date));x.areas.add(String(r.experienced_area_code||r.area_code||"UNKNOWN"));x.divisions.Consumer+=Number(r.consumer_orders||0);x.divisions.Pharma+=Number(r.pharma_orders||0);const vt=String(r.vehicle_type||"").toUpperCase();if(vt.includes("PICK"))x.vehicles.PICKUP+=1;else if(vt.includes("VAN"))x.vehicles.VAN+=1;if(!x.last_date||String(r.date)>x.last_date){x.last_date=String(r.date);x.last_area=`${String(r.experienced_area_code||r.area_code||"UNKNOWN")} · ${String(r.experienced_area_name||r.area_name||r.area||"")}`;}map.set(k,x);}
  return [...map.values()].map(x=>({person_code:x.person_code,person_name:x.person_name,person_type:x.person_type,distinct_areas:x.areas.size,total_days:x.dates.size,consumer_days:0,pharma_days:0,consumer_orders:x.divisions.Consumer,pharma_orders:x.divisions.Pharma,most_recent_area:x.last_area,most_recent_end:x.last_date,vehicle_types:Object.entries(x.vehicles).filter(([,n])=>Number(n)>0).map(([k])=>k).join(" / ")||"UNKNOWN",experience:x.divisions.Consumer>x.divisions.Pharma?"Consumer":"Pharma"})) as unknown as T[];
}
export async function getExperienceSuggestions<T>(q:string):Promise<T[]>{
  const needle=q.trim().toLowerCase(); const [d,h,e]=await Promise.all([supabase.from("drivers").select("code,name").or(`code.ilike.%${q}%,name.ilike.%${q}%`).limit(10),supabase.from("helpers").select("code,name").or(`code.ilike.%${q}%,name.ilike.%${q}%`).limit(10),getFederatedExperienceRows()]);
  const err=d.error||h.error;if(err)throw new Error(err.message); const out:any[]=[...(d.data||[]).map(x=>({label:`${x.name} (${x.code})`,value:x.code,kind:"Driver"})),...(h.data||[]).map(x=>({label:`${x.name} (${x.code})`,value:x.code,kind:"Helper"}))];
  const seen=new Set(out.map(x=>`${x.kind}|${x.value}`)); for(const x of e){const label=`${x.person_name} (${x.person_code}) · ${x.area_name||x.area||"UNKNOWN"} · ${x.experience_division||""} · ${x.vehicle_type||""}${x.vehicle_number?` · ${x.vehicle_number}`:""}`;const k=`${x.person_type}|${x.person_code}`;if(!seen.has(k)&&(!needle||label.toLowerCase().includes(needle))) {out.push({label,value:x.person_code,kind:x.person_type});seen.add(k);}} return out.filter(x=>!needle||x.label.toLowerCase().includes(needle)).slice(0,30) as unknown as T[];
}
export async function getExperienceDetail<T>(code:string,type:string):Promise<T[]>{const rows=await getFederatedExperienceRows();return rows.filter(r=>String(r.person_code)===String(code)&&String(r.person_type)===String(type)) as unknown as T[];}

export async function getControlCenterConfig<T>():Promise<T>{const{data,error}=await supabase.from("control_center_config").select("config,version,updated_at").eq("id",SINGLETON).maybeSingle();if(error)throw new Error(error.message);return{config:data?.config||null,version:Number(data?.version||0)} as unknown as unknown as T;}
export async function saveControlCenterConfig<T>(config:unknown):Promise<T>{const version=Date.now();const{error}=await supabase.from("control_center_config").upsert({id:SINGLETON,config,version,updated_at:new Date().toISOString()});if(error)throw new Error(error.message);return{config,version} as unknown as unknown as T;}

async function fetchAllDiagnosticRows(table:string, select:string, batchId?:string):Promise<any[]>{
  const out:any[]=[]; const pageSize=1000;
  for(let from=0;;from+=pageSize){
    let q=supabase.from(table).select(select);
    if(batchId) q=q.eq("batch_id",batchId);
    const {data,error}=await q.range(from,from+pageSize-1);
    if(error) throw new Error(error.message);
    const page=data||[]; out.push(...page); if(page.length<pageSize) break;
  }
  return out;
}
export async function getDiagnostics<T>():Promise<T>{
  const latestLm=await supabase.from("import_batches").select("id").eq("source_type","landmark").eq("status","completed").is("deleted_at",null).order("imported_at",{ascending:false}).limit(1).maybeSingle();
  if(latestLm.error) throw new Error(latestLm.error.message);
  const [sapRows,lmRows,manual]=await Promise.all([
    fetchAllDiagnosticRows("sap_invoice_facts","vehicle_key,driver_name,facility_type"),
    latestLm.data?.id?fetchAllDiagnosticRows("landmark_visit_facts","vehicle_key,driver_name",latestLm.data.id):Promise.resolve([]),
    supabase.from("vehicle_driver_manual_mappings").select("vehicle_key,sap_driver")
  ]);
  if(manual.error)throw new Error(manual.error.message);
  const sapByVehicle=new Map<string,string>(); for(const r of sapRows) if(r.vehicle_key&&r.driver_name&&!sapByVehicle.has(r.vehicle_key)) sapByVehicle.set(r.vehicle_key,r.driver_name);
  const manualMap=new Map<string,string>((manual.data||[]).map((r:any)=>[r.vehicle_key,r.sap_driver]));
  const lmKeys=[...new Set(lmRows.map((r:any)=>r.vehicle_key).filter(Boolean))] as string[];
  const details=lmKeys.map((key)=>({vehicle_key:key,sap_driver:manualMap.get(key)||sapByVehicle.get(key)||null,match_method:manualMap.has(key)?"manual":sapByVehicle.has(key)?"vehicle":"none"}));
  const fac=new Map<string,number>(); for(const r of sapRows){const k=r.facility_type||"Unclassified";fac.set(k,(fac.get(k)||0)+1)}
  const facility_breakdown=[...fac.entries()].sort((a,b)=>b[1]-a[1]).map(([type,count])=>({type,icon:type.toLowerCase().includes("pharm")?"💊":type.toLowerCase().includes("hospital")?"🏥":"🏪",count}));
  const unmatched=details.filter((d)=>d.match_method==="none").length;
  return {
    data_load_summary:{sap_rows_loaded:sapRows.length,sap_unique_vehicles:new Set(sapRows.map((r:any)=>r.vehicle_key).filter(Boolean)).size,sap_unique_drivers:new Set(sapRows.map((r:any)=>r.driver_name).filter(Boolean)).size,landmark_rows_loaded:lmRows.length,landmark_vehicle_sections:lmKeys.length},
    matching_results:{standalone_mode:lmKeys.length>0&&unmatched===lmKeys.length,vehicle_matches:details.filter((d)=>d.match_method==="vehicle"||d.match_method==="manual").length,name_matches:0,no_matches:unmatched,match_details:details},
    validation_results:[{level:sapRows.length?"ok":"warn",msg:sapRows.length?"SAP structured facts loaded":"No SAP facts loaded"},{level:lmRows.length?"ok":"warn",msg:lmRows.length?"V-Zone/Landmark facts loaded":"No V-Zone/Landmark facts loaded"},{level:unmatched?"warn":"ok",msg:unmatched?`${unmatched} GPS vehicle(s) remain unmatched`:`GPS vehicle matching is complete (${details.length} vehicle sections checked)`}],
    facility_breakdown,
    data_relationship_notes:["Original import files are retained in Supabase Storage.","Diagnostics now reads every Supabase result page instead of only the first 1,000 rows.","The latest completed V-Zone/Landmark batch is used for GPS diagnostics.","Manual vehicle-to-driver mappings override automatic vehicle-key matches."]
  } as unknown as T;
}
export async function getAudit<T>(entityType=""):Promise<T[]>{let q=supabase.from("audit_log").select("*").order("timestamp",{ascending:false});if(entityType)q=q.eq("entity_type",entityType);const{data,error}=await q.limit(1000);if(error)throw new Error(error.message);return(data||[]) as unknown as T[];}
export async function getReplacements<T>():Promise<T[]>{return getReplacementForecast<T>();}

const BACKUP_TABLES=["drivers","helpers","areas","vehicles","vehicle_permitted_areas","area_anchored_vehicles","vacations","experience_history","area_groups","area_group_members","driver_anchored_areas","driver_anchored_area_groups","vehicle_permitted_area_groups","route_assignments","dashboard_config_rules","consumer_salesmen","vehicle_driver_manual_mappings","customer_aliases","driver_aliases","appearance_config","control_center_config","route_sheet_layout"];
export async function listBackups<T>():Promise<T[]>{const{data,error}=await supabase.from("app_backups").select("id,label,created_at,row_count").order("created_at",{ascending:false});if(error)throw new Error(error.message);return(data||[]).map(x=>({backup_id:x.id,created_at:x.created_at,label:x.label,files:[{filename:"Supabase database snapshot",size_bytes:null,sha256:null,error:null}]})) as unknown as T[];}
export async function backupStats<T>():Promise<T>{const{data,error}=await supabase.from("app_backups").select("created_at").order("created_at",{ascending:false});if(error)throw new Error(error.message);return{total_backups:(data||[]).length,most_recent:(data||[])[0]?.created_at||null,total_size_mb:0,retention_limit:0} as unknown as T;}
export async function createBackup(label:string):Promise<{job_id:string}>{const payload:Record<string,unknown[]>={};let count=0;for(const table of BACKUP_TABLES){const{data,error}=await supabase.from(table).select("*");if(error)throw new Error(`${table}: ${error.message}`);payload[table]=data||[];count+=(data||[]).length;}const{data,error}=await supabase.from("app_backups").insert({label,payload,row_count:count}).select("id").single();if(error)throw new Error(error.message);return{job_id:data.id};}
export async function restoreBackup(id:string):Promise<{job_id:string}>{const{data,error}=await supabase.from("app_backups").select("payload").eq("id",id).single();if(error)throw new Error(error.message);const payload=data.payload as Record<string,Record<string,unknown>[]>;for(const table of BACKUP_TABLES){const rows=payload[table]||[];if(!rows.length)continue;const{error:e}=await supabase.from(table).upsert(rows);if(e)throw new Error(`${table}: ${e.message}`);}return{job_id:id};}

export const aiProviders = {providers:[{key:"groq",label:"Groq",needs_key:true,default_model:"llama-3.3-70b-versatile"},{key:"ollama",label:"Ollama (local only)",needs_key:false,default_model:"qwen2.5:3b"},{key:"gemini",label:"Google Gemini",needs_key:true,default_model:"gemini-2.0-flash"},{key:"openai",label:"OpenAI",needs_key:true,default_model:"gpt-4o-mini"},{key:"claude",label:"Claude",needs_key:true,default_model:"claude-sonnet-4-6"},{key:"openrouter",label:"OpenRouter",needs_key:true,default_model:"openai/gpt-4o-mini"},{key:"supabase-data",label:"Supabase Data Assistant",needs_key:false,default_model:"deterministic-ops"}]};
export async function getAiConfig<T>():Promise<T>{const{data,error}=await supabase.from("ai_provider_config").select("*").eq("id",SINGLETON).maybeSingle();if(error)throw new Error(error.message);const row=data||{provider:"supabase-data",model:"deterministic-ops",api_key:"",fallback_enabled:false,fallback_chain:[]};return{provider:row.provider,model:row.model,api_key_set:Boolean(row.api_key),fallback_enabled:Boolean(row.fallback_enabled),fallback_chain:Array.isArray(row.fallback_chain)?row.fallback_chain:[]} as unknown as T;}
export async function saveAiConfig(input:Record<string,unknown>){
  const existing=await supabase.from("ai_provider_config").select("api_key,fallback_chain").eq("id",SINGLETON).maybeSingle();
  const key=String(input.api_key||"")||String(existing.data?.api_key||"");
  const oldChain=Array.isArray(existing.data?.fallback_chain)?existing.data.fallback_chain:[];
  const requested=Array.isArray(input.fallback_chain)?input.fallback_chain as Record<string,unknown>[]:[];
  const fallback_chain=requested.map((item,i)=>{
    const old=oldChain[i]||{};
    const sameProvider=String(old.provider||"")===String(item.provider||"");
    return {...item,api_key:String(item.api_key||"")||(sameProvider?String(old.api_key||""):"")};
  });
  const{error}=await supabase.from("ai_provider_config").upsert({id:SINGLETON,provider:String(input.provider||"supabase-data"),model:String(input.model||""),api_key:key,fallback_enabled:Boolean(input.fallback_enabled),fallback_chain,updated_at:new Date().toISOString()});if(error)throw new Error(error.message);}
export async function reindexAi(){const [sap,lm,drivers]=await Promise.all([supabase.from("sap_invoice_facts").select("id",{head:true,count:"exact"}),supabase.from("landmark_visit_facts").select("id",{head:true,count:"exact"}),supabase.from("drivers").select("id",{head:true,count:"exact"})]);return{ok:true,indexed_records:(sap.count||0)+(lm.count||0)+(drivers.count||0),source:"Supabase live tables"};}
export async function chatWithData<T>(message: string, history: Array<{ role: "user" | "assistant"; content: string }> = []): Promise<T> {
  const { data, error } = await supabase.functions.invoke("logi-agent-v2", {
    body: { message, history, current_path: window.location.pathname },
  });
  if (error) throw new Error(error.message || "LOGI could not connect to the cloud agent.");
  return data as T;
}

export async function executeDataAction<T>(action: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke("logi-agent-v2", {
    body: { confirmed_action: action, current_path: window.location.pathname },
  });
  if (error) throw new Error(error.message || "LOGI could not execute the confirmed action.");
  return data as T;
}
