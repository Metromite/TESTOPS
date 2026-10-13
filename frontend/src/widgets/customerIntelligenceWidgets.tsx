/**
 * widgets/customerIntelligenceWidgets.tsx
 * Round -12: atomic widgets extracted from CustomerIntelligence.tsx. The 2
 * KPIs are cleanly separable; the alias search+list stays one cohesive
 * widget (search state drives which rows render - splitting further would
 * mean duplicating that search state across pieces for no real benefit,
 * same call made for Experience.tsx and RouteIntelligence.tsx, which are
 * registered as single widgets rather than force-decomposed).
 *
 * FLAGGED BEHAVIOR CHANGE (not a calculation change): the original page
 * fetched stats + aliases together via Promise.all, re-running BOTH on
 * every search keystroke, even though stats never depended on search. That
 * was wasted work, not a feature - splitting stats into their own widget
 * with its own one-time fetch on mount means the stats KPIs no longer
 * needlessly re-fetch per keystroke. The stats VALUE returned is identical
 * either way (it was never search-dependent); only the redundant refetch
 * cadence changed. Called out here rather than silently changed.
 *
 * No GlobalFilters/driver here - this page never used dashboard filters
 * (it's alias data, not invoice data), so unlike every widgets/*.tsx file
 * above, these components take no such props - preserved exactly as the
 * original page never had them either.
 */
import { useEffect, useState, useRef } from "react";
import { getCustomerAliases, getCustomerStats, deleteCustomerAlias } from "../services/operational";
import { getRole } from "../api/client";
import { supabase } from "../lib/supabase";
import * as XLSX from "xlsx";

export interface Stats { total_aliases_learned: number; aliases_confirmed_more_than_once: number; }
export interface Alias {
  sap_name_normalized: string; landmark_name_normalized: string;
  sap_name_original: string; landmark_name_original: string;
  times_confirmed: number; best_confidence: number;
  first_seen: string; last_seen: string;
}

export function useCiStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { getCustomerStats<Stats>().then(setStats).catch((e) => setError(e.message)); }, []);
  return { stats, error };
}

export function TotalAliasesKpi() {
  const { stats, error } = useCiStats();
  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!stats) return <div>Loading...</div>;
  return <div className="glass-card kpi-card"><div className="value">{stats.total_aliases_learned}</div><div className="label">Total Aliases Learned</div></div>;
}
export function ConfirmedAliasesKpi() {
  const { stats, error } = useCiStats();
  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!stats) return <div>Loading...</div>;
  return <div className="glass-card kpi-card"><div className="value">{stats.aliases_confirmed_more_than_once}</div><div className="label">Confirmed More Than Once</div></div>;
}

export function AliasListWidget() {
  const isAdmin = getRole() === "admin";
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try { setAliases(await getCustomerAliases<Alias>(search)); }
    catch (e: any) { setError(e.message); }
  }
  useEffect(() => { void load(); }, [search]);

  async function downloadExcel() {
    setBusy(true); setMsg("");
    try {
      const { data, error } = await supabase.from("customer_aliases").select("*").order("last_seen", { ascending: false }).limit(5000);
      if (error) throw new Error(error.message);
      const ws = XLSX.utils.json_to_sheet(data || []);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "customer_aliases");
      XLSX.writeFile(wb, `customer_aliases_${new Date().toISOString().slice(0,10)}.xlsx`);
      setMsg("Excel download created.");
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  async function importExcel(file: File | undefined) {
    if (!isAdmin || !file) return;
    setBusy(true); setMsg("");
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
      let count = 0;
      for (const r of rows) {
        const sap = String(r.sap_name_original ?? r.sap_name ?? r.source_name ?? "").trim();
        const landmark = String(r.landmark_name_original ?? r.landmark_name ?? r.canonical_name ?? "").trim();
        if (!sap || !landmark) continue;
        const sapNorm = String(r.sap_name_normalized || sap).trim().toUpperCase();
        const landmarkNorm = String(r.landmark_name_normalized || landmark).trim().toUpperCase();
        const payload = {
          sap_name_original: sap, landmark_name_original: landmark,
          sap_name_normalized: sapNorm, landmark_name_normalized: landmarkNorm,
          source_name: String(r.source_name || sap), canonical_name: String(r.canonical_name || landmark),
          times_confirmed: Number(r.times_confirmed || 1), best_confidence: Number(r.best_confidence || 0),
          first_seen: r.first_seen || new Date().toISOString(), last_seen: r.last_seen || new Date().toISOString(),
        };
        const existing = await supabase.from("customer_aliases").select("id").eq("sap_name_normalized", sapNorm).eq("landmark_name_normalized", landmarkNorm).maybeSingle();
        if (existing.error) throw new Error(existing.error.message);
        const result = existing.data
          ? await supabase.from("customer_aliases").update(payload).eq("id", existing.data.id)
          : await supabase.from("customer_aliases").insert(payload);
        if (result.error) throw new Error(result.error.message);
        count++;
      }
      if (fileRef.current) fileRef.current.value = "";
      setMsg(`Imported ${count} customer alias record(s).`);
      await load();
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  async function reject(a: Alias) {
    if (!isAdmin) return;
    try {
      await deleteCustomerAlias(a.sap_name_normalized, a.landmark_name_normalized);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div>
      <div className="glass-card" style={{ marginBottom: 20 }}>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <input placeholder="Search by SAP or Landmark name" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex:1,minWidth:260 }} />
          <button className="btn" disabled={busy} onClick={() => void downloadExcel()}>⬇ Download Excel</button>
          {isAdmin && <><input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => void importExcel(e.target.files?.[0])}/><button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>⬆ Import Excel</button></>}
        </div>
        {msg && <div style={{fontSize:12,color:"var(--muted)",marginTop:8}}>{msg}</div>}
      </div>
      {error && <div className="glass-card error-text" style={{ marginBottom: 20 }}>{error}</div>}
      {aliases.length === 0 ? (
        <div className="glass-card" style={{ color: "var(--muted)" }}>{search ? `No aliases match '${search}'.` : "No aliases learned yet - they accumulate automatically once a correlation run finds confident matches."}</div>
      ) : aliases.map((a) => {
        const badge = a.best_confidence >= 90 ? "ok" : a.best_confidence >= 70 ? "" : "excluded";
        return <div className="glass-card" key={`${a.sap_name_normalized}|${a.landmark_name_normalized}`} style={{ marginBottom: 12 }}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
            <div><strong>{a.sap_name_original}</strong> <span style={{color:"var(--muted)"}}>↔</span> <strong>{a.landmark_name_original}</strong><div style={{fontSize:12,color:"var(--muted)"}}>{a.times_confirmed}× confirmed · {a.best_confidence.toFixed(0)}% confidence</div></div>
            <span style={{display:"flex",gap:8,alignItems:"center"}}><span className={"badge " + badge}>{a.best_confidence.toFixed(0)}%</span>{isAdmin&&<button className="btn" style={{background:"var(--red)"}} onClick={()=>void reject(a)}>Delete</button>}</span>
          </div>
        </div>;
      })}
    </div>
  );
}
