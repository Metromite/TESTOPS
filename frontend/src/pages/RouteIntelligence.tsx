import { useEffect, useState } from "react";
import { api } from "../api/client";

interface DriverDate { driver_name: string; date: string; }
interface SapStop { invoice_no: string; customer_name: string; customer_name_source: string | null; box_entry_time: string | null; boxes: number; area: string; }
interface LmStop { customer_name: string; arrival: string; departure: string; duration_minutes: number; }
interface Reconstruction {
  sap_route: { stops_missing_time: number; stops: SapStop[] };
  landmark_route: { all_stops_count: number; delivery_stops: LmStop[] };
}

export default function RouteIntelligence() {
  const [options, setOptions] = useState<DriverDate[]>([]);
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState<Reconstruction | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/route-intelligence/driver-dates").then(setOptions).catch((e) => setError(e.message));
  }, []);

  async function load(driverDate: string) {
    setSelected(driverDate);
    setError("");
    setResult(null);
    if (!driverDate) return;
    const [driver_name, date] = driverDate.split("|||");
    try {
      const data = await api.get(`/route-intelligence/reconstruct?driver_name=${encodeURIComponent(driver_name)}&date=${encodeURIComponent(date)}`);
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="page">
      <h2>Route Intelligence</h2>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -8 }}>
        Reconstructs one driver's one day exactly as it happened - the ordered SAP
        invoice sequence (Pass 1) alongside the ordered Landmark GPS stop sequence
        (Pass 2), side by side. No learning or optimization applied yet, matching
        V1's own scope for this engine.
      </p>

      <div className="glass-card" style={{ marginBottom: 20 }}>
        {options.length === 0 ? (
          <span style={{ color: "var(--muted)" }}>No SAP data imported yet - upload a SAP export first.</span>
        ) : (
          <select value={selected} onChange={(e) => load(e.target.value)} style={{ width: "100%" }}>
            <option value="">Select a driver + date...</option>
            {options.map((o) => (
              <option key={`${o.driver_name}|||${o.date}`} value={`${o.driver_name}|||${o.date}`}>
                {o.driver_name} — {o.date}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <div className="glass-card error-text" style={{ marginBottom: 20 }}>{error}</div>}

      {result && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="glass-card">
            <strong>SAP Route</strong>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
              {result.sap_route.stops.length} stops · {result.sap_route.stops_missing_time} missing a real timestamp
            </div>
            <table className="data-table">
              <thead><tr><th>#</th><th>Customer</th><th>Time</th><th>Boxes</th></tr></thead>
              <tbody>
                {result.sap_route.stops.map((s, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{s.customer_name} {s.customer_name_source && s.customer_name_source !== "customer_name" && <span className="badge excluded" style={{ marginLeft: 4 }}>{s.customer_name_source}</span>}</td>
                    <td>{s.box_entry_time || "—"}</td>
                    <td>{s.boxes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="glass-card">
            <strong>Landmark Route</strong>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
              {result.landmark_route.delivery_stops.length} delivery stops (of {result.landmark_route.all_stops_count} total GPS rows)
            </div>
            <table className="data-table">
              <thead><tr><th>#</th><th>Customer</th><th>Arrival</th><th>Mins</th></tr></thead>
              <tbody>
                {result.landmark_route.delivery_stops.map((s, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td><td>{s.customer_name}</td><td>{s.arrival}</td><td>{s.duration_minutes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
