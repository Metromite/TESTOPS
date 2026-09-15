import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CarFront, Check, ChevronLeft, ChevronRight, Database, GripVertical, PackageOpen, RefreshCw, Save, Search, ShieldCheck, Truck, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { GlassButton } from "../design-system/GlassButton";
import { GlassCard } from "../design-system/GlassCard";
import { GlassInput } from "../design-system/GlassInput";
import { loadBulkOrganizerPlan, saveBulkOrganizerPlan, type BulkOrganizerPlan } from "../services/bulkOrganizer";

const CAPACITY_DEFAULTS: Record<string, number> = { VAN: 20, "PICK-UP": 10, PICKUP: 10, "PICK UP": 10 };
const norm = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
const isPickup = (v: unknown) => norm(v).includes("PICK UP") || norm(v).includes("PICKUP");
const isVan = (v: unknown) => norm(v).includes("VAN");
const dateKey = (d: Date) => d.toISOString().slice(0, 10);

function defaultCapacity(type: string) {
  const n = norm(type);
  if (CAPACITY_DEFAULTS[n] != null) return CAPACITY_DEFAULTS[n];
  if (isPickup(n)) return 10;
  if (isVan(n)) return 20;
  return 10;
}

function divisionFor(row: any) {
  const d = norm(row.division_desc);
  if (d.includes("PHARMA")) return "Pharma";
  if (d.includes("CONSUMER")) return "Consumer";
  return d ? String(row.division_desc) : "Unknown";
}

function formatPallets(n: number) { return `${n} pallet${n === 1 ? "" : "s"}`; }

