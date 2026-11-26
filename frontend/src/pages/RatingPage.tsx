import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Download, Plus, Search, ShieldCheck, RefreshCw, X, Check, Ban, Star, Users, AlertTriangle, BarChart3 } from "lucide-react";
import * as XLSX from "xlsx";
import { driversService } from "../services/drivers";
import { helpersService } from "../services/helpers";
import type { Driver, Helper } from "../services/types";
import { createRatingIncident, deleteRatingIncident, getRatingPermissions, listRatingIncidents, resetAllRatings, reviewRatingIncident, type RatingIncident, type RatingPersonType, type RatingSeverity, type RatingStatus, type RatingEntryType } from "../services/rating";
import "./RatingPage.css";

const NEGATIVE_CATEGORIES = ["Wrong Delivery","Returned Order","Damaged Items","Missing Items","Vehicle Cleanliness","Vehicle Condition","Temperature / Data Logger","Delivery Delay","Customer Complaint","Documentation Error","Safety Violation","Attendance / Punctuality","Unprofessional Behaviour","Failure to Follow Instructions","Others"];
const POSITIVE_CATEGORIES = ["Early Arrival","On-Time Arrival","Completed Delivery Without Returns","Complete & Accurate Delivery","Positive Customer Feedback","Excellent Customer Service","Proper Handling of Goods","Temperature Compliance","Accurate Documentation","Excellent Vehicle Cleanliness","Following Instructions","Teamwork & Support","Extra Effort / Initiative","Attendance & Punctuality","Others"];
const ALL_CATEGORIES = [...NEGATIVE_CATEGORIES,...POSITIVE_CATEGORIES.filter(c=>!NEGATIVE_CATEGORIES.includes(c))];
const GRADE = (score: number) => score >= 97 ? "A+" : score >= 93 ? "A" : score >= 90 ? "A-" : score >= 87 ? "B+" : score >= 83 ? "B" : score >= 80 ? "B-" : score >= 77 ? "C+" : score >= 73 ? "C" : score >= 70 ? "C-" : score >= 60 ? "D" : "F";
const localDateTime = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,16); };
type Person = { id: string; code: string; name: string; status?: string };
const personFrom = (p: Driver | Helper): Person => ({ id: p.id, code: String((p as any).code || (p as any).driver_code || (p as any).helper_code || ""), name: String((p as any).name || (p as any).driver_name || (p as any).helper_name || ""), status: p.status });
const statusLabel: Record<RatingStatus,string> = { pending: "Pending approval", approved: "Approved", rejected: "Rejected" };

