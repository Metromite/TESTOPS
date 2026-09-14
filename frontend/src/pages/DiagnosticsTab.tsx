import { useEffect, useState } from "react";
import { api } from "../api/client";

interface DiagData {
  data_load_summary: { sap_rows_loaded: number; sap_unique_vehicles: number; sap_unique_drivers: number;
                        landmark_rows_loaded: number; landmark_vehicle_sections: number };
  matching_results: { standalone_mode: boolean; vehicle_matches: number; name_matches: number; no_matches: number;
                       match_details: { vehicle_key: string; sap_driver: string | null; match_method: string }[] };
  validation_results: { level: string; msg: string }[];
  facility_breakdown: { type: string; icon: string; count: number }[];
  data_relationship_notes: string[];
}

const levelColor: Record<string, string> = { ok: "var(--green)", warn: "var(--amber)", err: "var(--red)" };

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <strong style={{ color: color || "var(--text)" }}>{value}</strong>
    </div>
  );
}

export default function DiagnosticsTab() {
  const [data, setData] = useState<DiagData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/dashboard/diagnostics").then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data) return <div>Loading...</div>;

  const { data_load_summary: d, matching_results: m, validation_results, facility_breakdown, data_relationship_notes } = data;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div className="glass-card">
        <strong style={{ color: "var(--cyan)" }}>📊 Data Load Summary</strong>
        <div style={{ marginTop: 10 }}>
          <Stat label="SAP Rows Loaded" value={d.sap_rows_loaded} />
          <Stat label="SAP Unique Vehicles" value={d.sap_unique_vehicles} />
          <Stat label="SAP Unique Drivers" value={d.sap_unique_drivers} />
          <Stat label="Landmark Rows Loaded" value={d.landmark_rows_loaded} />
          <Stat label="Landmark Vehicle Sections" value={d.landmark_vehicle_sections} />
        </div>
      </div>

      <div className="glass-card">
        <strong style={{ color: "var(--teal)" }}>🔗 Matching Results</strong>
        <div style={{ marginTop: 10 }}>
          <Stat label="Standalone Mode" value={m.standalone_mode ? "YES — displayed separately" : "NO — matched"} color={m.standalone_mode ? "var(--red)" : "var(--green)"} />
          <Stat label="Vehicle # Matches (high confidence)" value={m.vehicle_matches} color={m.vehicle_matches > 0 ? "var(--green)" : "var(--muted)"} />
          <Stat label="Driver Name Matches (medium confidence)" value={m.name_matches} color={m.name_matches > 0 ? "var(--amber)" : "var(--muted)"} />
          <Stat label="Unmatched GPS Vehicles" value={m.no_matches} color={m.no_matches > 0 ? "var(--red)" : "var(--green)"} />
          {m.match_details.slice(0, 8).map((md) => (
            <Stat key={md.vehicle_key} label={md.vehicle_key}
                  value={md.match_method === "none" ? "✗ Unmatched" : `${md.sap_driver} (${md.match_method})`}
                  color={md.match_method === "vehicle" ? "var(--green)" : md.match_method === "none" ? "var(--red)" : "var(--amber)"} />
          ))}
        </div>
      </div>

      <div className="glass-card">
        <strong style={{ color: "var(--amber)" }}>✅ Validation Summary</strong>
        <div style={{ marginTop: 10 }}>
          {validation_results.map((v, i) => <Stat key={i} label={v.msg} value="" color={levelColor[v.level]} />)}
        </div>
      </div>

      <div className="glass-card">
        <strong style={{ color: "var(--purple)" }}>🏪 SAP Facility Classification</strong>
        <div style={{ marginTop: 10 }}>
          {facility_breakdown.map((f) => <Stat key={f.type} label={`${f.icon} ${f.type}`} value={f.count} />)}
        </div>
      </div>

      <div className="glass-card" style={{ gridColumn: "span 2" }}>
        <strong style={{ color: "var(--cyan)" }}>ℹ️ Data Relationship Notes</strong>
        <div style={{ marginTop: 10 }}>
          {data_relationship_notes.map((n, i) => <Stat key={i} label={n} value="" />)}
        </div>
      </div>
    </div>
  );
}
