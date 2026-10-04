import { useEffect, useMemo, useState } from "react";
import { getRole } from "../api/client";
import { getExperienceDetailPage, getExperienceSuggestions, getExperienceSummary, getCachedExperienceSummary, primeExperienceSummaryCache, refreshExperienceSummary, prefetchExperienceDetail } from "../services/operational";
import { processExperienceExport, importExperienceDataExport, exportExperienceData, resetExperiencePeriod, resetAllExperienceData, type ImportProgress } from "../services/importEngine";
import DetailWindow from "../components/DetailWindow";

interface Summary { person_code:string; person_name:string; person_type:string; distinct_areas:number; total_days:number; consumer_orders:number; pharma_orders:number; vehicle_types:string; experience:string; most_recent_area:string; most_recent_end:string; }
interface Suggestion { label:string; value:string; kind:string }
type Division = "Pharma" | "Consumer";
type DetailRow = Record<string, any>;

const DETAIL_PAGE_SIZE = 100;

// Start warming both Experience divisions as soon as this page module is loaded.
// Control Center imports this page before the user opens the tab, so the data can
// arrive in the background instead of blocking the tab transition.
if (typeof window !== "undefined") primeExperienceSummaryCache();

export default function Experience() {
  const [division,setDivision]=useState<Division>("Pharma");
  const [summary,setSummary]=useState<Summary[]>(()=>getCachedExperienceSummary<Summary>("Pharma")); const [summaryLoading,setSummaryLoading]=useState(()=>getCachedExperienceSummary<Summary>("Pharma").length===0);
  const [detail,setDetail]=useState<DetailRow[]>([]); const [detailRaw,setDetailRaw]=useState<DetailRow[]>([]);
  const [detailOffset,setDetailOffset]=useState(0); const [detailHasMore,setDetailHasMore]=useState(false); const [detailLoadingMore,setDetailLoadingMore]=useState(false);
  const [selected,setSelected]=useState<{code:string;type:string;name:string}|null>(null); const [detailLoading,setDetailLoading]=useState(false);
  const [typeFilter,setTypeFilter]=useState(""); const [search,setSearch]=useState(""); const [suggestions,setSuggestions]=useState<Suggestion[]>([]); const [showSuggestions,setShowSuggestions]=useState(false);
  const [error,setError]=useState(""); const [uploadProgress,setUploadProgress]=useState<ImportProgress|null>(null); const [exporting,setExporting]=useState(false);
  const isAdmin = getRole() === "admin"; const [uploading,setUploading]=useState(false); const [uploadMode,setUploadMode]=useState<"sap"|"backup">("sap");

  async function loadSummary(nextDivision:Division=division, forceRefresh=false){
    setError("");
    const cached=getCachedExperienceSummary<Summary>(nextDivision);
    if(!forceRefresh && cached.length){
      setSummary(cached);
      setSummaryLoading(false);
      void refreshExperienceSummary(nextDivision).then(rows=>{setSummary(rows as Summary[]);}).catch(()=>{});
      return;
    }
    setSummaryLoading(true);
    try { setSummary(await getExperienceSummary<Summary>(nextDivision,{forceRefresh})); }
    catch(e:any) { setError(e?.message||String(e)); }
    finally { setSummaryLoading(false); }
  }

  useEffect(()=>{void loadSummary("Pharma")},[]);
  useEffect(()=>{if(!search.trim()){setSuggestions([]);return}const h=setTimeout(()=>getExperienceSuggestions<Suggestion>(search).then(setSuggestions).catch(()=>{}),150);return()=>clearTimeout(h)},[search]);

  async function changeDivision(next:Division){
    if(next===division)return;
    setDivision(next); setSelected(null); setDetail([]); setDetailRaw([]); setDetailOffset(0); setDetailHasMore(false);
    await loadSummary(next);
  }

  async function handleDownload(){setExporting(true);setError("");setUploadProgress(null);try{await exportExperienceData(p=>setUploadProgress(p))}catch(e:any){setError(e?.message||String(e))}finally{setExporting(false)}}
  async function handleUpload(file:File|undefined){if(!isAdmin||!file)return;setUploading(true);setError("");setUploadProgress(null);try{if(uploadMode==="sap") await processExperienceExport(file,p=>setUploadProgress(p)); else await importExperienceDataExport(file,p=>setUploadProgress(p)); await loadSummary(division,true)}catch(e:any){setError(e?.message||String(e))}finally{setUploading(false)}}
  async function handleReset(){if(!isAdmin)return;const key=window.prompt("Enter month YYYY-MM, or ALL to erase all experience:","ALL");if(key===null)return;try{setUploading(true);if(key.trim().toUpperCase()==="ALL") await resetAllExperienceData(); else { const m=/^(\d{4})-(\d{2})$/.exec(key.trim()); if(!m) throw new Error("Enter month as YYYY-MM or ALL."); await resetExperiencePeriod(Number(m[1]), Number(m[2])); } await loadSummary(division,true)}catch(e:any){setError(e?.message||String(e))}finally{setUploading(false)}}

  function shapeDetailRows(rows:DetailRow[]):DetailRow[]{
    const daily:any[]=rows.map(d=>({...d,date:String(d.date||d.end_date||""),area:String(d.area_name||d.area||"UNKNOWN"),area_code:String(d.experienced_area_code||d.area_code||"UNKNOWN"),route_type:String(d.route_type||""),experience_division:String(d.experience_division||d.experience_type||d.sector||division),vehicle_type:String(d.vehicle_type||"UNKNOWN"),vehicle_number:String(d.vehicle_number||"")})).sort((a,b)=>a.date.localeCompare(b.date));
    const runs:any[]=[]; const dayMs=86400000;
    for(const d of daily){
      const last=runs[runs.length-1];
      const consecutive=last&&last.area_code===d.area_code&&last.experience_division===d.experience_division&&last.vehicle_type===d.vehicle_type&&(new Date(`${d.date}T00:00:00`).getTime()-new Date(`${last.end_date}T00:00:00`).getTime())===dayMs;
      if(consecutive){last.end_date=d.date;last.days++;last.order_count+=Number(d.order_count||0);last.consumer_orders+=Number(d.consumer_orders||0);last.pharma_orders+=Number(d.pharma_orders||0);if(d.vehicle_number&&!last.vehicles.includes(d.vehicle_number))last.vehicles.push(d.vehicle_number)}
      else runs.push({area:d.area,area_code:d.area_code,route_type:d.route_type,experience_division:d.experience_division,vehicle_type:d.vehicle_type,start_date:d.date,end_date:d.date,days:1,order_count:Number(d.order_count||0),consumer_orders:Number(d.consumer_orders||0),pharma_orders:Number(d.pharma_orders||0),vehicles:d.vehicle_number?[d.vehicle_number]:[]});
    }
    return runs.reverse().map(r=>({...r,vehicle:r.vehicles.join(", ")||"—",date_range:r.start_date===r.end_date?r.start_date:`${r.start_date} → ${r.end_date}`}));
  }

  async function openDetail(code:string,type:string,name:string){
    setSelected({code,type,name}); setDetail([]); setDetailRaw([]); setDetailOffset(0); setDetailHasMore(false); setDetailLoading(true); setError("");
    try{
      const page=await getExperienceDetailPage<DetailRow>(code,type,division,0,DETAIL_PAGE_SIZE);
      setDetailRaw(page.rows); setDetail(shapeDetailRows(page.rows)); setDetailOffset(page.rows.length); setDetailHasMore(page.hasMore);
    }catch(e:any){setError(e?.message||String(e));}
    finally{setDetailLoading(false)}
  }

  async function loadMoreDetail(){
    if(!selected||detailLoadingMore||!detailHasMore)return;
    setDetailLoadingMore(true);
    try{
      const page=await getExperienceDetailPage<DetailRow>(selected.code,selected.type,division,detailOffset,DETAIL_PAGE_SIZE);
      const merged=[...detailRaw,...page.rows]; setDetailRaw(merged); setDetail(shapeDetailRows(merged)); setDetailOffset(merged.length); setDetailHasMore(page.hasMore);
    }catch(e:any){setError(e?.message||String(e));}
    finally{setDetailLoadingMore(false)}
  }

  const q=search.trim().toLowerCase();
  const filtered=useMemo(()=>summary.filter(s=>!typeFilter||s.person_type===typeFilter).filter(s=>!q||s.person_code.toLowerCase().includes(q)||s.person_name.toLowerCase().includes(q)||s.most_recent_area.toLowerCase().includes(q)||s.experience.toLowerCase().includes(q)||s.vehicle_types.toLowerCase().includes(q)),[summary,typeFilter,q]);

  return <div className="page">
    <h2>Experience</h2><p style={{color:"var(--muted)",fontSize:13,marginTop:-8}}>Exact daily experience for Drivers and Helpers. Consumer/Pharma is decided per person per day from the existing Dashboard Configuration. Vehicle type comes from the Vehicles master with smart number normalization.</p>
    <div className="glass-card" style={{marginBottom:20}}><div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}><div style={{flex:1,minWidth:300}}><strong>Experience Data</strong><div style={{color:"var(--muted)",fontSize:12,marginTop:4}}>{isAdmin?"Admin can upload/import and reset Experience; users can only view and download the current Excel data.":"Users can view the dashboard experience and download the current Excel data; Excel upload/import is disabled."}</div></div><button className="btn" disabled={exporting||uploading} onClick={()=>void handleDownload()}>{exporting?"Exporting…":"Download Experience Data"}</button>{isAdmin&&<button className="btn" style={{background:"var(--red)"}} disabled={exporting||uploading} onClick={()=>void handleReset()}>Reset Experience</button>}</div>{isAdmin&&<div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginTop:12}}><select value={uploadMode} disabled={uploading} onChange={e=>setUploadMode(e.target.value as "sap"|"backup")}><option value="sap">Upload SAP Experience Source</option><option value="backup">Import Downloaded Experience Data</option></select><input type="file" accept=".xlsx,.xls,.csv" disabled={uploading||exporting} onChange={e=>{const f=e.target.files?.[0];void handleUpload(f);e.currentTarget.value=""}}/>{uploading&&<span className="badge ok">{uploadProgress?.progress_pct??0}%</span>}</div>}</div>
    {uploadProgress&&(exporting||uploadProgress.status!=="processing")&&<div className="glass-card" style={{marginBottom:20}}><strong>{uploadProgress.current_step}</strong><div style={{background:"var(--navy3)",borderRadius:999,height:7,marginTop:8,overflow:"hidden"}}><div style={{width:`${uploadProgress.progress_pct}%`,background:"var(--teal)",height:"100%"}}/></div><div style={{fontSize:11,color:"var(--muted)",marginTop:6}}>{uploadProgress.log||`${uploadProgress.processed_units}/${uploadProgress.total_units}`}</div></div>}
    <div className="glass-card" style={{marginBottom:20,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",position:"relative"}}>
      <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="">All (Drivers &amp; Helpers)</option><option value="Driver">Drivers only</option><option value="Helper">Helpers only</option></select>
      <div style={{position:"relative",flex:1,minWidth:260}}><input placeholder="Search Driver/Helper, Area, Area Code, Vehicle, Vehicle Type, Consumer or Pharma…" value={search} onChange={e=>{setSearch(e.target.value);setShowSuggestions(true)}} onFocus={()=>setShowSuggestions(true)} onBlur={()=>setTimeout(()=>setShowSuggestions(false),150)} style={{width:"100%"}}/>{showSuggestions&&suggestions.length>0&&<div className="glass-card" style={{position:"absolute",zIndex:9999,marginTop:4,padding:4,width:"100%",maxHeight:260,overflowY:"auto"}}>{suggestions.map((s,i)=><div key={`${s.kind}-${s.value}-${i}`} onMouseDown={()=>{setSearch(s.value);setShowSuggestions(false)}} style={{padding:"6px 8px",cursor:"pointer",fontSize:13}}>{s.label}</div>)}</div>}</div>
      <div style={{display:"inline-flex",padding:3,borderRadius:10,background:"var(--navy3)",gap:3,flexShrink:0}} role="tablist" aria-label="Experience division">
        {(["Pharma","Consumer"] as Division[]).map(d=><button key={d} type="button" className="btn" onClick={()=>void changeDivision(d)} style={{padding:"7px 14px",minWidth:92,background:division===d?"var(--teal)":"transparent",color:division===d?"white":"var(--muted)"}}>{d}</button>)}
      </div>
    </div>
    {error&&<div className="glass-card error-text" style={{marginBottom:20}}>{error}</div>}
    <div className="glass-card table-scroll"><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}><strong>Experience Summary — {division}</strong>{summaryLoading&&<span style={{fontSize:12,color:"var(--muted)"}}>Loading…</span>}</div><table className="data-table" style={{marginTop:10}}><thead><tr><th>Name</th><th>Type</th><th>Experience</th><th>Consumer / Pharma Orders</th><th>Vehicle Types</th><th>Areas</th><th>Days</th><th>Most Recent Area</th><th>Last Worked</th></tr></thead><tbody>{!summaryLoading&&filtered.length===0&&<tr><td colSpan={9} style={{color:"var(--muted)",textAlign:"center",padding:20}}>No experience history yet.</td></tr>}{filtered.map(s=><tr key={`${s.person_type}-${s.person_code}`} onMouseEnter={()=>{void prefetchExperienceDetail(s.person_code,s.person_type,division).catch(()=>{})}} onClick={()=>openDetail(s.person_code,s.person_type,s.person_name)} style={{cursor:"pointer"}}><td><strong>{s.person_name}</strong> <span style={{color:"var(--muted)",fontSize:11}}>({s.person_code})</span></td><td>{s.person_type}</td><td><span className="badge" style={{background:s.experience==="Consumer"?"var(--blue-soft, rgba(59,130,246,.18))":"var(--purple-soft, rgba(168,85,247,.18))"}}>{s.experience}</span></td><td>{s.consumer_orders} Consumer / {s.pharma_orders} Pharma</td><td>{s.vehicle_types||"UNKNOWN"}</td><td>{s.distinct_areas}</td><td>{s.total_days}</td><td>{s.most_recent_area}</td><td>{s.most_recent_end}</td></tr>)}</tbody></table></div>
    {selected&&<DetailWindow key={`${division}|${selected.type}|${selected.code}`} title={`Exact ${division} Experience History — ${selected.name} (${selected.code})`} loading={detailLoading} loadingMore={detailLoadingMore} truncated={detailHasMore} totalMatching={detailHasMore?undefined:detail.length} onLoadMore={()=>void loadMoreDetail()} columns={[{key:"area_code",label:"Area Code"},{key:"area",label:"Area"},{key:"route_type",label:"Route Type"},{key:"experience_division",label:"Experience"},{key:"vehicle_type",label:"Vehicle Type"},{key:"vehicle",label:"Vehicle(s)"},{key:"date_range",label:"Exact Dates"},{key:"days",label:"Consecutive Days"},{key:"order_count",label:"Orders"},{key:"consumer_orders",label:"Consumer Orders"},{key:"pharma_orders",label:"Pharma Orders"}]} rows={detail} onClose={()=>setSelected(null)}/>} 
  </div>
}
