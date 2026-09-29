import { supabase, getPrimarySupabaseClient, getTertiarySupabaseClient } from "../lib/supabase";

export type BulkOrganizerPlan = {
  id?: string;
  plan_date: string;
  vehicles: Array<{ vehicle_id: string; capacity: number; driver?: string; helper?: string; building_id?: string | null }>;
  pallets: any[];
  customers?: any[];
  invoices?: any[];
  pallet_assignments?: Record<string, string | null>;
  buildings?: any[];
  vehicle_meta?: Record<string, { driver?: string; helper?: string; building_id?: string | null }>;
  customer_schedules?: any[];
  updated_at?: string;
};

export type BulkOrganizerDefaults = {
  id?: string | number;
  month_key?: string;
  buildings: any[];
  vehicles: any[];
  customer_schedules: any[];
  updated_at?: string;
};

export async function loadBulkOrganizerPlan(planDate: string): Promise<BulkOrganizerPlan | null> {
  const clients: Array<{source:"primary"|"tertiary"; db:any}> = [];
  const primary = getPrimarySupabaseClient();
  const tertiary = getTertiarySupabaseClient();
  if (primary) clients.push({source:"primary", db:primary});
  if (tertiary) clients.push({source:"tertiary", db:tertiary});

  const rows: any[] = [];
  for (const item of clients) {
    const {data, error} = await item.db.from("bulk_organizer_plans").select("*").eq("plan_date", planDate).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) rows.push({...data, __source:item.source});
  }
  if (!rows.length) return null;

  // Both projects can legitimately contain parts of the historical planner.
  // Merge instead of choosing one row so an empty/shell row can never hide real invoices.
  const populated = [...rows].sort((a,b) => {
    const ai=Array.isArray(a.invoices)?a.invoices.length:0, bi=Array.isArray(b.invoices)?b.invoices.length:0;
    if (bi !== ai) return bi-ai;
    const aa=Object.keys(a.pallet_assignments||{}).length, ba=Object.keys(b.pallet_assignments||{}).length;
    return ba-aa;
  });
  const base = {...populated[0]};
  delete base.__source;
  const uniq = (lists:any[]) => Array.from(new Map(lists.flatMap(x=>Array.isArray(x)?x:[]).map((x:any)=>[String(x?.id ?? x?.invoice_no ?? JSON.stringify(x)),x])).values());
  const invoices = uniq(rows.map(r=>r.invoices));
  const pallets = uniq(rows.map(r=>r.pallets));
  const customers = uniq(rows.map(r=>r.customers));
  const buildings = uniq(rows.map(r=>r.buildings));
  const vehicles = uniq(rows.map(r=>r.vehicles));
  const schedules = uniq(rows.map(r=>r.customer_schedules));
  const assignments = Object.assign({}, ...rows.map(r=>r.pallet_assignments||{}));
  const vehicleMeta = Object.assign({}, ...rows.map(r=>r.vehicle_meta||{}));
  return {
    ...base,
    plan_date: planDate,
    invoices: invoices.length ? invoices : [],
    pallets: pallets.length ? pallets : invoices,
    customers,
    buildings,
    vehicles,
    customer_schedules: schedules,
    pallet_assignments: assignments,
    vehicle_meta: vehicleMeta,
  } as BulkOrganizerPlan;
}

export async function saveBulkOrganizerPlan(plan: BulkOrganizerPlan): Promise<BulkOrganizerPlan> {
  const preserveEmpty = (plan as any).__preserveExistingWhenEmpty !== false;
  const payload = {
    plan_date: plan.plan_date, vehicles: plan.vehicles || [], pallets: plan.pallets || [],
    customers: plan.customers || [], invoices: plan.invoices || [],
    pallet_assignments: plan.pallet_assignments || {}, buildings: plan.buildings || [],
    vehicle_meta: plan.vehicle_meta || {}, customer_schedules: plan.customer_schedules || [],
    updated_at: new Date().toISOString(),
  };
  const primary = getPrimarySupabaseClient();
  const tertiary = getTertiarySupabaseClient();
  let db:any = primary || tertiary || supabase;
  if (primary && tertiary) {
    const [p,t] = await Promise.all([
      primary.from("bulk_organizer_plans").select("id,invoices").eq("plan_date",plan.plan_date).maybeSingle(),
      tertiary.from("bulk_organizer_plans").select("id,invoices").eq("plan_date",plan.plan_date).maybeSingle(),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (t.error) throw new Error(t.error.message);
    const ph=Array.isArray(p.data?.invoices)&&p.data.invoices.length>0;
    const th=Array.isArray(t.data?.invoices)&&t.data.invoices.length>0;
    if (ph) db=primary; else if (th) db=tertiary; else if (p.data) db=primary; else if (t.data) db=tertiary; else db=primary;

    // Never let an accidental empty hydration/autosave erase an existing planner.
    const existing = db === primary ? p.data : t.data;
    if (preserveEmpty && Array.isArray(existing?.invoices) && existing.invoices.length>0 && payload.invoices.length===0) {
      payload.invoices = existing.invoices;
      payload.pallets = Array.isArray(existing.pallets) && existing.pallets.length ? existing.pallets : existing.invoices;
    }
  }
  const {data,error}=await db.from("bulk_organizer_plans").upsert(payload,{onConflict:"plan_date"}).select("*").single();
  if(error) throw new Error(error.message);
  return data as BulkOrganizerPlan;
}

export async function loadBulkOrganizerDefaults(monthKey?: string): Promise<BulkOrganizerDefaults | null> {
  const mk = monthKey || new Date().toISOString().slice(0, 7) + "-01";
  const clients = [getPrimarySupabaseClient(), getTertiarySupabaseClient()].filter(Boolean) as any[];
  for (const db of clients) {
    const { data, error } = await db.from("bulk_organizer_month_defaults").select("*").eq("month_key", mk).maybeSingle();
    if (!error && data) return { ...data, id: String(data.id), month_key: mk } as BulkOrganizerDefaults;
  }
  try {
    const raw = localStorage.getItem(`dispatchops.bulkOrganizer.defaults.${mk}`) || localStorage.getItem("dispatchops.bulkOrganizer.defaults");
    return raw ? JSON.parse(raw) as BulkOrganizerDefaults : null;
  } catch { return null; }
}

export async function saveBulkOrganizerDefaults(value: BulkOrganizerDefaults): Promise<BulkOrganizerDefaults> {
  const mk = value.month_key || new Date().toISOString().slice(0, 7) + "-01";
  const payload = { month_key: mk, buildings: value.buildings || [], vehicles: value.vehicles || [], customer_schedules: value.customer_schedules || [], updated_at: new Date().toISOString() };
  const db = getPrimarySupabaseClient() || getTertiarySupabaseClient() || supabase;
  const { data, error } = await db.from("bulk_organizer_month_defaults").upsert(payload, { onConflict: "month_key" }).select("*").single();
  if (error) {
    const saved = { ...payload, id: String(value.id || "local"), month_key: mk } as BulkOrganizerDefaults;
    localStorage.setItem(`dispatchops.bulkOrganizer.defaults.${mk}`, JSON.stringify(saved));
    localStorage.setItem("dispatchops.bulkOrganizer.defaults", JSON.stringify(saved));
    return saved;
  }
  const saved = { ...data, id: String(data.id), month_key: mk } as BulkOrganizerDefaults;
  localStorage.setItem(`dispatchops.bulkOrganizer.defaults.${mk}`, JSON.stringify(saved));
  localStorage.setItem("dispatchops.bulkOrganizer.defaults", JSON.stringify(saved));
  return saved;
}
