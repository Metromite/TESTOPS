import { useEffect, useState, FormEvent, KeyboardEvent } from "react";
import { api, getRole } from "../api/client";
import AutocompleteInput from "../components/AutocompleteInput";
import { getOptionIcon } from "@/lib/domainIcons";
import { Hash, MapPinned, Building2, User, Users, Tag, ListFilter } from "lucide-react";

// ITEM 15 (Dashboard Configuration rule engine expansion): added driver,
// vehicle_type, route_type, invoice_range as enforced rule types (see
// backend/app/models/dashboard_config.py's module docstring for exactly
// how each one is matched, including the vehicle_type/route_type
// Areas-Database join). invoice_type/custom stay saved-but-unenforced,
// same as before this change - still no matching column for either.
const RULE_TYPES = [
  { value: "invoice_prefix", label: "Invoice numbers starting with…", enforced: true, icon: Hash },
  { value: "invoice_range", label: "Invoice number range (e.g. 100000-100999)", enforced: true, icon: Hash },
  { value: "area", label: "Exclude Area", enforced: true, icon: MapPinned },
  { value: "customer", label: "Exclude Customer", enforced: true, icon: Building2 },
  { value: "driver", label: "Exclude Driver", enforced: true, icon: User },
  { value: "salesman", label: "Exclude Salesman", enforced: true, icon: Users },
  { value: "facility", label: "Exclude Facility Type", enforced: true, icon: Building2 },
  { value: "vehicle_type", label: "Exclude Vehicle Type", enforced: true, icon: Tag },
  { value: "route_type", label: "Exclude Route Type", enforced: true, icon: ListFilter },
  { value: "invoice_type", label: "Exclude Invoice Type", enforced: false, icon: Tag },
];

const OPERATORS = [
  { value: "contains", label: "Contains" },
  { value: "starts_with", label: "Starts With" },
  { value: "ends_with", label: "Ends With" },
  { value: "exact", label: "Exact Match" },
  { value: "regex", label: "Regex" },
];
// gt/lt intentionally not offered in the operator dropdown for normal
// rule types - they only make sense for invoice_range, which already
// has its own dedicated "START-END" value format and applies gt/lt
// internally rather than asking the admin to pick an operator for it.

// CRITICAL CORRECTION PASS items 1 & 7: both of these used to be
// user-togglable (default OFF), which meant SAP-only "drivers" and
// negative lead times leaked into the Dashboard whenever nobody had
// flipped the switch. They are now baseline data-integrity rules that
// the backend always enforces (see build_filtered_sap_query /
// compute_lead_time_tab in dashboard_kpis.py) - shown here as
// always-on status, not a checkbox anyone can turn off.
const ALWAYS_ON_SETTINGS: { value: string; label: string }[] = [
  { value: "exclude_negative_lead_times", label: "Negative lead times are excluded from every Lead Time calculation" },
  { value: "fleet_only_drivers", label: "Driver-level Dashboard data is restricted to the Fleet Database Drivers list" },
];

interface RuleRow { id: number; value: string; note: string; operator?: string; negate?: boolean; logic?: string }
interface RulesResponse { rules: Record<string, RuleRow[]>; enforced_types: string[] }

// Predictive-search wiring: only rule types with a matching backend
// /api/autocomplete/{field} get suggestions (see AutocompleteInput.tsx's
// header comment for the full supported-field list). "invoice_prefix",
// "facility", and "invoice_type" have no corresponding imported-data
// column to suggest from, so they keep the plain text input.
const AUTOCOMPLETE_FIELD: Partial<Record<string, string>> = {
  area: "area_name",
  customer: "customer",
  salesman: "salesman",
};

