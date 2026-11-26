import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Download, Plus, Search, ShieldCheck, RefreshCw, X, Check, Ban, Star, Users, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx";
import { driversService } from "../services/drivers";
import { helpersService } from "../services/helpers";
import type { Driver, Helper } from "../services/types";
import { createRatingIncident, deleteRatingIncident, getRatingPermissions, listRatingIncidents, resetAllRatings, reviewRatingIncident, type RatingIncident, type RatingPersonType, type RatingSeverity, type RatingStatus } from "../services/rating";

const CATEGORIES = ["Wrong Delivery","Returned Order","Damaged Items","Missing Items","Vehicle Cleanliness","Vehicle Condition","Temperature / Data Logger","Delivery Delay","Customer Complaint","Documentation Error","Safety Violation","Attendance / Punctuality","Unprofessional Behaviour","Failure to Follow Instructions","Others"];
const GRADE = (score: number) => score >= 97 ? "A+" : score >= 93 ? "A" : score >= 90 ? "A-" : score >= 87 ? "B+" : score >= 83 ? "B" : score >= 80 ? "B-" : score >= 77 ? "C+" : score >= 73 ? "C" : score >= 70 ? "C-" : score >= 60 ? "D" : "F";
const localDateTime = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,16); };
type Person = { id: string; code: string; name: string; status?: string };
const personFrom = (p: Driver | Helper): Person => ({ id: p.id, code: String((p as any).code || (p as any).driver_code || (p as any).helper_code || ""), name: String((p as any).name || (p as any).driver_name || (p as any).helper_name || ""), status: p.status });
const statusLabel: Record<RatingStatus,string> = { pending: "Pending approval", approved: "Approved", rejected: "Rejected" };

