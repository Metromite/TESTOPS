import { useEffect, useState } from "react";
import { api, getRole } from "../api/client";

interface Entry { vehicle_key: string; vehicle_display: string; gps_driver_name: string | null; current_sap_driver: string | null; match_method: string; }
interface ReviewData { sap_driver_options: string[]; entries: Entry[]; counts: Record<string, number>; }

const badgeFor: Record<string, { label: string; cls: string }> = {
  manual: { label: "✏️ Manual", cls: "ok" }, vehicle: { label: "🔢 Vehicle #", cls: "ok" },
  name: { label: "~ Name", cls: "" }, none: { label: "✗ Unmatched", cls: "excluded" },
};

export default function DriverMappingReviewTab() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState("");
  const canWrite = getRole() === "admin" || getRole() === "dispatcher";

  async function load() {
    try { setData(await api.get("/dashboard/driver-mapping-review")); } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function apply(vehicle_key: string, sap_driver: string) {
    try {
      await api.post("/dashboard/driver-mapping-review/apply", { vehicle_key, sap_driver });
      load();
    } catch (e: any) { setError(e.message); }
  }

  async function resetAll() {
    try { await api.post("/dashboard/driver-mapping-review/reset", {}); load(); } catch (e: any) { setError(e.message); }
  }

  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data) return <div>Loading...</div>;

  return (
    <div>
      <div className="glass-card" style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          {data.entries.length} GPS vehicle(s) — {data.counts.vehicle || 0} vehicle# match · {data.counts.name || 0} name match · {data.counts.manual || 0} manual · {data.counts.none || 0} unmatched
        </span>
        {canWrite && <button className="btn" style={{ background: "var(--red)" }} onClick={resetAll}>Reset All Overrides</button>}
      </div>

      {data.entries.length === 0 ? (
        <div className="glass-card" style={{ color: "var(--muted)" }}>No Landmark data loaded.</div>
      ) : (
        data.entries.map((e) => {
          const badge = badgeFor[e.match_method] || badgeFor.none;
          return (
            <div className="glass-card" key={e.vehicle_key} style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
              <div>
                <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--cyan)" }}>{e.vehicle_display}</div>
                {e.gps_driver_name && <div style={{ fontSize: 10, color: "var(--muted)" }}>GPS: {e.gps_driver_name}</div>}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", flex: 1 }}>{e.current_sap_driver || "—"}</div>
              {canWrite ? (
                <select value={e.current_sap_driver || ""} onChange={(ev) => apply(e.vehicle_key, ev.target.value)}>
                  <option value="">— None —</option>
                  {data.sap_driver_options.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              ) : null}
              <span className={"badge " + badge.cls}>{badge.label}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
