import { useEffect, useState } from "react";
import { api } from "../api/client";

interface Row {
  area_code: string; area_name: string; role: string;
  current_person_code: string; current_person_name: string;
  vacation_start_date: string; days_until_vacation: number;
  replacement_code: string | null; replacement_name: string | null; replacement_score: number | null;
  no_replacement_available: boolean;
}

export default function Replacements() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get("/route-plan/replacement-forecast"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="page">
      <h2>Replacement Forecast</h2>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -8 }}>
        For every route's current top candidate, checks whether they have a vacation coming up
        in the next 3 months and who the next-best-ranked candidate would be to cover it - using
        the exact same scoring engine as route plan generation.
      </p>

      {error && <div className="glass-card error-text" style={{ marginBottom: 20 }}>{error}</div>}
      {loading && <div className="glass-card">Loading...</div>}

      {!loading && rows.length === 0 && !error && (
        <div className="glass-card" style={{ color: "var(--muted)" }}>
          No upcoming vacations affecting any currently top-ranked driver or helper in the next 3 months.
        </div>
      )}

      <div className="glass-card table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Area</th><th>Role</th><th>Currently Assigned</th><th>Vacation Starts</th>
              <th>Days Until</th><th>Replacement</th><th>Replacement Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={r.no_replacement_available ? { background: "rgba(239,68,68,0.08)" } : undefined}>
                <td>{r.area_name} ({r.area_code})</td>
                <td>{r.role}</td>
                <td>{r.current_person_name} ({r.current_person_code})</td>
                <td>{r.vacation_start_date}</td>
                <td>
                  <span className={"badge " + (r.days_until_vacation <= 14 ? "excluded" : "")}>
                    {r.days_until_vacation} days
                  </span>
                </td>
                <td>
                  {r.no_replacement_available ? (
                    <span className="badge excluded">No replacement available</span>
                  ) : (
                    `${r.replacement_name} (${r.replacement_code})`
                  )}
                </td>
                <td>{r.replacement_score ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