export default function BulkOrganizer() {
  const [date, setDate] = useState(dateKey(new Date()));
  const [fleet, setFleet] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [facts, setFacts] = useState<any[]>([]);
  const [plan, setPlan] = useState<BulkOrganizerPlan>({ plan_date: date, vehicles: [], pallets: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [dragged, setDragged] = useState<string | null>(null);
  const [showFleet, setShowFleet] = useState(false);

  async function loadSourceData(selectedDate: string) {
    setLoading(true); setError("");
    try {
      const [v, a, p, f, saved] = await Promise.all([
        supabase.from("vehicles").select("id,number,type,division,status").order("number"),
        supabase.from("areas").select("id,code,name,sector,region,route_type,vehicle_type").order("code"),
        supabase.from("vehicle_permitted_areas").select("vehicle_id,area_id"),
        supabase.from("sap_invoice_facts").select("id,invoice_no,invoice_date,dispatch_date,customer_name,area,boxes,division_desc,vehicle_num,vehicle_type,salesman").or(`dispatch_date.eq.${selectedDate},invoice_date.eq.${selectedDate}`).order("customer_name"),
        loadBulkOrganizerPlan(selectedDate),
      ]);
      if (v.error) throw v.error; if (a.error) throw a.error; if (f.error) throw f.error;
      const active = (v.data ?? []).filter((x:any) => String(x.status ?? "Active").toLowerCase() !== "under service");
      setFleet(active);
      setAreas(a.data ?? []);
      setPermissions(p.data ?? []);
      setFacts(f.data ?? []);
      const defaults = active.filter((x:any) => isVan(x.type) || isPickup(x.type)).map((x:any) => ({ vehicle_id: x.id, capacity: defaultCapacity(x.type) }));
      const sourcePallets = (f.data ?? []).map((r:any, i:number) => ({ id: `${r.invoice_no || r.id || i}`, invoice_no: r.invoice_no || `INV-${i+1}`, customer_name: r.customer_name || "Unknown customer", area: r.area || "", division: divisionFor(r), pallets: Math.max(1, Number(r.boxes || 0)), invoice_date: r.invoice_date || null, scheduled_date: selectedDate, vehicle_id: null }));
      if (saved) {
        const savedByInvoice = new Map((saved.pallets || []).map((x:any) => [x.invoice_no || x.id, x]));
        const mergedPallets = sourcePallets.map((x:any) => { const old = savedByInvoice.get(x.invoice_no); return old ? { ...x, ...old, customer_name:x.customer_name, area:x.area, division:x.division, pallets:x.pallets, invoice_date:x.invoice_date, scheduled_date:selectedDate } : x; });
        const savedVehicles = (saved.vehicles || []).filter((x:any) => active.some((v:any) => v.id === x.vehicle_id));
        setPlan({ ...saved, plan_date:selectedDate, vehicles:savedVehicles.length ? savedVehicles : defaults, pallets:mergedPallets });
      } else {
        setPlan({ plan_date: selectedDate, vehicles: defaults, pallets: sourcePallets });
      }
    } catch (e:any) { setError(e?.message || "Could not load Bulk Organizer data."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadSourceData(date); }, [date]);

  const vehicleMap = useMemo(() => new Map(fleet.map(v => [v.id, v])), [fleet]);
  const areaMap = useMemo(() => new Map(areas.map(a => [norm(a.name), a])), [areas]);
  const assignedIds = useMemo(() => new Set(plan.pallets.filter(p => p.vehicle_id).map(p => p.id)), [plan.pallets]);
  const pool = plan.pallets.filter(p => !p.vehicle_id).filter(p => {
    const q = norm(search); return !q || norm(p.customer_name).includes(q) || norm(p.invoice_no).includes(q) || norm(p.area).includes(q);
  });
  const totalPallets = plan.pallets.reduce((n,p) => n + Number(p.pallets || 0), 0);
  const assignedPallets = plan.pallets.filter(p => p.vehicle_id).reduce((n,p) => n + Number(p.pallets || 0), 0);

  function vehiclePermission(p:any, vehicle:any) {
    const area = areaMap.get(norm(p.area));
    if (!area) return { ok: true, text: "Area not mapped" };
    const expected = norm(area.vehicle_type);
    const actual = norm(vehicle.type);
    const typeOk = !expected || actual.includes(expected) || (isPickup(expected) && isPickup(actual)) || (isVan(expected) && isVan(actual));
    const divisionOk = !area.sector || !vehicle.division || norm(area.sector) === norm(vehicle.division);
    const vehicleAreaRows = permissions.filter(x => x.vehicle_id === vehicle.id);
    const areaPermissionOk = vehicleAreaRows.length === 0 || vehicleAreaRows.some(x => x.area_id === area.id);
    return { ok: typeOk && divisionOk && areaPermissionOk, text: !typeOk ? `Vehicle type mismatch: ${area.vehicle_type}` : !divisionOk ? `Division mismatch: ${area.sector}` : !areaPermissionOk ? "Vehicle is not permitted for this area" : "Compatible" };
  }

  function assign(palletId: string, vehicleId: string | null) {
    setPlan(x => ({ ...x, pallets: x.pallets.map(p => p.id === palletId ? { ...p, vehicle_id: vehicleId } : p) }));
  }

  function shiftDate(days:number) { const d=new Date(`${date}T12:00:00`); d.setDate(d.getDate()+days); setDate(dateKey(d)); }

  async function save() { setSaving(true); setError(""); try { await saveBulkOrganizerPlan(plan); } catch(e:any) { setError(e?.message || "Save failed"); } finally { setSaving(false); } }

  function toggleVehicle(v:any) {
    setPlan(x => x.vehicles.some(z => z.vehicle_id === v.id)
      ? { ...x, vehicles: x.vehicles.filter(z => z.vehicle_id !== v.id), pallets: x.pallets.map(p => p.vehicle_id === v.id ? { ...p, vehicle_id: null } : p) }
      : { ...x, vehicles: [...x.vehicles, { vehicle_id: v.id, capacity: defaultCapacity(v.type) }] });
  }

  if (loading) return <div className="page"><div className="glass-card" style={{padding:28}}>Loading Bulk Organizer…</div></div>;

  return <div className="page" style={{paddingBottom:80}}>
    <div className="glass-header" style={{marginBottom:14}}>
      <div>
        <div className="muted small" style={{display:'flex',gap:6,alignItems:'center'}}><PackageOpen size={14}/> Operations planning</div>
        <h1 style={{margin:'4px 0 0',fontSize:30,fontWeight:900}}>Bulk Organizer</h1>
        <p className="muted" style={{margin:'5px 0 0'}}>Arrange invoices into the vehicles available for each day — drag, fill, check permissions, and save.</p>
      </div>
      <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <GlassButton variant="secondary" size="sm" onClick={()=>void loadSourceData(date)}><RefreshCw size={14}/> Refresh Fleet</GlassButton>
        <GlassButton size="sm" onClick={()=>void save()} disabled={saving}><Save size={14}/> {saving?'Saving…':'Save Day'}</GlassButton>
      </div>
    </div>

    {error && <div className="glass-card" style={{border:'1px solid rgba(239,68,68,.35)',marginBottom:14,color:'#b91c1c'}}>{error}</div>}

    <div className="glass-card" style={{display:'grid',gridTemplateColumns:'auto 1fr auto',gap:12,alignItems:'center',marginBottom:14}}>
      <button className="btn" onClick={()=>shiftDate(-1)} aria-label="Previous day"><ChevronLeft size={17}/></button>
      <label style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10,fontWeight:900,fontSize:17}}><CalendarDays size={18}/><input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{maxWidth:180}}/></label>
      <button className="btn" onClick={()=>shiftDate(1)} aria-label="Next day"><ChevronRight size={17}/></button>
    </div>

    <div className="glass-card" style={{marginBottom:14}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <div><strong>Day at a glance</strong><div className="muted small">{fleet.filter(v=>plan.vehicles.some(p=>p.vehicle_id===v.id)).length} vehicles · {plan.pallets.length} invoices · {totalPallets} pallets · {assignedPallets} assigned</div></div>
        <div style={{display:'flex',gap:8}}><span className="badge">Pending {plan.pallets.filter(p=>!p.vehicle_id).length}</span><span className="badge">Loaded {plan.pallets.filter(p=>p.vehicle_id).length}</span></div>
      </div>
    </div>

    <section>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}><div><h2 style={{margin:0,fontSize:20}}>Vehicles</h2><div className="muted small">Default active Vans and Pick-Ups from Fleet Database. Add/remove vehicles for this date.</div></div><GlassButton variant="secondary" size="sm" onClick={()=>setShowFleet(x=>!x)}><Database size={14}/> {showFleet?'Hide':'Manage'} Fleet</GlassButton></div>
      {showFleet && <div className="glass-card" style={{marginBottom:10}}><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:8}}>{fleet.map(v=>{const on=plan.vehicles.some(x=>x.vehicle_id===v.id);return <button key={v.id} className="btn" onClick={()=>toggleVehicle(v)} style={{textAlign:'left',display:'flex',alignItems:'center',gap:10,borderColor:on?'var(--blue)':'var(--line)'}}>{on?<Check size={15}/>:<CarFront size={15}/>}<span><strong>{v.number}</strong><span className="muted small" style={{display:'block'}}>{v.type} · {v.division||'No division'}</span></span></button>})}</div></div>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',gap:12}}>
        {plan.vehicles.map(cfg=>{const v=vehicleMap.get(cfg.vehicle_id); if(!v)return null; const items=plan.pallets.filter(p=>p.vehicle_id===v.id); const used=items.reduce((n,p)=>n+Number(p.pallets||0),0); const pct=Math.min(100,(used/Math.max(1,cfg.capacity))*100); return <div key={v.id} className="glass-card" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault(); if(dragged){const p=plan.pallets.find(x=>x.id===dragged);if(p){const check=vehiclePermission(p,v);if(check.ok && used+Number(p.pallets)<=cfg.capacity) assign(dragged,v.id);}} setDragged(null);}} style={{minHeight:190,border:'1px solid var(--line)'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'start'}}><div style={{display:'flex',gap:9,alignItems:'center'}}>{isPickup(v.type)?<Truck size={21}/>:<CarFront size={21}/>}<div><div style={{fontWeight:900,fontSize:18}}>{v.number}</div><div className="muted small">{v.type} · {v.division||'—'}</div></div></div><button className="btn" title="Remove from day" onClick={()=>toggleVehicle(v)}><X size={14}/></button></div>
          <div style={{marginTop:12}}><div style={{display:'flex',justifyContent:'space-between',fontSize:12,fontWeight:800}}><span>{used} / {cfg.capacity} pallets</span><span>{Math.max(0,cfg.capacity-used)} free</span></div><div style={{height:9,borderRadius:999,background:'var(--line)',marginTop:6,overflow:'hidden'}}><div style={{height:'100%',width:`${pct}%`,background:pct>=100?'#ef4444':'var(--blue)',transition:'width .2s'}}/></div></div>
          <div style={{display:'grid',gap:6,marginTop:10}}>{items.slice(0,6).map(p=><div key={p.id} draggable onDragStart={()=>setDragged(p.id)} onDragEnd={()=>setDragged(null)} style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center',padding:'7px 9px',border:'1px solid var(--line)',borderRadius:11,cursor:'grab',background:'rgba(255,255,255,.06)'}}><span style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}><GripVertical size={13}/><span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.customer_name}</span></span><span className="badge">{p.pallets}</span></div>)}{items.length>6&&<div className="badge">+{items.length-6} more</div>}</div>
          <div className="muted small" style={{marginTop:9}}><ShieldCheck size={12} style={{verticalAlign:'-2px'}}/> Drop an invoice here; incompatible area/vehicle rules are blocked.</div>
          <label className="muted small" style={{display:'flex',alignItems:'center',gap:7,marginTop:9}}>Capacity <input type="number" min={1} value={cfg.capacity} onChange={e=>setPlan(x=>({...x,vehicles:x.vehicles.map(z=>z.vehicle_id===v.id?{...z,capacity:Math.max(1,Number(e.target.value))}:z)}))} style={{width:72}}/></label>
        </div>})}
        {!plan.vehicles.length && <div className="glass-card" style={{gridColumn:'1/-1',padding:28,textAlign:'center'}}><div style={{fontWeight:800}}>No vehicles selected</div><div className="muted small">Open Manage Fleet and add the Vans / Pick-Ups you want for this day.</div></div>}
      </div>
    </section>

    <section style={{marginTop:20}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:8}}><div><h2 style={{margin:0,fontSize:20}}>Pallet Pool</h2><div className="muted small">Drag invoices into a vehicle. Drag them back here to reschedule or rearrange.</div></div><div style={{width:300,maxWidth:'100%',position:'relative'}}><Search size={15} style={{position:'absolute',left:10,top:11,opacity:.6}}/><GlassInput list="bulk-organizer-customers" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Customer, invoice or area…" style={{paddingLeft:32}}/><datalist id="bulk-organizer-customers">{Array.from(new Set(facts.map(x=>String(x.customer_name||'').trim()).filter(Boolean))).slice(0,500).map(x=><option key={x} value={x}/>)}</datalist></div></div>
      <div className="glass-card" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(dragged)assign(dragged,null);setDragged(null);}} style={{minHeight:150}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:9}}>
          {pool.map(p=>{const v=plan.vehicles.find(x=>x.vehicle_id===p.vehicle_id);return <div key={p.id} draggable onDragStart={()=>setDragged(p.id)} className="bulk-pallet-card" style={{cursor:'grab',padding:12,border:'1px solid var(--line)',borderRadius:16,background:'var(--glass-bg,rgba(255,255,255,.12))'}}><div style={{display:'flex',justifyContent:'space-between',gap:8}}><div style={{display:'flex',gap:7}}><GripVertical size={15}/><strong>{p.customer_name}</strong></div><span className="badge">{p.division}</span></div><div className="muted small" style={{marginTop:6}}>{p.invoice_no} · {formatPallets(p.pallets)} · {p.area||'No area'}</div><div className="muted small" style={{marginTop:4}}>Invoice {p.invoice_date||'—'} · Schedule {p.scheduled_date}</div></div>})}
          {!pool.length && <div className="muted small" style={{padding:22,textAlign:'center',gridColumn:'1/-1'}}>No pending invoices for this day/filter.</div>}
        </div>
      </div>
    </section>

    <section style={{marginTop:20}}>
      <div className="glass-card"><div style={{display:'flex',alignItems:'center',gap:8,fontWeight:900}}><ShieldCheck size={17}/> Planning checks</div><div className="muted small" style={{marginTop:8}}>Customer division is predicted from the invoice data. Vehicle type and area compatibility are checked against the current Fleet / Areas data. Vehicle capacity is configurable here because the current Fleet Database schema does not contain a dedicated capacity field.</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:8,marginTop:10}}><div className="badge">Invoices loaded: {facts.length}</div><div className="badge">Vehicles from Fleet: {fleet.length}</div><div className="badge">Assigned invoices: {assignedIds.size}</div><div className="badge">Unassigned pallets: {totalPallets-assignedPallets}</div></div></div>
    </section>
  </div>;
}