export default function RatingPage() {
  const sessionToken = sessionStorage.getItem("dispatchops-rating-session") || "";
  const [kind,setKind] = useState<RatingPersonType>("Driver");
  const [pageTab,setPageTab] = useState<"ratings"|"analytics">("ratings");
  const [analyticsMode,setAnalyticsMode] = useState<"category"|"person">("category");
  const [analyticsSearch,setAnalyticsSearch] = useState("");
  const [analyticsSort,setAnalyticsSort] = useState<"count"|"name"|"code">("count");
  const [people,setPeople] = useState<Person[]>([]);
  const [incidents,setIncidents] = useState<RatingIncident[]>([]);
  const [permissions,setPermissions] = useState<{is_admin:boolean;is_supervisor:boolean;username:string}|null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [search,setSearch] = useState("");
  const [selectedPerson,setSelectedPerson] = useState<string>("");
  const [statusFilter,setStatusFilter] = useState("all");
  const [severityFilter,setSeverityFilter] = useState("all");
  const [fromDate,setFromDate] = useState("");
  const [toDate,setToDate] = useState("");
  const [personSearch,setPersonSearch] = useState("");
  const [showForm,setShowForm] = useState(false);
  const [busy,setBusy] = useState(false);
  const [resetPassword,setResetPassword] = useState("");
  const [form,setForm] = useState({personId:"",entryType:"negative" as RatingEntryType,category:NEGATIVE_CATEGORIES[0],categoryOther:"",severity:"Low" as RatingSeverity,details:"",occurredAt:localDateTime()});
  const formCategories = form.entryType === "positive" ? POSITIVE_CATEGORIES : NEGATIVE_CATEGORIES;

  const reload = useCallback(async () => {
    if (!sessionToken) { setError("Your secure Rating session is missing or expired. Please sign out and sign in again."); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const [perm,rows,drivers,helpers] = await Promise.all([getRatingPermissions(sessionToken),listRatingIncidents(sessionToken),driversService.list(),helpersService.list()]);
      setPermissions(perm); setIncidents(rows);
      setPeople((kind === "Driver" ? drivers : helpers).map(personFrom).filter(p => p.name || p.code).sort((a,b)=>a.name.localeCompare(b.name)));
    } catch(e:any) { setError(e.message || "Could not load Rating page"); }
    finally { setLoading(false); }
  },[sessionToken,kind]);
  useEffect(()=>{ void reload(); },[reload]);

  const approvedFor = (p:Person) => incidents.filter(i=>i.person_type===kind && i.person_id===p.id && i.status==="approved");
  const scoreFor = (p:Person) => Math.min(100,Math.max(0,100-approvedFor(p).reduce((s,i)=>s+Number(i.points_deducted||0)-Number(i.points_awarded||0),0)));
  const filteredPeople = useMemo(()=>people
    .filter(p=>`${p.name} ${p.code}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b)=>{
      const scoreA=Math.min(100,Math.max(0,100-incidents.filter(i=>i.person_type===kind&&i.person_id===a.id&&i.status==="approved").reduce((sum,i)=>sum+Number(i.points_deducted||0)-Number(i.points_awarded||0),0)));
      const scoreB=Math.min(100,Math.max(0,100-incidents.filter(i=>i.person_type===kind&&i.person_id===b.id&&i.status==="approved").reduce((sum,i)=>sum+Number(i.points_deducted||0)-Number(i.points_awarded||0),0)));
      return scoreB-scoreA || a.name.localeCompare(b.name);
    }),[people,search,incidents,kind]);
  const selected = people.find(p=>p.id===selectedPerson) || null;
  const visibleIncidents = useMemo(()=>incidents.filter(i=>i.person_type===kind && (!selectedPerson || i.person_id===selectedPerson) && (statusFilter==="all" || i.status===statusFilter) && (severityFilter==="all" || i.severity===severityFilter) && (!fromDate || i.occurred_at.slice(0,10)>=fromDate) && (!toDate || i.occurred_at.slice(0,10)<=toDate) && (`${i.person_name} ${i.person_code} ${i.category} ${i.details}`.toLowerCase().includes(search.toLowerCase()))),[incidents,kind,selectedPerson,statusFilter,severityFilter,search,fromDate,toDate]);
  const pendingCount = incidents.filter(i=>i.status==="pending").length;
  const approvedCount = incidents.filter(i=>i.status==="approved").length;

  // Analytics includes recorded and pending incidents, but excludes rejected records.
  const analyticsIncidents = useMemo(() => incidents.filter(i=>i.person_type===kind && i.status!=="rejected"), [incidents,kind]);
  const analyticsPalette = ["#3978d4","#16a085","#e67e22","#8e63c7","#d94f70","#199bb5","#7b9b35","#bd7bce","#c49a25","#55718d","#dc6b35","#4e9d80"];
  const analyticsRows = useMemo(() => {
    if (analyticsMode === "category") {
      const grouped = new Map<string, {key:string; count:number; people:Map<string,{name:string;code:string;count:number}>}>();
      analyticsIncidents.forEach(i => {
        const category=i.category || "Uncategorised";
        const key=`${i.entry_type || "negative"}::${category}`;
        if(!grouped.has(key)) grouped.set(key,{key,count:0,people:new Map()});
        const row=grouped.get(key)!; row.count++;
        const personKey=i.person_id;
        if(!row.people.has(personKey)) row.people.set(personKey,{name:i.person_name,code:i.person_code,count:0});
        row.people.get(personKey)!.count++;
      });
      return Array.from(grouped.values()).map(row=>{const [entryType,category]=row.key.split("::");return {key:row.key,label:`${category} · ${entryType==="positive"?"Positive points":"Deduction"}`,count:row.count,subLabel:`${row.people.size} ${kind.toLowerCase()}${row.people.size===1?"":"s"}`,segments:Array.from(row.people.entries()).map(([id,v])=>({id,label:v.name,code:v.code,count:v.count,percent:row.count?100*v.count/row.count:0})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label))};});
    }
    const grouped = new Map<string,{key:string;name:string;code:string;count:number;categories:Map<string,number>}>();
    analyticsIncidents.forEach(i=>{
      const key=i.person_id;
      if(!grouped.has(key)) grouped.set(key,{key,name:i.person_name,code:i.person_code,count:0,categories:new Map()});
      const row=grouped.get(key)!; row.count++; const categoryKey=`${i.entry_type || "negative"}::${i.category}`; row.categories.set(categoryKey,(row.categories.get(categoryKey)||0)+1);
    });
    return Array.from(grouped.values()).map(row=>({key:row.key,label:row.name,count:row.count,subLabel:row.code||"No code",segments:Array.from(row.categories.entries()).map(([id,count])=>{const [entryType,category]=id.split("::");return {id,label:`${category} · ${entryType==="positive"?"Positive":"Deduction"}`,code:"",count,percent:row.count?100*count/row.count:0};}).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label))}));
  },[analyticsIncidents,analyticsMode,kind]);
  const filteredAnalyticsRows = useMemo(()=>analyticsRows.filter(row=>`${row.label} ${row.subLabel} ${row.segments.map(x=>x.label).join(" ")}`.toLowerCase().includes(analyticsSearch.toLowerCase())).sort((a,b)=>analyticsSort==="name"?a.label.localeCompare(b.label):(analyticsSort==="code"&&analyticsMode==="person")?a.subLabel.localeCompare(b.subLabel):b.count-a.count||a.label.localeCompare(b.label)),[analyticsRows,analyticsSearch,analyticsSort]);
  const analyticsColor = (id:string,index:number) => {
    if (analyticsMode === "category") {
      // Stable per-person hue so the same driver/helper keeps the same color in every category bar.
      const hash = Array.from(id).reduce((value,char)=>(value*31+char.charCodeAt(0))>>>0,7);
      return `hsl(${hash%360}, 62%, 48%)`;
    }
    const categoryName=id.split("::").pop() || id;
    const categoryIndex=ALL_CATEGORIES.indexOf(categoryName)>=0?ALL_CATEGORIES.indexOf(categoryName):index;
    return `hsl(${(categoryIndex*137.508)%360}, 62%, 48%)`;
  };
  async function exportAnalyticsExcel() {
    const wb=XLSX.utils.book_new();
    const summary=filteredAnalyticsRows.map(row=>({View:analyticsMode==="category"?"Per Category":"Per Person",[analyticsMode==="category"?"Category":"Person"]:row.label,Code:analyticsMode==="person"?row.subLabel:"", "Records":row.count,"Share of selected group":analyticsMode==="category"?"100%":"100%","Top contributor/category":row.segments[0]?.label||"","Top share":row.segments[0]?`${row.segments[0].percent.toFixed(1)}%`:""}));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(summary),analyticsMode==="category"?"Category Summary":"Person Summary");
    const breakdown=filteredAnalyticsRows.flatMap(row=>row.segments.map(seg=>({Group:row.label,ContributorOrCategory:seg.label,Code:seg.code,"Record Count":seg.count,Percentage:`${seg.percent.toFixed(1)}%`})));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(breakdown),"Bar Breakdown");
    const exportedKeys=new Set(filteredAnalyticsRows.map(row=>row.key));
    const exportedCategories=exportedKeys;
    const raw=analyticsIncidents.filter(i=>analyticsMode==="category"?exportedCategories.has(`${i.entry_type || "negative"}::${i.category}`):exportedKeys.has(i.person_id)).map(i=>({Type:i.person_type,Name:i.person_name,Code:i.person_code,"Entry Type":i.entry_type==="positive"?"Positive Points":"Deduction",Category:i.category,"Incident Date":new Date(i.occurred_at).toLocaleString(),Level:i.severity,"Points Deducted":i.points_deducted,"Points Awarded":i.points_awarded,Status:i.status,Details:i.details}));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(raw),"Recorded Rating Records");
    XLSX.writeFile(wb,`Rating-Analytics-${kind}-${new Date().toISOString().slice(0,10)}.xlsx`);
  }


  async function submitIncident(e:FormEvent) {
    e.preventDefault(); if(!form.personId || !form.details.trim()) return;
    setBusy(true); setError("");
    try {
      await createRatingIncident(sessionToken,{personType:kind,personId:form.personId,category:form.category,categoryOther:form.categoryOther,entryType:form.entryType,severity:form.severity,details:form.details.trim(),occurredAt:new Date(form.occurredAt).toISOString()});
      const action= form.entryType==="positive" ? "Positive points" : "Deduction";
      setNotice(permissions?.is_supervisor ? `${action} recorded and approved.` : `${action} submitted and is waiting for Supervisor approval.`);
      setShowForm(false); setForm({personId:"",entryType:"negative",category:NEGATIVE_CATEGORIES[0],categoryOther:"",severity:"Low",details:"",occurredAt:localDateTime()}); await reload();
    } catch(e:any) { setError(e.message || "Could not save incident"); }
    finally { setBusy(false); }
  }
  async function decide(id:string,decision:"approved"|"rejected") {
    setBusy(true); setError(""); try { await reviewRatingIncident(sessionToken,id,decision); setNotice(`Rating record ${decision}.`); await reload(); }
    catch(e:any){setError(e.message||"Could not review incident");} finally{setBusy(false);}
  }
  async function removeIncident(id:string) {
    if(!permissions?.is_admin) return;
    const password = window.prompt("Enter Admin password to permanently delete this incident:");
    if(password === null) return;
    if(!password.trim()) { setError("Admin password is required to delete an incident."); return; }
    setBusy(true); setError("");
    try { await deleteRatingIncident(sessionStorage.getItem("dispatchops-username")||"",password,id); setNotice("Incident deleted."); await reload(); }
    catch(e:any) { setError(e.message||"Could not delete incident"); }
    finally { setBusy(false); }
  }
  async function resetAll() {
    if(!permissions?.is_admin) return;
    if(!resetPassword || !confirm("This permanently deletes ALL Rating incident history and resets every Driver and Helper to 100%. Continue?")) return;
    setBusy(true); setError(""); try { const n=await resetAllRatings(sessionStorage.getItem("dispatchops-username")||"",resetPassword); setResetPassword(""); setNotice(`Rating history reset. ${n} incident records deleted.`); setSelectedPerson(""); await reload(); }
    catch(e:any){setError(e.message||"Reset failed");} finally{setBusy(false);}
  }
  async function exportExcel() {
    const [drivers,helpers] = await Promise.all([driversService.list(),helpersService.list()]);
    const allRows=incidents.map(i=>({Type:i.person_type,Name:i.person_name,Code:i.person_code,"Record Type":i.entry_type==="positive"?"Positive Points":"Deduction","Recorded At":new Date(i.occurred_at).toLocaleString(),Category:i.category,"Other Category Detail":i.category_other,Level:i.severity,"Points Deducted":i.points_deducted,"Points Awarded":i.points_awarded,Status:i.status,Details:i.details,"Recorded By":i.created_by_name,"Reviewed By":i.approved_by_name,"Reviewed At":i.approved_at?new Date(i.approved_at).toLocaleString():"","Review Note":i.review_note}));
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(allRows),"All Rating Records");
    const buildScores=(type:RatingPersonType,rows:(Driver|Helper)[])=>rows.map(raw=>{const p=personFrom(raw);const approved=incidents.filter(i=>i.person_type===type&&i.person_id===p.id&&i.status==="approved");const score=Math.min(100,Math.max(0,100-approved.reduce((sum,i)=>sum+Number(i.points_deducted||0)-Number(i.points_awarded||0),0)));return {Type:type,Name:p.name,Code:p.code,Score:`${score}%`,Grade:GRADE(score),"Approved Records":approved.length,"Points Deducted":approved.reduce((sum,i)=>sum+Number(i.points_deducted||0),0),"Points Awarded":approved.reduce((sum,i)=>sum+Number(i.points_awarded||0),0),"Pending Records":incidents.filter(i=>i.person_type===type&&i.person_id===p.id&&i.status==="pending").length};});
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(buildScores("Driver",drivers)),"Driver Ratings");
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(buildScores("Helper",helpers)),"Helper Ratings");
    XLSX.writeFile(wb,`Driver-Helper-Rating-${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  return <div className="page rating-page" style={{maxWidth:1500,margin:"0 auto",padding:"22px 24px 48px"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16,flexWrap:"wrap"}}>
      <div><div style={{display:"flex",alignItems:"center",gap:10}}><Star size={25}/><h1 style={{fontSize:26,fontWeight:800,margin:0}}>Driver &amp; Helper Rating</h1></div><p style={{color:"var(--muted)",marginTop:7}}>Positive recognition, incident deductions, supervisor approval and performance scores.</p></div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button className="btn" onClick={()=>void reload()} disabled={loading||busy}><RefreshCw size={15}/> Refresh</button>{pageTab==="ratings"&&<button className="btn" onClick={exportExcel}><Download size={15}/> Export Excel</button>}{pageTab==="ratings"&&<button className="btn" onClick={()=>{setForm(f=>({...f,personId:selectedPerson||"",occurredAt:localDateTime()}));setPersonSearch(selected?`${selected.code} ${selected.name}`:"");setShowForm(true);}}><Plus size={15}/> Add Rating Record</button>}</div>
    </div>
    <div className="rating-page-tabs" role="tablist" aria-label="Rating pages">
      <button type="button" role="tab" aria-selected={pageTab==="ratings"} className={`rating-page-tab${pageTab==="ratings"?" active":""}`} onClick={()=>setPageTab("ratings")}><Star size={15}/> Ratings</button>
      <button type="button" role="tab" aria-selected={pageTab==="analytics"} className={`rating-page-tab${pageTab==="analytics"?" active":""}`} onClick={()=>setPageTab("analytics")}><BarChart3 size={15}/> Incident Analytics</button>
    </div>
    {pageTab==="ratings" ? <>
    <div className="rating-type-switch" role="group" aria-label="Choose rating group">
      {(["Driver","Helper"] as RatingPersonType[]).map(v=><button key={v} type="button" aria-pressed={kind===v} className={`rating-type-button${kind===v?" active":""}`} onClick={()=>{setKind(v);setSelectedPerson("");setSearch("");}}>{v==="Driver"?"Drivers":"Helpers"}</button>)}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:12,marginBottom:18}}>
      {[{label:`${kind}s in Fleet`,value:people.length,icon:<Users size={18}/>},{label:"Approved Records",value:approvedCount,icon:<Check size={18}/>},{label:"Pending Approval",value:pendingCount,icon:<AlertTriangle size={18}/>},{label:"Your Permission",value:permissions?.is_admin?"Admin":permissions?.is_supervisor?"Supervisor":"User",icon:<ShieldCheck size={18}/>}].map(x=><div className="glass-card" key={x.label} style={{padding:16}}><div style={{display:"flex",alignItems:"center",gap:8,color:"var(--muted)",fontSize:12}}>{x.icon}{x.label}</div><div style={{fontSize:25,fontWeight:800,marginTop:7}}>{x.value}</div></div>)}
    </div>
    {error&&<div className="glass-card" style={{color:"var(--red)",marginBottom:12}}>{error}</div>}{notice&&<div className="glass-card" style={{color:"var(--green)",marginBottom:12,display:"flex",justifyContent:"space-between"}}>{notice}<button onClick={()=>setNotice("")}><X size={15}/></button></div>}
    <div style={{display:"grid",gridTemplateColumns:"minmax(300px, .9fr) minmax(450px, 1.6fr)",gap:16,alignItems:"start"}}>
      <section className="glass-card" style={{padding:15}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><strong>{kind} Ratings</strong><span className="muted small">Live Fleet list</span></div>
        <div style={{position:"relative",marginBottom:12}}><Search size={15} style={{position:"absolute",left:10,top:11,color:"var(--muted)"}}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name or code..." style={{width:"100%",padding:"9px 10px 9px 32px",borderRadius:9,border:"1px solid var(--line)",background:"var(--surface)"}}/></div>
        <div style={{display:"grid",gap:8,maxHeight:650,overflowY:"auto"}}>
          {loading?<p className="muted">Loading Fleet and Rating data…</p>:filteredPeople.map(p=>{const score=scoreFor(p);const pending=incidents.filter(i=>i.person_type===kind&&i.person_id===p.id&&i.status==="pending").length;return <button key={p.id} onClick={()=>setSelectedPerson(selectedPerson===p.id?"":p.id)} style={{textAlign:"left",padding:12,borderRadius:11,border:`1px solid ${selectedPerson===p.id?"var(--primary)":"var(--line)"}`,background:selectedPerson===p.id?"var(--surface-2)":"transparent",color:"var(--text)"}}><div style={{display:"flex",justifyContent:"space-between",gap:8}}><div><b>{p.name}</b><div className="muted small">{p.code||"No code"}</div></div><div style={{textAlign:"right"}}><b style={{fontSize:19}}>{score}%</b><div className="muted small">Grade {GRADE(score)}</div></div></div><div style={{height:7,background:"var(--line)",borderRadius:9,overflow:"hidden",marginTop:10}}><div style={{height:"100%",width:`${score}%`,background:score>=80?"var(--green)":score>=60?"var(--amber)":"var(--red)"}}/></div><div className="muted small" style={{marginTop:6}}>{approvedFor(p).length} approved · {pending} pending</div></button>})}
          {!loading&&!filteredPeople.length&&<p className="muted">No {kind.toLowerCase()}s found in Fleet Database.</p>}
        </div>
      </section>
      <section className="glass-card" style={{padding:15}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:12}}><div><strong>Rating Activity Register</strong><div className="muted small">{selected?`${selected.name} · ${selected.code}`:"All people"}</div></div><div style={{display:"flex",gap:7,flexWrap:"wrap"}}><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select><select value={severityFilter} onChange={e=>setSeverityFilter(e.target.value)}><option value="all">All severity</option><option>Low</option><option>Medium</option><option>High</option></select><input aria-label="From date" type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} title="From date"/><input aria-label="To date" type="date" value={toDate} onChange={e=>setToDate(e.target.value)} title="To date"/>{selectedPerson&&<button className="btn" onClick={()=>setSelectedPerson("")}>Show all</button>}</div></div>
        <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:720}}><thead><tr>{["Person","Date & Time","Category / Details","Type / Level","Points","Status",...(permissions?.is_supervisor?["Review"]:[]),...(permissions?.is_admin?["Delete"]:[])].map(h=><th key={h} style={{textAlign:"left",padding:"10px 8px",borderBottom:"1px solid var(--line)",color:"var(--muted)"}}>{h}</th>)}</tr></thead><tbody>
          {visibleIncidents.map(i=><tr key={i.id}><td style={{padding:9,borderBottom:"1px solid var(--line)"}}><b>{i.person_name}</b><div className="muted small">{i.person_code} · {i.person_type}</div></td><td style={{padding:9,borderBottom:"1px solid var(--line)",whiteSpace:"nowrap"}}>{new Date(i.occurred_at).toLocaleString()}</td><td style={{padding:9,borderBottom:"1px solid var(--line)",maxWidth:280}}><b>{i.category}{i.category==="Others"&&i.category_other?` · ${i.category_other}`:""}</b><div className="muted small" style={{whiteSpace:"pre-wrap"}}>{i.details}</div>{i.review_note&&<div className="muted small">Review: {i.review_note}</div>}</td><td style={{padding:9,borderBottom:"1px solid var(--line)"}}>{i.entry_type==="positive"?`Positive · ${i.severity}`:`Negative · ${i.severity}`}</td><td style={{padding:9,borderBottom:"1px solid var(--line)",fontWeight:800,color:i.entry_type==="positive"?"var(--green)":"var(--red)"}}>{i.status==="approved"?(i.entry_type==="positive"?`+${i.points_awarded}`:`-${i.points_deducted}`):"—"}</td><td style={{padding:9,borderBottom:"1px solid var(--line)"}}><span className="badge">{statusLabel[i.status]}</span><div className="muted small">By {i.created_by_name}</div></td>{permissions?.is_supervisor&&<td style={{padding:9,borderBottom:"1px solid var(--line)"}}>{i.status==="pending"?<div style={{display:"flex",gap:5}}><button className="btn" title="Approve" disabled={busy} onClick={()=>void decide(i.id,"approved")}><Check size={14}/></button><button className="btn" title="Reject" disabled={busy} onClick={()=>void decide(i.id,"rejected")}><Ban size={14}/></button></div>:<span className="muted small">{i.approved_by_name||"—"}</span>}</td>}{permissions?.is_admin&&<td style={{padding:9,borderBottom:"1px solid var(--line)"}}><button className="btn" title="Delete incident (Admin only)" disabled={busy} onClick={()=>void removeIncident(i.id)}><X size={14}/></button></td>}</tr>)}
          {!visibleIncidents.length&&<tr><td colSpan={6+(permissions?.is_supervisor?1:0)+(permissions?.is_admin?1:0)} className="muted" style={{padding:24,textAlign:"center"}}>No Rating records match these filters.</td></tr>}
        </tbody></table></div>
      </section>
    </div>
    {permissions?.is_admin&&<section className="glass-card" style={{marginTop:16,padding:15,border:"1px solid var(--red)"}}><strong style={{color:"var(--red)"}}>Admin only · Reset Rating History</strong><p className="muted small">Permanently deletes all Rating incidents and returns all scores to 100%. This does not delete or modify Fleet records.</p><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><input type="password" placeholder="Admin password" value={resetPassword} onChange={e=>setResetPassword(e.target.value)} style={{minWidth:240}}/><button className="btn" style={{background:"var(--red)",color:"white"}} disabled={busy||!resetPassword} onClick={()=>void resetAll()}>Reset all ratings</button></div></section>}
    {showForm&&<div style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,.55)",display:"grid",placeItems:"center",padding:16}} onMouseDown={e=>{if(e.target===e.currentTarget)setShowForm(false);}}><form onSubmit={submitIncident} className="glass-card" style={{width:"min(650px,100%)",maxHeight:"90vh",overflowY:"auto",padding:22,background:"var(--surface)"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:15}}><h2 style={{fontSize:21,fontWeight:800}}>{form.entryType==="positive"?`Record Positive Recognition for ${kind}`:`Record ${kind} Incident`}</h2><button type="button" onClick={()=>setShowForm(false)}><X/></button></div>
      <div className="rating-entry-switch" role="group" aria-label="Rating record type" style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}><button type="button" className={`rating-type-button${form.entryType==="negative"?" active":""}`} aria-pressed={form.entryType==="negative"} onClick={()=>setForm(f=>({...f,entryType:"negative",category:NEGATIVE_CATEGORIES[0],categoryOther:""}))}>Deduct Points</button><button type="button" className={`rating-type-button${form.entryType==="positive"?" active":""}`} aria-pressed={form.entryType==="positive"} onClick={()=>setForm(f=>({...f,entryType:"positive",category:POSITIVE_CATEGORIES[0],categoryOther:""}))}>Add Positive Points</button></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}><label className="field"><span>Search {kind.toLowerCase()} by code or name</span><input value={personSearch} onChange={e=>setPersonSearch(e.target.value)} placeholder="Type code or name…"/><select required value={form.personId} onChange={e=>{setForm(f=>({...f,personId:e.target.value}));const match=people.find(p=>p.id===e.target.value);if(match)setPersonSearch(`${match.code} ${match.name}`);}}><option value="">Select {kind.toLowerCase()}</option>{people.filter(p=>`${p.code} ${p.name}`.toLowerCase().includes(personSearch.toLowerCase())).map(p=><option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></label><label className="field"><span>Date &amp; time</span><input type="datetime-local" required value={form.occurredAt} onChange={e=>setForm(f=>({...f,occurredAt:e.target.value}))}/></label><label className="field"><span>{form.entryType==="positive"?"Positive Recognition Category":"Incident Category"}</span><select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{formCategories.map(c=><option key={c}>{c}</option>)}</select></label><label className="field"><span>{form.entryType==="positive"?"Recognition Level · points added":"Severity · points deducted"}</span><select value={form.severity} onChange={e=>setForm(f=>({...f,severity:e.target.value as RatingSeverity}))}><option value="Low">Low · 1 point</option><option value="Medium">Medium · 3 points</option><option value="High">High · 5 points</option></select></label>{form.category==="Others"&&<label className="field" style={{gridColumn:"1/-1"}}><span>Other category</span><input value={form.categoryOther} onChange={e=>setForm(f=>({...f,categoryOther:e.target.value}))} placeholder="Enter category"/></label>}<label className="field" style={{gridColumn:"1/-1"}}><span>{form.entryType==="positive"?"Recognition Details":"Incident Details"}</span><textarea required rows={5} value={form.details} onChange={e=>setForm(f=>({...f,details:e.target.value}))} placeholder={form.entryType==="positive"?"Describe the positive action and supporting details…":"Describe exactly what happened, including relevant details…"}/></label></div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginTop:16,flexWrap:"wrap"}}><span className="muted small">{permissions?.is_supervisor?"As a Supervisor, this record will be approved immediately.":"This record stays pending until a Supervisor approves it."}</span><div style={{display:"flex",gap:8}}><button type="button" className="btn" onClick={()=>setShowForm(false)}>Cancel</button><button className="btn" type="submit" disabled={busy||!form.personId}>{busy?"Saving…":form.entryType==="positive"?"Submit Positive Points":"Submit Deduction"}</button></div></div>
    </form></div>}
    </> : <section className="rating-analytics glass-card">
      <div className="rating-analytics-heading"><div><h2><BarChart3 size={21}/> Rating Analytics</h2><p className="muted small">Positive recognition and deductions are included when pending or approved; rejected records are excluded. Each bar shows the breakdown within that category or person.</p></div><button className="btn" onClick={()=>void exportAnalyticsExcel()} disabled={!analyticsIncidents.length}><Download size={15}/> Export Analytics Excel</button></div>
      <div className="rating-analytics-controls">
        <div className="rating-type-switch" role="group" aria-label="Analytics person type">
          {(["Driver","Helper"] as RatingPersonType[]).map(v=><button key={v} type="button" aria-pressed={kind===v} className={`rating-type-button${kind===v?" active":""}`} onClick={()=>{setKind(v);setAnalyticsSearch("");setSelectedPerson("");setSearch("");}}>{v==="Driver"?"Drivers":"Helpers"}</button>)}
        </div>
        <div className="rating-type-switch" role="group" aria-label="Analytics breakdown">
          <button type="button" aria-pressed={analyticsMode==="category"} className={`rating-type-button${analyticsMode==="category"?" active":""}`} onClick={()=>setAnalyticsMode("category")}>Per Category</button>
          <button type="button" aria-pressed={analyticsMode==="person"} className={`rating-type-button${analyticsMode==="person"?" active":""}`} onClick={()=>setAnalyticsMode("person")}>Per {kind}</button>
        </div>
      </div>
      <div className="rating-analytics-toolbar"><div className="rating-analytics-search"><Search size={15}/><input value={analyticsSearch} onChange={e=>setAnalyticsSearch(e.target.value)} placeholder={analyticsMode==="category"?"Search category or person…":`Search ${kind.toLowerCase()} name or code…`}/></div><select value={analyticsSort} onChange={e=>setAnalyticsSort(e.target.value as "count"|"name"|"code")} aria-label="Sort analytics"><option value="count">Most incidents first</option><option value="name">Name A–Z</option>{analyticsMode==="person"&&<option value="code">Code A–Z</option>}</select><span className="muted small">{filteredAnalyticsRows.length} of {analyticsRows.length} groups · {analyticsIncidents.length} Rating records</span></div>
      {!analyticsIncidents.length?<div className="rating-analytics-empty">No Rating records for {kind.toLowerCase()}s yet. Analytics will appear here when positive points or deductions are added.</div>:!filteredAnalyticsRows.length?<div className="rating-analytics-empty">No results match your search.</div>:<div className="rating-analytics-list">
        {filteredAnalyticsRows.map((row,index)=><article className="rating-analytics-row" key={row.key}>
          <div className="rating-analytics-row-head"><div className="rating-analytics-row-title"><span className="rating-analytics-rank">{index+1}</span><div><strong>{row.label}</strong><div className="muted small">{row.subLabel}</div></div></div><div className="rating-analytics-count"><strong>{row.count}</strong><span className="muted small">records</span></div></div>
          <div className="rating-analytics-bar" role="img" aria-label={`${row.label}: ${row.segments.map(seg=>`${seg.label} ${seg.percent.toFixed(1)} percent`).join(", ")}`}>
            {row.segments.map((seg,segIndex)=><div key={seg.id} className="rating-analytics-segment" style={{width:`${seg.percent}%`,background:analyticsColor(seg.id,segIndex)}} title={`${seg.label}${seg.code?` (${seg.code})`:""}: ${seg.count} incidents · ${seg.percent.toFixed(1)}%`}/>) }
          </div>
          <div className="rating-analytics-legend">{row.segments.map((seg,segIndex)=><span key={seg.id} title={`${seg.label}${seg.code?` (${seg.code})`:""}: ${seg.count} incidents, ${seg.percent.toFixed(1)}%`}><i style={{background:analyticsColor(seg.id,segIndex)}}/><b>{seg.label}</b>{seg.code&&<small>{seg.code}</small>}<em>{seg.percent.toFixed(1)}%</em></span>)}</div>
        </article>)}
      </div>}
    </section>}
  </div>;
}
