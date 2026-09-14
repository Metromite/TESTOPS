/**
 * widgets/leadTimeWidgets.tsx
 * Round -12: atomic widgets extracted from LeadTimeTab.tsx. The fastest/
 * longest KPI tiles open a Modal of rows that are ALREADY included in the
 * one `/dashboard/lead-time` response (fastest_detail/longest_detail) - no
 * separate fetch, so their modal state is just local component state, not
 * hook state (unlike Home's drill-down, which does a separate fetch).
 *
 * PHASE 11 REDESIGN NOTE: visuals only, same exports/props.
 *
 * EXCEL LEAD TIME DASHBOARD PARITY PASS: `LeadTimeData` now carries the two
 * extra fields backend/app/services/dashboard_kpis.py's compute_lead_time_tab
 * added - `band_classification_matrix` (the Excel workbook's "LEAD TIME x
 * CLASSIFICATION" pivot) and `available_bands`/`available_classifications`
 * (option lists for the two new Lead-Time-Dashboard-only slicers below).
 * `useLeadTimeData` now takes an optional `band`/`classification` pair -
 * intentionally NOT routed through the shared useDashboardQuery hook (which
 * every OTHER dashboard tab also calls), since extending that hook's shared
 * param set for a Lead-Time-only concern would touch every tab's fetch
 * dependency array for no reason. Everything else about it (api client,
 * dashboardFilterParams, the same in-memory dashboardCache) is reused as-is.
 */
import { useEffect, useRef, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useDashboardQuery } from "../hooks/useDashboardQuery";
import { api } from "../api/client";
import { getCached, setCached } from "../hooks/dashboardCache";
import { subscribeDashboardRefresh } from "../hooks/dashboardRefreshBus";
import { GlobalFilters, EMPTY_GLOBAL_FILTERS, dashboardFilterParams } from "../types/dashboardFilters";
import Modal from "../components/Modal";
import { GlassCard } from "../design-system/GlassCard";
import { GlassPanel } from "../design-system/GlassPanel";
import { GlassTable } from "../design-system/GlassTable";
import MultiSelectSlicer from "../components/MultiSelectSlicer";
import { GlassFilterBar } from "../design-system/GlassFilter";
import { CHART_PALETTE, chartGrid, chartAxisTick, chartAxisLine, GlassTooltip } from "../design-system/chartTheme";

export interface DetailRow { invoice_no: string; driver_name: string; customer_name: string; invoice_date: string; dispatch_date: string; days: number; }
export interface BandClassificationMatrix {
  classifications: string[];
  rows: { band: string; counts: Record<string, number>; total: number }[];
  col_totals: Record<string, number>;
  grand_total: number;
}
export interface LeadTimeData {
  kpis: { total_invoices: number; overall_avg_days: number | null; fastest_days: number | null; longest_days: number | null };
  by_classification: { name: string; orders: number; avg_days: number; min_days: number; max_days: number }[];
  distribution: { bins: string[]; counts: number[] };
  fastest_detail: DetailRow[]; longest_detail: DetailRow[];
  band_classification_matrix: BandClassificationMatrix;
  available_bands: string[];
  available_classifications: string[];
}

/** Lead Time Dashboard's own two slicers (Lead Time Band, Classification)
 * now live on the shared GlobalFilters object (Dashboard.tsx owns them,
 * same as every other slicer - see dashboardFilters.ts) - so this hook is
 * back to being a thin wrapper, fetched the same way every other
 * dashboard endpoint already is (api client + dashboardCache), just not
 * through the literal shared useDashboardQuery hook, since that hook's
 * dependency array is hand-listed per-field and extending it for two
 * fields only this tab and Export care about would touch every tab's
 * fetch timing for no reason. */
export function useLeadTimeData(driver: string, globalFilters?: GlobalFilters) {
  const gf = globalFilters || EMPTY_GLOBAL_FILTERS;
  const params = new URLSearchParams(dashboardFilterParams(driver, gf));
  const cacheKey = `/dashboard/lead-time?${params.toString()}`;
  const [data, setData] = useState<LeadTimeData | null>(() => getCached<LeadTimeData>(cacheKey) ?? null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const d: LeadTimeData = await api.get(`/dashboard/lead-time?${params.toString()}`);
      setData(d);
      setCached(cacheKey, d);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver, gf.drivers, gf.areas, gf.division, gf.route_type,
      gf.vehicle_type, gf.facility_type, gf.salesman, gf.start_date, gf.end_date,
      gf.lead_time_band, gf.classification]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => subscribeDashboardRefresh(() => loadRef.current()), []);

  return { data, error };
}

/** Lead Time Band + Classification slicer bar - the two filters at
 * minimum required to affect the Lead Time Dashboard's own KPIs/charts/
 * tables, on top of the existing Dispatch Date (Global Filters date
 * range, unchanged) and every other Global Filters slicer. */
