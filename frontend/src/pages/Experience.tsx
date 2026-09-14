import { useEffect, useState } from "react";
import { api } from "../api/client";
import DetailWindow from "../components/DetailWindow";

interface Summary {
  person_code: string; person_name: string; person_type: string;
  distinct_areas: number; total_days: number; most_recent_area: string; most_recent_end: string;
}
interface Suggestion { label: string; value: string; kind: string }
interface DivisionMajority {
  person_name: string; division: "Consumer" | "Pharma";
  consumer_orders: number; pharma_orders: number; total_orders: number;
}

/**
 * V2 milestone: Experience Database usability.
 * - Predictive search bar (partial typing, suggestions from the Experience
 *   Database + imported master data - see GET /experience/suggestions),
 *   searching across Driver/Helper Code+Name, Area Code/Name, Vehicle
 *   Number/Type, and Division.
 * - Clicking a Driver/Helper now opens a proper Modal popup (DetailWindow -
 *   auto-sizes to content, vertical-scroll-only, search/sort built in)
 *   instead of splitting the page into two halves.
 */
export default function Experience() {
  const [summary, setSummary] = useState<Summary[]>([]);
  const [detail, setDetail] = useState<any[]>([]);
  const [selected, setSelected] = useState<{ code: string; type: string; name: string } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [error, setError] = useState("");
  // ITEM PASS ADD: Salesman-Categorization-derived overall Consumer/Pharma
  // classification per driver (majority of their full order history) - see
  // GET /salesmen/driver-majority, backed by
  // services/division_detection.driver_overall_division_majority. This is
  // the "does this driver's experience count as Consumer or Pharma" answer
  // the requirement describes, distinct from the raw SAP Division text
  // already shown per-stint in the detail popup below.
  const [divisionMajority, setDivisionMajority] = useState<Record<string, DivisionMajority>>({});

  async function loadSummary() {
    try { setSummary(await api.get("/experience/summary")); } catch (e: any) { setError(e.message); }
  }
  async function loadDivisionMajority() {
    try { setDivisionMajority(await api.get("/salesmen/driver-majority")); } catch { /* non-fatal: table still renders without this column's data */ }
  }
  useEffect(() => { loadSummary(); loadDivisionMajority(); }, []);

  useEffect(() => {
    if (!search.trim()) { setSuggestions([]); return; }
    const handle = setTimeout(() => {
      api.get(`/experience/suggestions?q=${encodeURIComponent(search)}`).then(setSuggestions).catch(() => {});
    }, 200);
    return () => clearTimeout(handle);
  }, [search]);

  async function openDetail(person_code: string, person_type: string, person_name: string) {
    setSelected({ code: person_code, type: person_type, name: person_name });
    setDetailLoading(true);
    try {
      const rows = await api.get(`/experience?person_code=${encodeURIComponent(person_code)}&person_type=${person_type}`);
      setDetail(rows.map((d: any) => ({
        ...d,
        vehicle: d.vehicle_number ? `${d.vehicle_number}${d.vehicle_type ? ` (${d.vehicle_type})` : ""}` : "—",
        days: d.days_worked ?? "—",
      })));
    } catch (e: any) { setError(e.message); } finally { setDetailLoading(false); }
  }

  // Predictive search: partial typing instantly filters the summary table
  // (client-side against the already-loaded summary, for the two fields
  // that live directly on it) - the suggestion dropdown above additionally
  // covers Area/Vehicle/Division via the backend, which the summary table
  // itself doesn't carry per-row.
  const q = search.trim().toLowerCase();
  const filtered = summary
    .filter((s) => !typeFilter || s.person_type === typeFilter)
    .filter((s) => !q ||
      s.person_code.toLowerCase().includes(q) ||
      s.person_name.toLowerCase().includes(q) ||
      s.most_recent_area.toLowerCase().includes(q)
    );

  function pickSuggestion(sug: Suggestion) {
    setSearch(sug.value);
    setShowSuggestions(false);
  }

  return (
    <div className="page">
      <h2>Experience</h2>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -8 }}>
        Built automatically from every SAP import - exact start/end dates and days worked per
        area, with the division (Pharma/Consumer/etc), vehicle used, and vehicle type recorded directly from that dispatch.
      </p>

      <div className="glass-card" style={{ marginBottom: 20, display: "flex", gap: 10, flexWrap: "wrap", position: "relative" }}>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All (Drivers &amp; Helpers)</option>
          <option value="Driver">Drivers only</option>
          <option value="Helper">Helpers only</option>
        </select>
        <div style={{ position: "relative" }}>
          <input
            placeholder="Search by Driver/Helper Code or Name, Area, Vehicle Number/Type, or Division…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            style={{ minWidth: 420 }}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="glass-card" style={{ position: "absolute", zIndex: 9999, marginTop: 4, padding: 4, minWidth: "100%", maxHeight: 260, overflowY: "auto" }}>
              {suggestions.map((s, i) => (
                <div key={`${s.kind}-${s.value}-${i}`} onMouseDown={() => pickSuggestion(s)} style={{ padding: "5px 8px", cursor: "pointer", fontSize: 13 }}>
                  {s.label}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <div className="glass-card error-text" style={{ marginBottom: 20 }}>{error}</div>}

      <div className="glass-card table-scroll">
        <strong>Summary</strong>
        <table className="data-table" style={{ marginTop: 10 }}>
          <thead><tr><th>Name</th><th>Type</th><th>Experience</th><th>Areas Worked</th><th>Total Days</th><th>Most Recent Area</th><th>Last Worked</th></tr></thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ color: "var(--muted)", textAlign: "center", padding: 20 }}>
                No experience history yet - upload a SAP export to build it automatically.
              </td></tr>
            )}
            {filtered.map((s) => {
              const maj = divisionMajority[s.person_code];
              return (
              <tr
                key={`${s.person_type}-${s.person_code}`}
                onClick={() => openDetail(s.person_code, s.person_type, s.person_name)}
                style={{ cursor: "pointer" }}
              >
                <td><strong>{s.person_name}</strong> <span style={{ color: "var(--muted)", fontSize: 11 }}>({s.person_code})</span></td>
                <td>{s.person_type}</td>
                <td>
                  {maj ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span
                        title={`${maj.consumer_orders} Consumer / ${maj.pharma_orders} Pharma orders (majority of full order history)`}
                        className="badge"
                        style={{ background: maj.division === "Consumer" ? "var(--blue-soft, rgba(59,130,246,0.18))" : "var(--purple-soft, rgba(168,85,247,0.18))", width: "fit-content" }}
                      >
                        {maj.division}
                      </span>
                      {/*
                        ITEM PASS 7: order counts were previously ONLY in
                        the badge's hover `title` attribute (invisible
                        until hover) - the spec explicitly asks the
                        Experience page to "clearly show" Pharma order
                        count, Consumer order count, and total orders, not
                        just on hover. Now visible directly under the
                        badge as compact text; tooltip above is left in
                        place too as a redundant/no-harm extra.
                      */}
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>
                        {maj.consumer_orders} Consumer / {maj.pharma_orders} Pharma ({maj.total_orders} total)
                      </span>
                    </div>
                  ) : (
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>
                  )}
                </td>
                <td>{s.distinct_areas}</td>
                <td>{s.total_days}</td>
                <td>{s.most_recent_area}</td>
                <td>{s.most_recent_end}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <DetailWindow
          title={`Stint History — ${selected.name} (${selected.code})`}
          loading={detailLoading}
          columns={[
            { key: "area", label: "Area" },
            { key: "sector", label: "SAP Division" },
            { key: "experience_division", label: "Consumer/Pharma (Salesman-derived)" },
            { key: "vehicle", label: "Vehicle" },
            { key: "start_date", label: "Start" },
            { key: "end_date", label: "End" },
            { key: "days", label: "Days" },
          ]}
          rows={detail}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