export default function RatingPage() {
  const sessionToken = sessionStorage.getItem("dispatchops-rating-session") || "";
  const [kind,setKind] = useState<RatingPersonType>("Driver");
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
  const [form,setForm] = useState({personId:"",category:CATEGORIES[0],categoryOther:"",severity:"Low" as RatingSeverity,details:"",occurredAt:localDateTime()});

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

  const filteredPeople = useMemo(()=>people.filter(p=>`${p.name} ${p.code}`.toLowerCase().includes(search.toLowerCase())),[people,search]);
  const approvedFor = (p:Person) => incidents.filter(i=>i.person_type===kind && i.person_id===p.id && i.status==="approved");
  const scoreFor = (p:Person) => Math.max(0,100-approvedFor(p).reduce((s,i)=>s+Number(i.points_deducted||0),0));
  const selected = people.find(p=>p.id===selectedPerson) || null;
  const visibleIncidents = useMemo(()=>incidents.filter(i=>i.person_type===kind && (!selectedPerson || i.person_id===selectedPerson) && (statusFilter==="all" || i.status===statusFilter) && (severityFilter==="all" || i.severity===severityFilter) && (!fromDate || i.occurred_at.slice(0,10)>=fromDate) && (!toDate || i.occurred_at.slice(0,10)<=toDate) && (`${i.person_name} ${i.person_code} ${i.category} ${i.details}`.toLowerCase().includes(search.toLowerCase()))),[incidents,kind,selectedPerson,statusFilter,severityFilter,search,fromDate,toDate]);
  const pendingCount = incidents.filter(i=>i.status==="pending").length;
  const approvedCount = incidents.filter(i=>i.status==="approved").length;

  async function submitIncident(e:FormEvent) {
    e.preventDefault(); if(!form.personId || !form.details.trim()) return;
    setBusy(true); setError("");
    try {
      await createRatingIncident(sessionToken,{personType:kind,personId:form.personId,category:form.category,categoryOther:form.categoryOther,severity:form.severity,details:form.details.trim(),occurredAt:new Date(form.occurredAt).toISOString()});
      setNotice(permissions?.is_supervisor ? "Incident recorded and approved." : "Incident submitted and is waiting for Supervisor approval.");
      setShowForm(false); setForm({personId:"",category:CATEGORIES[0],categoryOther:"",severity:"Low",details:"",occurredAt:localDateTime()}); await reload();
    } catch(e:any) { setError(e.message || "Could not save incident"); }
    finally { setBusy(false); }
  }
  async function decide(id:string,decision:"approved"|"rejected") {
    setBusy(true); setError(""); try { await reviewRatingIncident(sessionToken,id,decision); setNotice(`Incident ${decision}.`); await reload(); }
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
    const allRows=incidents.map(i=>({Type:i.person_type,Name:i.person_name,Code:i.person_code,"Incident Date":new Date(i.occurred_at).toLocaleString(),Category:i.category,"Other Category Detail":i.category_other,Severity:i.severity,"Points Deducted":i.points_deducted,Status:i.status,Details:i.details,"Recorded By":i.created_by_name,"Reviewed By":i.approved_by_name,"Reviewed At":i.approved_at?new Date(i.approved_at).toLocaleString():"","Review Note":i.review_note}));
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(allRows),"All Incidents");
    const buildScores=(type:RatingPersonType,rows:(Driver|Helper)[])=>rows.map(raw=>{const p=personFrom(raw);const approved=incidents.filter(i=>i.person_type===type&&i.person_id===p.id&&i.status==="approved");const score=Math.max(0,100-approved.reduce((sum,i)=>sum+Number(i.points_deducted||0),0));return {Type:type,Name:p.name,Code:p.code,Score:`${score}%`,Grade:GRADE(score),"Approved Incidents":approved.length,"Pending Incidents":incidents.filter(i=>i.person_type===type&&i.person_id===p.id&&i.status==="pending").length};});
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(buildScores("Driver",drivers)),"Driver Ratings");
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(buildScores("Helper",helpers)),"Helper Ratings");
    XLSX.writeFile(wb,`Driver-Helper-Rating-${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  return <div className="page" style={{maxWidth:1500,margin:"0 auto",padding:"22px 24px 48px"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16,flexWrap:"wrap"}}>
      <div><div style={{display:"flex",alignItems:"center",gap:10}}><Star size={25}/><h1 style={{fontSize:26,fontWeight:800,margin:0}}>Driver &amp; Helper Rating</h1></div><p style={{color:"var(--muted)",marginTop:7}}>Incident tracking, supervisor approval and performance scores.</p></div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button className="btn" onClick={()=>void reload()} disabled={loading||busy}><RefreshCw size={15}/> Refresh</button><button className="btn" onClick={exportExcel}><Download size={15}/> Export Excel</button><button className="btn" onClick={()=>{setForm(f=>({...f,personId:selectedPerson||"",occurredAt:localDateTime()}));setPersonSearch(selected?`${selected.code} ${selected.name}`:"");setShowForm(true);}}><Plus size={15}/> Add Incident</button></div>
    </div>
    <div style={{display:"flex",gap:8,margin:"18px 0",padding:5,borderRadius:14,background:"var(--surface-2,rgba(127,127,127,.10))",width:"fit-content"}}>
      {(["Driver","Helper"] as RatingPersonType[]).map(v=><button key={v} className="btn" onClick={()=>{setKind(v);setSelectedPerson("");setSearch("");}} style={{background:kind===v?"var(--primary)":"transparent",color:kind===v?"white":"var(--text)",border:0,minWidth:130}}>{v==="Driver"?"Drivers":"Helpers"}</button>)}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:12,marginBottom:18}}>
      {[{label:`${kind}s in Fleet`,value:people.length,icon:<Users size={18}/>},{label:"Approved Incidents",value:approvedCount,icon:<Check size={18}/>},{label:"Pending Approval",value:pendingCount,icon:<AlertTriangle size={18}/>},{label:"Your Permission",value:permissions?.is_admin?"Admin":permissions?.is_supervisor?"Supervisor":"User",icon:<ShieldCheck size={18}/>}].map(x=><div className="glass-card" key={x.label} style={{padding:16}}><div style={{display:"flex",alignItems:"center",gap:8,color:"var(--muted)",fontSize:12}}>{x.icon}{x.label}</div><div style={{fontSize:25,fontWeight:800,marginTop:7}}>{x.value}</div></div>)}
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
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:12}}><div><strong>Incident Register</strong><div className="muted small">{selected?`${selected.name} · ${selected.code}`:"All people"}</div></div><div style={{display:"flex",gap:7,flexWrap:"wrap"}}><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select><select value={severityFilter} onChange={e=>setSeverityFilter(e.target.value)}><option value="all">All severity</option><option>Low</option><option>Medium</option><option>High</option></select><input aria-label="From date" type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} title="From date"/><input aria-label="To date" type="date" value={toDate} onChange={e=>setToDate(e.target.value)} title="To date"/>{selectedPerson&&<button className="btn" onClick={()=>setSelectedPerson("")}>Show all</button>}</div></div>
        <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:720}}><thead><tr>{["Person","Incident Date","Category / Details","Severity","Points","Status",...(permissions?.is_supervisor?["Review"]:[]),...(permissions?.is_admin?["Delete"]:[])].map(h=><th key={h} style={{textAlign:"left",padding:"10px 8px",borderBottom:"1px solid var(--line)",color:"var(--muted)"}}>{h}</th>)}</tr></thead><tbody>
          {visibleIncidents.map(i=><tr key={i.id}><td style={{padding:9,borderBottom:"1px solid var(--line)"}}><b>{i.person_name}</b><div className="muted small">{i.person_code} · {i.person_type}</div></td><td style={{padding:9,borderBottom:"1px solid var(--line)",whiteSpace:"nowrap"}}>{new Date(i.occurred_at).toLocaleString()}</td><td style={{padding:9,borderBottom:"1px solid var(--line)",maxWidth:280}}><b>{i.category}{i.category==="Others"&&i.category_other?` · ${i.category_other}`:""}</b><div className="muted small" style={{whiteSpace:"pre-wrap"}}>{i.details}</div>{i.review_note&&<div className="muted small">Review: {i.review_note}</div>}</td><td style={{padding:9,borderBottom:"1px solid var(--line)"}}>{i.severity}</td><td style={{padding:9,borderBottom:"1px solid var(--line)"}}>{i.status==="approved"?`-${i.points_deducted}`:"—"}</td><td style={{padding:9,borderBottom:"1px solid var(--line)"}}><span className="badge">{statusLabel[i.status]}</span><div className="muted small">By {i.created_by_name}</div></td>{permissions?.is_supervisor&&<td style={{padding:9,borderBottom:"1px solid var(--line)"}}>{i.status==="pending"?<div style={{display:"flex",gap:5}}><button className="btn" title="Approve" disabled={busy} onClick={()=>void decide(i.id,"approved")}><Check size={14}/></button><button className="btn" title="Reject" disabled={busy} onClick={()=>void decide(i.id,"rejected")}><Ban size={14}/></button></div>:<span className="muted small">{i.approved_by_name||"—"}</span>}</td>}{permissions?.is_admin&&<td style={{padding:9,borderBottom:"1px solid var(--line)"}}><button className="btn" title="Delete incident (Admin only)" disabled={busy} onClick={()=>void removeIncident(i.id)}><X size={14}/></button></td>}</tr>)}
          {!visibleIncidents.length&&<tr><td colSpan={6+(permissions?.is_supervisor?1:0)+(permissions?.is_admin?1:0)} className="muted" style={{padding:24,textAlign:"center"}}>No incidents match these filters.</td></tr>}
        </tbody></table></div>
      </section>
    </div>
    {permissions?.is_admin&&<section className="glass-card" style={{marginTop:16,padding:15,border:"1px solid var(--red)"}}><strong style={{color:"var(--red)"}}>Admin only · Reset Rating History</strong><p className="muted small">Permanently deletes all Rating incidents and returns all scores to 100%. This does not delete or modify Fleet records.</p><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><input type="password" placeholder="Admin password" value={resetPassword} onChange={e=>setResetPassword(e.target.value)} style={{minWidth:240}}/><button className="btn" style={{background:"var(--red)",color:"white"}} disabled={busy||!resetPassword} onClick={()=>void resetAll()}>Reset all ratings</button></div></section>}
    {showForm&&<div style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,.55)",display:"grid",placeItems:"center",padding:16}} onMouseDown={e=>{if(e.target===e.currentTarget)setShowForm(false);}}><form onSubmit={submitIncident} className="glass-card" style={{width:"min(650px,100%)",maxHeight:"90vh",overflowY:"auto",padding:22,background:"var(--surface)"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:15}}><h2 style={{fontSize:21,fontWeight:800}}>Record {kind} Incident</h2><button type="button" onClick={()=>setShowForm(false)}><X/></button></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}><label className="field"><span>Search {kind.toLowerCase()} by code or name</span><input value={personSearch} onChange={e=>setPersonSearch(e.target.value)} placeholder="Type code or name…"/><select required value={form.personId} onChange={e=>{setForm(f=>({...f,personId:e.target.value}));const match=people.find(p=>p.id===e.target.value);if(match)setPersonSearch(`${match.code} ${match.name}`);}}><option value="">Select {kind.toLowerCase()}</option>{people.filter(p=>`${p.code} ${p.name}`.toLowerCase().includes(personSearch.toLowerCase())).map(p=><option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></label><label className="field"><span>Incident date &amp; time</span><input type="datetime-local" required value={form.occurredAt} onChange={e=>setForm(f=>({...f,occurredAt:e.target.value}))}/></label><label className="field"><span>Category</span><select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></label><label className="field"><span>Severity · deduction</span><select value={form.severity} onChange={e=>setForm(f=>({...f,severity:e.target.value as RatingSeverity}))}><option value="Low">Low · 1 point</option><option value="Medium">Medium · 3 points</option><option value="High">High · 5 points</option></select></label>{form.category==="Others"&&<label className="field" style={{gridColumn:"1/-1"}}><span>Other category</span><input value={form.categoryOther} onChange={e=>setForm(f=>({...f,categoryOther:e.target.value}))} placeholder="Enter category"/></label>}<label className="field" style={{gridColumn:"1/-1"}}><span>Incident details</span><textarea required rows={5} value={form.details} onChange={e=>setForm(f=>({...f,details:e.target.value}))} placeholder="Describe exactly what happened, including relevant details…"/></label></div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginTop:16,flexWrap:"wrap"}}><span className="muted small">{permissions?.is_supervisor?"As a Supervisor, your incident will be approved immediately.":"This incident stays pending until a Supervisor approves it."}</span><div style={{display:"flex",gap:8}}><button type="button" className="btn" onClick={()=>setShowForm(false)}>Cancel</button><button className="btn" type="submit" disabled={busy||!form.personId}>{busy?"Saving…":"Submit Incident"}</button></div></div>
    </form></div>}
  </div>;
}