export default function DashboardConfigTab() {
  const [data, setData] = useState<RulesResponse>({ rules: {}, enforced_types: [] });
  const [ruleType, setRuleType] = useState("invoice_prefix");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [operator, setOperator] = useState("contains");
  const [negate, setNegate] = useState(false);
  const [logic, setLogic] = useState<"AND" | "OR">("OR");
  const [error, setError] = useState("");
  const canWrite = getRole() === "admin";

  async function load() {
    try {
      const res = await api.get("/dashboard/config-rules");
      setData(res);
    } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function addRule(e: FormEvent) {
    e.preventDefault(); setError("");
    if (ruleType !== "invoice_range" && !value.trim()) return;
    if (ruleType === "invoice_range" && !/^\d+\s*-\s*\d+$/.test(value.trim())) {
      setError('Invoice range must look like "100000-100999"'); return;
    }
    try {
      await api.post("/dashboard/config-rules", {
        rule_type: ruleType, value: value.trim(), note,
        operator: ruleType === "invoice_range" ? "contains" : operator,
        negate, logic,
      });
      setValue(""); setNote(""); load();
    } catch (e: any) { setError(e.message); }
  }
  async function deleteRule(id: number) {
    try { await api.del(`/dashboard/config-rules/${id}`); load(); } catch (e: any) { setError(e.message); }
  }

  if (!canWrite) {
    return <div className="glass-card" style={{ color: "var(--muted)" }}>Dashboard Configuration is Admin-only.</div>;
  }

  return (
    <div>
      <div className="glass-card" style={{ marginBottom: 20, color: "var(--muted)", fontSize: 13 }}>
        Permanent rules that exclude matching data from every Dashboard computation, applied automatically
        to every future import. Every rule type except "Exclude Invoice Type" is fully enforced. Each rule
        can use an operator (Contains / Starts With / Ends With / Exact / Regex), be inverted with NOT
        (keep only matching rows instead of excluding them), and combine with other rules of the same type
        using AND or OR. Rules of different types always combine with AND.
      </div>

      <form className="glass-card" onSubmit={addRule} style={{ marginBottom: 20, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
          Rule Type
          <select value={ruleType} onChange={(e) => setRuleType(e.target.value)}>
            {RULE_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}{!r.enforced ? " (not yet enforced)" : ""}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
          Value
          {AUTOCOMPLETE_FIELD[ruleType] ? (
            <AutocompleteInput
              field={AUTOCOMPLETE_FIELD[ruleType]!}
              value={value}
              onChange={setValue}
              placeholder="e.g. KIZAD, or 2 for invoice prefix"
            />
          ) : (
            <input required value={value} onChange={(e) => setValue(e.target.value)}
                   placeholder={ruleType === "invoice_range" ? "e.g. 100000-100999" : "e.g. KIZAD, or 2 for invoice prefix"} />
          )}
        </label>
        {ruleType !== "invoice_range" && ruleType !== "setting" && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
            Operator
            <select value={operator} onChange={(e) => setOperator(e.target.value)}>
              {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        )}
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
          Combine with other {RULE_TYPES.find((r) => r.value === ruleType)?.label.split(" ")[0] || ""} rules
          <select value={logic} onChange={(e) => setLogic(e.target.value as "AND" | "OR")}>
            <option value="OR">OR (any one matches)</option>
            <option value="AND">AND (all must match)</option>
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", paddingBottom: 8 }}>
          <input type="checkbox" checked={negate} onChange={(e) => setNegate(e.target.checked)} />
          NOT (invert - only KEEP matching rows instead of excluding them)
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this rule exists" />
        </label>
        <button className="btn" type="submit">Add Rule</button>
      </form>

      <div className="glass-card" style={{ marginBottom: 20 }}>
        <strong style={{ display: "block", marginBottom: 8 }}>Dashboard-wide Settings</strong>
        {ALWAYS_ON_SETTINGS.map((s) => (
          <div key={s.value} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 6, color: "var(--muted)" }}>
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 16, height: 16, borderRadius: 4, background: "var(--accent, #4f7cff)", color: "#fff", fontSize: 11,
            }}>✓</span>
            {s.label}
            <span style={{ fontSize: 11, opacity: 0.7 }}>(always enforced)</span>
          </div>
        ))}
      </div>

      {error && <div className="glass-card error-text" style={{ marginBottom: 20 }}>{error}</div>}

      {RULE_TYPES.map((rt) => {
        const rows = data.rules[rt.value] || [];
        if (rows.length === 0) return null;
        const RtIcon = rt.icon;
        return (
          <div key={rt.value} className="glass-card table-scroll" style={{ marginBottom: 16 }}>
            <strong style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <RtIcon className="h-4 w-4" /> {rt.label} {!rt.enforced && <span className="badge excluded">Not yet enforced</span>}
            </strong>
            <table className="data-table" style={{ marginTop: 10 }}>
              <thead><tr><th>Value</th><th>Operator</th><th>NOT</th><th>Logic</th><th>Note</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const OptIcon = getOptionIcon(rt.label, r.value, rt.icon);
                  return (
                    <tr key={r.id}>
                      <td style={{ display: "flex", alignItems: "center", gap: 6 }}><OptIcon className="h-3.5 w-3.5 text-muted" />{r.value}</td>
                      <td>{OPERATORS.find((o) => o.value === r.operator)?.label || "Contains"}</td>
                      <td>{r.negate ? "Yes" : "—"}</td>
                      <td>{r.logic || "OR"}</td>
                      <td>{r.note || "—"}</td>
                      <td><button className="btn" style={{ background: "var(--red)" }} onClick={() => deleteRule(r.id)}>Remove</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      <SalesmanCategorization />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Salesman Categorization (V2 milestone) - predictive autocomplete over
// salesmen auto-collected from every imported SAP Export (see
// services/master_data_learning.py), permanently assignable as "Consumer
// Salesman". Assigning/removing one retroactively recomputes Division
// Detection for every affected driver-day (see services/division_detection.py).
// ---------------------------------------------------------------------------
function SalesmanCategorization() {
  const [assigned, setAssigned] = useState<{ id: number; name: string; assigned_by: string }[]>([]);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<{ name: string; is_consumer: boolean }[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const [error, setError] = useState("");

  async function loadAssigned() {
    try { setAssigned(await api.get("/salesmen/consumer")); } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { loadAssigned(); }, []);

  useEffect(() => {
    if (!query.trim()) { setCandidates([]); return; }
    const handle = setTimeout(() => {
      api.get(`/salesmen/candidates?q=${encodeURIComponent(query)}`).then((c) => { setCandidates(c); setHighlighted(0); }).catch(() => {});
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  async function assign(name: string) {
    try {
      await api.post("/salesmen/consumer", { name });
      setQuery(""); setCandidates([]); loadAssigned();
    } catch (e: any) { setError(e.message); }
  }
  async function unassign(id: number) {
    try { await api.del(`/salesmen/consumer/${id}`); loadAssigned(); } catch (e: any) { setError(e.message); }
  }

  // BUGFIX (predictive search: "pressing Enter does not save"): the input
  // had no onKeyDown handler at all, so Enter did nothing regardless of
  // what was typed or suggested - the only way to assign a salesman was
  // clicking a suggestion with the mouse. Added: Up/Down moves a
  // highlighted selection through the candidate list (wrapping both
  // ways), and Enter assigns whichever candidate is currently
  // highlighted (defaulting to the top match) - matching normal
  // autocomplete keyboard behavior. Escape clears the suggestion list
  // without assigning anything.
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (candidates.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % candidates.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + candidates.length) % candidates.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = candidates[highlighted] ?? candidates[0];
      if (pick && !pick.is_consumer) assign(pick.name);
    } else if (e.key === "Escape") {
      setCandidates([]);
    }
  }

  return (
    <div className="glass-card" style={{ marginTop: 20 }}>
      <strong>Salesman Categorization</strong>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
        Salesmen are collected automatically from every imported SAP Export. Permanently assigning one as a
        Consumer Salesman means any invoice they handle counts toward that driver's Consumer-day tally in
        Division Detection, even if the invoice's own Division Description doesn't say so.
      </p>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 10 }}>
        <div style={{ position: "relative", maxWidth: 320, flex: 1 }}>
          <input
            placeholder="Search salesman name… (↑↓ to navigate, Enter to save)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {candidates.length > 0 && (
            // ITEM 8: z-index raised from 10 to 9999 to match the app-wide
            // dropdown elevation convention (MultiSelectSlicer, AutocompleteInput)
            // - at 10 this list could render visually behind neighboring glass
            // panels depending on stacking context, which reads as "autocomplete
            // doesn't work" even though keyboard/mouse/save (below) already do.
            <div className="glass-card" style={{ position: "absolute", zIndex: 9999, marginTop: 4, minWidth: "100%", maxHeight: 220, overflowY: "auto", padding: 4 }}>
              {candidates.map((c, i) => (
                <div key={c.name} onClick={() => !c.is_consumer && assign(c.name)} onMouseEnter={() => setHighlighted(i)}
                     style={{
                       padding: "5px 8px", cursor: c.is_consumer ? "default" : "pointer", fontSize: 13,
                       color: c.is_consumer ? "var(--muted)" : undefined,
                       background: i === highlighted && !c.is_consumer ? "var(--row-hover)" : undefined,
                       borderRadius: 6,
                     }}>
                  {c.name} {c.is_consumer && "— already assigned"}
                </div>
              ))}
            </div>
          )}
        </div>
        {/*
          BUGFIX ("no save button"): saving previously only happened via
          Enter or clicking a suggestion - correct, but not visibly
          discoverable as "saving" if you didn't already know that
          convention. Explicit button now does the same thing: saves
          whichever candidate is currently highlighted, falling back to
          the raw typed text if the dropdown hasn't returned results yet
          (e.g. a name that's an exact match but the debounce/candidates
          fetch is still catching up).
        */}
        <button
          className="btn"
          type="button"
          disabled={!query.trim()}
          onClick={() => {
            const pick = candidates[highlighted] ?? candidates[0];
            if (pick && !pick.is_consumer) assign(pick.name);
            else if (!pick && query.trim()) assign(query.trim());
          }}
        >
          Save
        </button>
      </div>

      {error && <div className="error-text" style={{ marginTop: 10 }}>{error}</div>}

      <table className="data-table" style={{ marginTop: 14 }}>
        <thead><tr><th>Consumer Salesman</th><th>Assigned By</th><th></th></tr></thead>
        <tbody>
          {assigned.length === 0 && <tr><td colSpan={3} style={{ color: "var(--muted)" }}>No Consumer Salesmen assigned yet.</td></tr>}
          {assigned.map((a) => (
            <tr key={a.id}>
              <td>{a.name}</td><td>{a.assigned_by || "—"}</td>
              <td><button className="btn" style={{ background: "var(--red)" }} onClick={() => unassign(a.id)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
