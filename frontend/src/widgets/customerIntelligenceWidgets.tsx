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
import { useEffect, useState } from "react";
import { api } from "../api/client";

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
  useEffect(() => { api.get("/customer-intelligence/stats").then(setStats).catch((e) => setError(e.message)); }, []);
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
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try { setAliases(await api.get(`/customer-intelligence/aliases?search=${encodeURIComponent(search)}`)); }
    catch (e: any) { setError(e.message); }
  }
  useEffect(() => { load(); }, [search]);

  async function reject(a: Alias) {
    try {
      await api.del(`/customer-intelligence/aliases?sap_name_normalized=${encodeURIComponent(a.sap_name_normalized)}&landmark_name_normalized=${encodeURIComponent(a.landmark_name_normalized)}`);
      load();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div>
      <div className="glass-card" style={{ marginBottom: 20 }}>
        <input placeholder="Search by SAP or Landmark name" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: "100%" }} />
      </div>
      {error && <div className="glass-card error-text" style={{ marginBottom: 20 }}>{error}</div>}
      {aliases.length === 0 ? (
        <div className="glass-card" style={{ color: "var(--muted)" }}>
          {search ? `No aliases match '${search}'.` : "No aliases learned yet - they accumulate automatically once a correlation run finds confident matches."}
        </div>
      ) : (
        aliases.map((a) => {
          const badge = a.best_confidence >= 90 ? "ok" : a.best_confidence >= 70 ? "" : "excluded";
          return (
            <div className="glass-card" key={`${a.sap_name_normalized}|${a.landmark_name_normalized}`} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>{a.sap_name_original}</strong> <span style={{ color: "var(--muted)" }}>↔</span> <strong>{a.landmark_name_original}</strong>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{a.times_confirmed}× confirmed · {a.best_confidence.toFixed(0)}% confidence</div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span className={"badge " + badge}>{a.best_confidence.toFixed(0)}%</span>
                  <button className="btn" style={{ background: "var(--red)" }} onClick={() => reject(a)}>Reject</button>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
