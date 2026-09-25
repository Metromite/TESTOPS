import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Cloud, Database, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { useConnectionStatus } from "../hooks/useConnectionStatus";
import {
  activateSupabaseProfile,
  getActiveSupabaseProfile,
  getSupabaseProfiles,
  saveSupabaseProfiles,
  testSupabaseProfile,
  syncPrimaryConfigurationToAllClouds,
  type SupabaseProfile,
} from "../lib/supabase";
import { GlassButton, GlassHeader, GlassInput, GlassPanel } from "../design-system";
import { formatBytes, getDispatchopsDatabaseStats, type DatabaseStats } from "../services/storageStats";

function newProfile(): SupabaseProfile {
  return { id: crypto.randomUUID(), name: "New Supabase Project", url: "", publishableKey: "" };
}

export default function DataSync() {
  const { status, retryNow } = useConnectionStatus();
  const [profiles, setProfiles] = useState<SupabaseProfile[]>(() => getSupabaseProfiles());
  const [activeId, setActiveId] = useState(() => getActiveSupabaseProfile()?.id ?? "");
  const [editing, setEditing] = useState<SupabaseProfile>(() => getActiveSupabaseProfile() ?? newProfile());
  const [message, setMessage] = useState("");
  const [testing, setTesting] = useState(false);
  const [dbStats, setDbStats] = useState<{primary:DatabaseStats;secondary:DatabaseStats|null;tertiary:DatabaseStats|null}|null>(null);
  const [dbStatsError, setDbStatsError] = useState("");

  const active = useMemo(() => profiles.find((p) => p.id === activeId) ?? null, [profiles, activeId]);

  async function refreshDatabaseStats(){try{setDbStatsError("");setDbStats(await getDispatchopsDatabaseStats())}catch(e:any){setDbStatsError(e?.message||String(e))}}
  useEffect(()=>{void refreshDatabaseStats(); void syncPrimaryConfigurationToAllClouds().catch(()=>{});},[]);

  function persist(next: SupabaseProfile[]) {
    setProfiles(next);
    saveSupabaseProfiles(next);
  }

  function saveCurrent() {
    setMessage("");
    if (!editing.name.trim() || !editing.url.trim() || !editing.publishableKey.trim()) {
      setMessage("Name, project URL, and publishable key are required.");
      return;
    }
    if (/service[_-]?role/i.test(editing.publishableKey) || editing.publishableKey.trim().startsWith("sb_secret_")) {
      setMessage("Service-role/secret keys are blocked. Use only the Supabase publishable key.");
      return;
    }
    const next = profiles.some((p) => p.id === editing.id)
      ? profiles.map((p) => (p.id === editing.id ? editing : p))
      : [...profiles, editing];
    persist(next);
    setMessage("Project profile saved on this PC.");
  }

  async function testCurrent() {
    setTesting(true);
    setMessage("Testing connection…");
    const result = await testSupabaseProfile(editing);
    setMessage(result.message);
    setTesting(false);
  }

  function activate(id: string) {
    activateSupabaseProfile(id);
    setActiveId(id);
    setMessage("Project activated. Reloading DispatchOPS against the selected Supabase project…");
    setTimeout(() => window.location.reload(), 250);
  }

  function remove(id: string) {
    if (id === "default") {
      setMessage("The built-in default profile cannot be deleted, but you can activate another project.");
      return;
    }
    if (!confirm("Remove this Supabase profile from this PC? This does not delete the Supabase project or its data.")) return;
    const next = profiles.filter((p) => p.id !== id);
    persist(next);
    if (editing.id === id) setEditing(active ?? next[0] ?? newProfile());
  }

  const dot = status === "connected" ? "#2e7d32" : status === "offline" ? "#c62828" : "#f9a825";

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <GlassHeader eyebrow="Admin" title="Cloud Connection" description="Manage the three Supabase projects used together by this DispatchOPS installation." />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>
        <GlassPanel title="Supabase Projects" description="Primary, Secondary and Tertiary projects are connected together; DispatchOPS reads all three as one data source.">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: 99, background: dot }} />
            <strong style={{ fontSize: 13 }}>{status === "connected" ? "Connected" : status === "offline" ? "Offline" : "Connecting…"}</strong>
            <GlassButton variant="subtle" size="sm" onClick={retryNow} style={{ marginLeft: "auto" }}><RefreshCw className="h-3.5 w-3.5" />Retry</GlassButton>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {profiles.map((p) => (
              <button
                key={p.id}
                onClick={() => setEditing({ ...p })}
                style={{ textAlign: "left", border: p.id === editing.id ? "1px solid var(--teal)" : "1px solid var(--border)", background: "var(--navy3)", borderRadius: 10, padding: 10, color: "inherit" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Database style={{ width: 14, height: 14 }} />
                  <strong style={{ fontSize: 12, flex: 1 }}>{p.name}</strong>
                  {p.id === activeId && <CheckCircle2 style={{ width: 14, height: 14, color: "var(--teal)" }} />}
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 5, overflow: "hidden", textOverflow: "ellipsis" }}>{p.url}</div>
              </button>
            ))}
          </div>

          <GlassButton variant="secondary" size="sm" onClick={() => { const p = newProfile(); setEditing(p); setMessage(""); }} style={{ marginTop: 12, width: "100%" }}>
            <Plus className="h-4 w-4" /> Add Supabase Project
          </GlassButton>
        </GlassPanel>

        <GlassPanel title="Supabase Project Connections" description="Use the Project URL and publishable key. Secret/service-role keys are never accepted by DispatchOPS.">
          <div style={{ display: "grid", gap: 12 }}>
            <label><span style={{ fontSize: 11, color: "var(--muted)" }}>Profile name</span><GlassInput value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
            <label><span style={{ fontSize: 11, color: "var(--muted)" }}>Supabase Project URL</span><GlassInput value={editing.url} onChange={(e) => setEditing({ ...editing, url: e.target.value })} placeholder="https://your-project.supabase.co" /></label>
            <label><span style={{ fontSize: 11, color: "var(--muted)" }}>Publishable key</span><GlassInput value={editing.publishableKey} onChange={(e) => setEditing({ ...editing, publishableKey: e.target.value })} placeholder="sb_publishable_…" /></label>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <GlassButton variant="secondary" size="sm" onClick={testCurrent} disabled={testing}><Cloud className="h-4 w-4" />{testing ? "Testing…" : "Test Connection"}</GlassButton>
              <GlassButton variant="primary" size="sm" onClick={saveCurrent}><Save className="h-4 w-4" />Save Profile</GlassButton>
              {profiles.some((p) => p.id === editing.id) && editing.id !== activeId && <GlassButton variant="primary" size="sm" onClick={() => activate(editing.id)}>Activate Project</GlassButton>}
              {profiles.some((p) => p.id === editing.id) && editing.id !== "default" && <GlassButton variant="subtle" size="sm" onClick={() => remove(editing.id)}><Trash2 className="h-4 w-4" />Remove</GlassButton>}
            </div>

            {message && <div className="glass-card" style={{ padding: 10, fontSize: 12 }}>{message}</div>}

            <div className="glass-card" style={{ padding: 12, fontSize: 12, color: "var(--muted)" }}>
              <strong style={{ color: "var(--ink)" }}>How multiple projects work</strong><br />
              DispatchOPS uses Primary → Secondary → Tertiary as one federated storage pool. Dashboard, Fleet, V-Zone, imports and analytics read all three. A new import stays whole in one project and automatically moves to the next project when the current project reaches 85% Storage usage. Tertiary is the final overflow project. Each record remains owned by the project where it was created.
            </div>
          </div>
        </GlassPanel>
      </div>

      <GlassPanel title="Database Capacity" description="Live database usage for each Supabase project. Experience, Dashboard, Fleet and other cloud records are included in database usage; file storage is shown separately in Imports.">
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:10}}><GlassButton variant="subtle" size="sm" onClick={()=>void refreshDatabaseStats()}><RefreshCw className="h-3.5 w-3.5" />Refresh</GlassButton></div>
        {dbStatsError&&<div className="error-text" style={{fontSize:12,marginBottom:10}}>{dbStatsError}</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:12}}>
          {[{name:"Primary",stats:dbStats?.primary},{name:"Secondary",stats:dbStats?.secondary},{name:"Tertiary",stats:dbStats?.tertiary}].map(x=><div key={x.name} className="glass-card" style={{padding:14}}>
            <strong>{x.name} Database</strong>
            <div style={{fontSize:12,color:"var(--muted)",marginTop:8}}>Used: {x.stats?formatBytes(x.stats.usedBytes):"—"}</div>
            <div style={{fontSize:12,color:"var(--muted)",marginTop:4}}>Remaining: {x.stats?formatBytes(x.stats.remainingBytes):"—"}</div>
            <div style={{fontSize:12,color:"var(--muted)",marginTop:4}}>Capacity shown: {x.stats?formatBytes(x.stats.capacityBytes):"—"}</div>
            <div style={{background:"var(--navy3)",borderRadius:999,height:7,marginTop:10,overflow:"hidden"}}><div style={{width:`${Math.min(100,x.stats?.percentUsed??0)}%`,background:"var(--teal)",height:"100%"}}/></div>
            <div style={{fontSize:11,color:"var(--muted)",marginTop:5}}>{x.stats?`${x.stats.percentUsed.toFixed(1)}% used`:"Not available"}</div>
          </div>)}
        </div>
      </GlassPanel>
    </div>
  );
}
