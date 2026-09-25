import React, {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import {CalendarDays, Check, CircleAlert, Clock3, LogOut, Package, RefreshCw, Store, Truck, UserRound, X} from 'lucide-react';
import './styles.css';

type Department = 'Pharma'|'Medical'|'Consumer';
type Division = 'Pharma'|'Consumer';
type Status = 'ready'|'handed_over';
type Store = {id:string;name:string;area:string;division?:string;enabled?:boolean;schedule_days?:number[];schedule_dates?:string[]};
type Entry = {id:string;department:Department;division:Division;invoice_no:string;store_id:string;store_name:string;area:string;entry_date:string;target_date:string;pallet_count:number;big_pallet_count:number;small_pallet_count:number;status:Status;created_by:string;created_at:string};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://ptmbtveernkglmubrtdw.supabase.co';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_dX0pnn8--xI_WJtqweaWGA_8yh8ec5U';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const USERS: Record<string,{password:string;department:Department;division:Division;label:string}> = {
  pharma:{password:'0000',department:'Pharma',division:'Pharma',label:'Pharma'},
  medical:{password:'0000',department:'Medical',division:'Pharma',label:'Medical'},
  consumer:{password:'0000',department:'Consumer',division:'Consumer',label:'Consumer'},
};

function dubaiNow(){ return new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Dubai'})); }
function isoDate(d:Date){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function tomorrow(){ const d=dubaiNow(); d.setDate(d.getDate()+1); return isoDate(d); }
function monthKey(date:string){ return `${date.slice(0,7)}-01`; }
function dayOf(date:string){ return new Date(`${date}T12:00:00`).getDay(); }
function dayLabel(date:string){ return new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'2-digit',month:'short',year:'numeric'}).format(new Date(`${date}T12:00:00`)); }
function isAfterCutoff(){ const d=dubaiNow(); return d.getHours()>16 || (d.getHours()===16 && d.getMinutes()>=30); }

function Login({onLogin}:{onLogin:(username:string,account:typeof USERS[string])=>void}){
 const [username,setUsername]=useState(''); const [password,setPassword]=useState(''); const [error,setError]=useState('');
 function submit(e:React.FormEvent){e.preventDefault();const key=username.trim().toLowerCase();const account=USERS[key];if(!account||account.password!==password){setError('Invalid username or password.');return;} sessionStorage.setItem('dept-entry-user',key);onLogin(key,account);}
 return <main className="login-shell"><section className="glass login-card"><div className="brand"><img src="/app-icon.png"/><div><b>DISPATCH OPS</b><span>Department Dispatch Entry</span></div></div><div className="login-title">Department sign in</div><p className="muted">Enter your department credentials to submit tomorrow’s dispatch preparation.</p><form onSubmit={submit} className="form-stack"><label>Username<input value={username} onChange={e=>setUsername(e.target.value)} placeholder="Pharma / Medical / Consumer" autoFocus/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password"/></label>{error&&<div className="error"><CircleAlert size={15}/>{error}</div>}<button className="primary" type="submit">Sign in</button></form><div className="login-hint"><span>Pharma</span><span>Medical</span><span>Consumer</span></div></section></main>
}

function App(){
 const [user,setUser]=useState<string|null>(sessionStorage.getItem('dept-entry-user'));
 const account=user?USERS[user]:null;
 if(!user||!account) return <Login onLogin={(u)=>setUser(u)}/>;
 return <DepartmentPage username={user} account={account} onLogout={()=>{sessionStorage.removeItem('dept-entry-user');setUser(null)}}/>;
}