export function LeadTimeFilterBar({
  data, band, setBand, classification, setClassification,
}: {
  data: LeadTimeData; band: string; setBand: (v: string) => void;
  classification: string; setClassification: (v: string) => void;
}) {
  return (
    <GlassFilterBar className="mb-4">
      <MultiSelectSlicer
        label="Lead Time Band" options={data.available_bands}
        selected={band ? [band] : []}
        onChange={(next) => setBand(next[next.length - 1] || "")}
      />
      <MultiSelectSlicer
        label="Classification" options={data.available_classifications}
        selected={classification ? [classification] : []}
        onChange={(next) => setClassification(next[next.length - 1] || "")}
      />
    </GlassFilterBar>
  );
}

function DetailModal({ kind, rows, onClose }: { kind: "fastest" | "longest"; rows: DetailRow[]; onClose: () => void }) {
  return (
    <Modal title={kind === "fastest" ? "Fastest Invoices" : "Longest Lead Time Invoices"} onClose={onClose}>
      <GlassTable.Wrap>
        <GlassTable.Root>
          <GlassTable.Header>
            <tr><GlassTable.Th>Invoice</GlassTable.Th><GlassTable.Th>Driver</GlassTable.Th><GlassTable.Th>Customer</GlassTable.Th><GlassTable.Th>Invoice Date</GlassTable.Th><GlassTable.Th>Dispatch Date</GlassTable.Th><GlassTable.Th>Days</GlassTable.Th></tr>
          </GlassTable.Header>
          <GlassTable.Body>
            {rows.map((r, i) => (
              <tr key={i}>
                <GlassTable.Td>{r.invoice_no}</GlassTable.Td><GlassTable.Td>{r.driver_name}</GlassTable.Td><GlassTable.Td>{r.customer_name}</GlassTable.Td>
                <GlassTable.Td>{r.invoice_date}</GlassTable.Td><GlassTable.Td>{r.dispatch_date}</GlassTable.Td>
                <GlassTable.Td className="font-mono font-bold tabular-nums">{r.days}</GlassTable.Td>
              </tr>
            ))}
          </GlassTable.Body>
        </GlassTable.Root>
      </GlassTable.Wrap>
    </Modal>
  );
}

function KpiTile({ value, label, onClick }: { value: string | number; label: string; onClick?: () => void }) {
  return (
    <GlassCard interactive={!!onClick} onClick={onClick} padding="md" className="flex flex-col gap-1.5">
      <span className="font-mono text-[26px] font-bold leading-none tabular-nums text-[var(--teal)]">{value}</span>
      <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{label}</span>
    </GlassCard>
  );
}

export function TotalInvoicesKpi({ data }: { data: LeadTimeData }) {
  return <KpiTile value={data.kpis.total_invoices} label="Total Invoices" />;
}
export function OverallAvgKpi({ data }: { data: LeadTimeData }) {
  return <KpiTile value={data.kpis.overall_avg_days ?? "N/A"} label="Overall Avg Lead Time" />;
}
export function FastestKpi({ data }: { data: LeadTimeData }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <KpiTile value={data.kpis.fastest_days ?? "N/A"} label="Fastest (days)" onClick={() => setOpen(true)} />
      {open && <DetailModal kind="fastest" rows={data.fastest_detail} onClose={() => setOpen(false)} />}
    </>
  );
}
export function LongestKpi({ data }: { data: LeadTimeData }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <KpiTile value={data.kpis.longest_days ?? "N/A"} label="Longest (days)" onClick={() => setOpen(true)} />
      {open && <DetailModal kind="longest" rows={data.longest_detail} onClose={() => setOpen(false)} />}
    </>
  );
}
export function AvgByClassificationChart({ data }: { data: LeadTimeData }) {
  return (
    <GlassPanel title="⏱ Avg Lead Time by Classification">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data.by_classification} layout="vertical">
          <CartesianGrid {...chartGrid} />
          <XAxis type="number" tick={chartAxisTick} axisLine={chartAxisLine} tickLine={false} />
          <YAxis type="category" dataKey="name" tick={chartAxisTick} axisLine={chartAxisLine} tickLine={false} width={100} />
          <Tooltip content={<GlassTooltip />} cursor={{ fill: "var(--row-hover)" }} />
          <Bar dataKey="avg_days" fill={CHART_PALETTE[1]} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </GlassPanel>
  );
}
export function DistributionChart({ data }: { data: LeadTimeData }) {
  // Excel-authoritative band labels ("0 Days"/"1 Day"/.../"More than 5
  // Days") come back as full strings from the backend now - no more
  // appending "day(s)" onto a raw numeric bin like "0"/"7+".
  const distChart = data.distribution.bins.map((b, i) => ({ name: b, count: data.distribution.counts[i] }));
  return (
    <GlassPanel title="📊 Lead Time Distribution">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={distChart}>
          <CartesianGrid {...chartGrid} />
          <XAxis dataKey="name" tick={chartAxisTick} axisLine={chartAxisLine} tickLine={false} />
          <YAxis tick={chartAxisTick} axisLine={chartAxisLine} tickLine={false} />
          <Tooltip content={<GlassTooltip />} cursor={{ fill: "var(--row-hover)" }} />
          <Bar dataKey="count" fill={CHART_PALETTE[0]} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </GlassPanel>
  );
}
export function ByClassificationTable({ data }: { data: LeadTimeData }) {
  return (
    <GlassPanel title="By Classification" bodyClassName="-mx-1">
      <GlassTable.Wrap>
        <GlassTable.Root>
          <GlassTable.Header>
            <tr><GlassTable.Th>Classification</GlassTable.Th><GlassTable.Th>Orders</GlassTable.Th><GlassTable.Th>Avg Days</GlassTable.Th><GlassTable.Th>Min</GlassTable.Th><GlassTable.Th>Max</GlassTable.Th></tr>
          </GlassTable.Header>
          <GlassTable.Body>
            {data.by_classification.map((c) => (
              <tr key={c.name}>
                <GlassTable.Td>{c.name}</GlassTable.Td>
                <GlassTable.Td className="font-mono tabular-nums">{c.orders}</GlassTable.Td>
                <GlassTable.Td className="font-mono tabular-nums">{c.avg_days}</GlassTable.Td>
                <GlassTable.Td className="font-mono tabular-nums">{c.min_days}</GlassTable.Td>
                <GlassTable.Td className="font-mono tabular-nums">{c.max_days}</GlassTable.Td>
              </tr>
            ))}
          </GlassTable.Body>
        </GlassTable.Root>
      </GlassTable.Wrap>
    </GlassPanel>
  );
}