function DepartmentPage({username,account,onLogout}:{username:string;account:typeof USERS[string];onLogout:()=>void}){
 const [stores,setStores]=useState<Store[]>([]); const [entries,setEntries]=useState<Entry[]>([]); const [targetDate,setTargetDate]=useState(tomorrow());
 const [invoice,setInvoice]=useState(''); const [storeId,setStoreId]=useState(''); const [big,setBig]=useState(1); const [small,setSmall]=useState(0); const [status,setStatus]=useState<Status>('ready');
 const [loading,setLoading]=useState(true); const [saving,setSaving]=useState(false); const [error,setError]=useState(''); const [ok,setOk]=useState(''); const [now,setNow]=useState(dubaiNow());
 const locked = now.getHours()>16 || (now.getHours()===16 && now.getMinutes()>=30);
 const total=big+small; const targetDow=dayOf(targetDate);
 useEffect(()=>{const t=window.setInterval(()=>setNow(dubaiNow()),30000);return()=>clearInterval(t)},[]);
 const availableStores=useMemo(()=>stores.filter(s=>s.enabled!==false && String(s.division||account.division).toLowerCase()===account.division.toLowerCase() && ((!s.schedule_dates?.length&&!s.schedule_days?.length)||s.schedule_dates?.includes(targetDate)||s.schedule_days?.includes(targetDow))),[stores,targetDate,targetDow,account.division]);
 const selectedStore=availableStores.find(s=>s.id===storeId);
 const load=async()=>{
   setLoading(true);setError('');
   try{
    const [defaultsRes,planRes,entriesRes]=await Promise.all([
      supabase.from('bulk_organizer_month_defaults').select('buildings').eq('month_key',monthKey(targetDate)).maybeSingle(),
      supabase.from('bulk_organizer_plans').select('buildings').eq('plan_date',targetDate).maybeSingle(),
      supabase.from('department_dispatch_entries').select('*').eq('target_date',targetDate).eq('division',account.division).order('created_at',{ascending:false})
    ]);
    if(defaultsRes.error)throw defaultsRes.error;if(planRes.error)throw planRes.error;if(entriesRes.error)throw entriesRes.error;
    const raw=[...((defaultsRes.data?.buildings||[]) as any[]),...((planRes.data?.buildings||[]) as any[])];
    const map=new Map<string,Store>();raw.forEach(b=>{if(b?.id&&b?.name)map.set(String(b.id),{id:String(b.id),name:String(b.name),area:String(b.area||''),division:b.division,enabled:b.enabled!==false,schedule_days:b.schedule_days||[],schedule_dates:b.schedule_dates||[]})});
    setStores(Array.from(map.values()));setEntries((entriesRes.data||[]) as Entry[]);
   }catch(e:any){setError(e?.message||'Could not load the shared dispatch data.');}finally{setLoading(false)}
 };
 useEffect(()=>{void load()},[targetDate,account.division]);
 useEffect(()=>{const channel=supabase.channel(`department-entry-${account.division}-${targetDate}`).on('postgres_changes',{event:'*',schema:'public',table:'department_dispatch_entries',filter:`target_date=eq.${targetDate}`},()=>void load()).subscribe();return()=>{void supabase.removeChannel(channel)}},[targetDate,account.division]);
 const submit=async(e:React.FormEvent)=>{
  e.preventDefault();setError('');setOk('');
  if(locked){setError('Entry is closed after 16:30 Dubai time.');return;}
  if(!invoice.trim()||!storeId){setError('Invoice number and store are required.');return;}
  if(total<1){setError('Enter at least one pallet.');return;}
  if(new Date(`${targetDate}T12:00:00`)<=new Date(`${isoDate(dubaiNow())}T12:00:00`)){setError('Target date must be tomorrow or later.');return;}
  setSaving(true);
  const payload={department:account.department,division:account.division,invoice_no:invoice.trim(),store_id:storeId,store_name:selectedStore?.name||'',area:selectedStore?.area||'',target_date:targetDate,pallet_count:total,big_pallet_count:big,small_pallet_count:small,status,created_by:username};
  const {data,error}=await supabase.from('department_dispatch_entries').insert(payload).select('*').single();
  if(error)setError(error.message);else{setEntries(x=>[data as Entry,...x]);setInvoice('');setBig(1);setSmall(0);setStatus('ready');setOk(`${invoice.trim()} added for ${dayLabel(targetDate)}.`)}
  setSaving(false);
 };
 const toggleStatus=async(entry:Entry)=>{
  if(locked){setError('Entry changes are closed after 16:30 Dubai time.');return;}
  const next:Status=entry.status==='ready'?'handed_over':'ready';const {error}=await supabase.from('department_dispatch_entries').update({status:next}).eq('id',entry.id);if(error)setError(error.message);else setEntries(x=>x.map(e=>e.id===entry.id?{...e,status:next}:e));
 };
 return <div className="app-shell">
  <header className="topbar glass"><div className="brand"><img src="/app-icon.png"/><div><b>DISPATCH OPS</b><span>Department Dispatch Entry</span></div></div><div className="header-right"><div className="dept-badge"><UserRound size={14}/>{account.label}{account.department==='Medical'&&<small>→ Pharma</small>}</div><button className="ghost" onClick={onLogout}><LogOut size={15}/> Sign out</button></div></header>
  <main className="content">
   <section className="hero glass"><div><span className="eyebrow"><Truck size={14}/> {account.department.toUpperCase()} PREPARATION</span><h1>{account.department} dispatch preparation</h1><p>Enter the invoices that will be prepared for the next dispatch day. The same entry will appear automatically in the Bulk Organizer.</p></div><div className={`cutoff ${locked?'closed':''}`}><Clock3 size={17}/><div><b>{locked?'ENTRY CLOSED':'ENTRY OPEN'}</b><span>Daily cutoff 16:30 · Dubai</span></div></div></section>
   {error&&<div className="banner error"><CircleAlert size={16}/><span>{error}</span><button onClick={()=>setError('')}><X size={14}/></button></div>}{ok&&<div className="banner success"><Check size={16}/><span>{ok}</span><button onClick={()=>setOk('')}><X size={14}/></button></div>}
   <div className="grid">
    <section className="glass panel"><div className="panel-head"><div><span className="section-kicker">01 · NEW ENTRY</span><h2>Prepare an invoice</h2></div><button className="ghost" onClick={()=>void load()}><RefreshCw size={14}/> Refresh</button></div>
     {locked&&<div className="locked-note"><Clock3 size={16}/><div><b>Entry window is closed.</b><span>You can still view what was submitted, but no new data or status changes can be saved after 16:30 Dubai time.</span></div></div>}
     <form onSubmit={submit} className="entry-form">
      <label>Invoice number<input value={invoice} disabled={locked} onChange={e=>setInvoice(e.target.value)} placeholder="Invoice no."/></label>
      <label>Target dispatch date<input type="date" min={tomorrow()} value={targetDate} disabled={locked} onChange={e=>{setTargetDate(e.target.value);setStoreId('')}}/><small>{dayLabel(targetDate)}</small></label>
      <label className="wide">Store / destination<select value={storeId} disabled={locked||loading} onChange={e=>setStoreId(e.target.value)}><option value="">Select available store</option>{availableStores.map(s=><option key={s.id} value={s.id}>{s.name}{s.area?` · ${s.area}`:''}</option>)}</select><small>{availableStores.length} store(s) available for this date</small></label>
      <div className="pallet-box wide"><div><span>Palette / pallet size</span><small>Set how many large and small pallets this invoice needs.</small></div><div className="pallet-controls"><label><Package size={15}/> Big pallet<input type="number" min="0" value={big} disabled={locked} onChange={e=>setBig(Math.max(0,Number(e.target.value||0)))}/></label><label><Package size={15}/> Small pallet<input type="number" min="0" value={small} disabled={locked} onChange={e=>setSmall(Math.max(0,Number(e.target.value||0)))}/></label><div className="total-pill"><b>{total}</b><span>Total</span></div></div></div>
      <label>Status<select value={status} disabled={locked} onChange={e=>setStatus(e.target.value as Status)}><option value="ready">Ready</option><option value="handed_over">Handed over to Dispatch</option></select></label>
      <div className="submit-row"><button className="primary" disabled={saving||locked} type="submit">{saving?<><RefreshCw className="spin" size={15}/> Saving…</>:<><Check size={15}/> Add to dispatch queue</>}</button><div className="target-summary"><CalendarDays size={15}/><span>Will be scheduled for <b>{dayLabel(targetDate)}</b></span></div></div>
     </form>
    </section>
    <aside className="glass panel queue"><div className="panel-head"><div><span className="section-kicker">02 · SHARED QUEUE</span><h2>{dayLabel(targetDate)}</h2></div><div className="count">{entries.length}</div></div><div className="queue-list">{loading?<div className="empty"><RefreshCw className="spin" size={20}/>Loading…</div>:entries.length?entries.map(e=><div className="entry-card" key={e.id}><div className="entry-top"><b>{e.invoice_no}</b><span className={e.status==='handed_over'?'handed':'ready'}>{e.status==='handed_over'?'HANDED OVER':'READY'}</span></div><div className="entry-store"><Store size={14}/><span>{e.store_name}</span></div><div className="entry-meta"><span>{e.department}</span><span>{e.big_pallet_count} big</span><span>{e.small_pallet_count} small</span><span>{e.pallet_count} total</span></div><button className="status-btn" disabled={locked} onClick={()=>void toggleStatus(e)}>{e.status==='ready'?'Mark handed over':'Return to ready'}</button></div>):<div className="empty"><Package size={24}/><b>No entries yet</b><span>New department entries will appear here and in Bulk Organizer.</span></div>}</div></aside>
   </div>
   <footer className="footer-note"><span>Shared database: DispatchOPS Supabase</span><span>•</span><span>Pharma + Medical feed the Pharma planner · Consumer feeds the Consumer planner</span></footer>
  </main>
 </div>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