/** Excel's "LEAD TIME x CLASSIFICATION" pivot: rows = Lead Time Band,
 * columns = Classification, cells = order count, with row/column/grand
 * totals - not previously implemented in the app. */
export function BandClassificationMatrixTable({ data }: { data: LeadTimeData }) {
  const m = data.band_classification_matrix;
  if (!m.classifications.length) return null;
  return (
    <GlassPanel title="Lead Time × Classification" bodyClassName="-mx-1">
      <GlassTable.Wrap>
        <GlassTable.Root>
          <GlassTable.Header>
            <tr>
              <GlassTable.Th>Lead Time</GlassTable.Th>
              {m.classifications.map((c) => <GlassTable.Th key={c}>{c}</GlassTable.Th>)}
              <GlassTable.Th>Total</GlassTable.Th>
            </tr>
          </GlassTable.Header>
          <GlassTable.Body>
            {m.rows.map((row) => (
              <tr key={row.band}>
                <GlassTable.Td>{row.band}</GlassTable.Td>
                {m.classifications.map((c) => (
                  <GlassTable.Td key={c} className="font-mono tabular-nums">{row.counts[c] ?? 0}</GlassTable.Td>
                ))}
                <GlassTable.Td className="font-mono font-bold tabular-nums">{row.total}</GlassTable.Td>
              </tr>
            ))}
            <tr>
              <GlassTable.Td className="font-bold">Total</GlassTable.Td>
              {m.classifications.map((c) => (
                <GlassTable.Td key={c} className="font-mono font-bold tabular-nums">{m.col_totals[c] ?? 0}</GlassTable.Td>
              ))}
              <GlassTable.Td className="font-mono font-bold tabular-nums">{m.grand_total}</GlassTable.Td>
            </tr>
          </GlassTable.Body>
        </GlassTable.Root>
      </GlassTable.Wrap>
    </GlassPanel>
  );
}

function withLeadTimeData<P extends { data: LeadTimeData }>(Comp: (p: P) => JSX.Element | null) {
  return function Standalone({ driver = "", globalFilters, ...rest }: { driver?: string; globalFilters?: GlobalFilters } & Omit<P, "data">) {
    const { data, error } = useLeadTimeData(driver, globalFilters);
    if (error) return <div className="glass-card error-text">{error}</div>;
    if (!data) return <div>Loading...</div>;
    return <Comp {...(rest as unknown as P)} data={data} />;
  };
}
export const StandaloneTotalInvoicesKpi = withLeadTimeData(TotalInvoicesKpi);
export const StandaloneOverallAvgKpi = withLeadTimeData(OverallAvgKpi);
export const StandaloneFastestKpi = withLeadTimeData(FastestKpi);
export const StandaloneLongestKpi = withLeadTimeData(LongestKpi);
export const StandaloneAvgByClassificationChart = withLeadTimeData(AvgByClassificationChart);
export const StandaloneDistributionChart = withLeadTimeData(DistributionChart);
export const StandaloneByClassificationTable = withLeadTimeData(ByClassificationTable);
export const StandaloneBandClassificationMatrixTable = withLeadTimeData(BandClassificationMatrixTable);

