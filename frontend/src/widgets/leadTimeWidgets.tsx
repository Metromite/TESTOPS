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

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useEffect, useState } from "react";
import { useDashboardLocalData } from "../hooks/useDashboardLocalData";
import DetailWindow from "../components/DetailWindow";
import { buildLocalLeadTimeDetails, filterDashboardRows, getDashboardLocalDataset } from "../services/dashboardLocalStore";



import type { GlobalFilters } from "../types/dashboardFilters";
import { GlassCard } from "../design-system/GlassCard";
import { GlassPanel } from "../design-system/GlassPanel";
import { GlassTable } from "../design-system/GlassTable";
import MultiSelectSlicer from "../components/MultiSelectSlicer";
import { GlassFilterBar } from "../design-system/GlassFilter";
import { CHART_PALETTE, chartGrid, chartAxisTick, chartAxisLine, GlassTooltip, ChartPanel, chartBarProps } from "../design-system/chartTheme";
import { Timer, BarChart3 } from "lucide-react";

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
  return useDashboardLocalData<LeadTimeData>("/dashboard/lead-time", globalFilters, driver);
}

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

function LeadTimeDetailModal({
  kind,
  driver,
  globalFilters,
  data,
  onClose,
}: {
  kind: "fastest" | "longest";
  driver: string;
  globalFilters?: GlobalFilters;
  data: LeadTimeData;
  onClose: () => void;
}) {
  const initialRows = kind === "fastest" ? data.fastest_detail : data.longest_detail;
  const [rows, setRows] = useState<DetailRow[]>(() => initialRows);
  const [loading, setLoading] = useState(initialRows.length === 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [total, setTotal] = useState(initialRows.length);
  const [offset, setOffset] = useState(initialRows.length);

  const effectiveFilters: GlobalFilters = {
    ...(globalFilters || {
      drivers: "", areas: "", division: "", route_type: "", vehicle_type: "",
      facility_type: "", salesman: "", start_date: "", end_date: "",
      lead_time_band: "", classification: "",
    }),
    drivers: driver
      ? [...new Set([driver, ...String(globalFilters?.drivers || "").split(",").map((x) => x.trim()).filter(Boolean)])].join(",")
      : String(globalFilters?.drivers || ""),
  };

  function loadBatch(nextOffset: number, append: boolean) {
    const dataset = getDashboardLocalDataset();
    if (!dataset) {
      setLoading(false);
      return;
    }

    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const filtered = filterDashboardRows(dataset, effectiveFilters);
      const result = buildLocalLeadTimeDetails(filtered, effectiveFilters, kind, nextOffset, 100);
      setRows((prev) => append ? [...prev, ...result.rows] : result.rows);
      setOffset(nextOffset + result.rows.length);
      setTruncated(result.truncated);
      setTotal(result.total);
    } finally {
      if (append) setLoadingMore(false); else setLoading(false);
    }
  }

  // The KPI data already contains the exact first 100 Lead Time rows used by
  // the visible card. Use those rows immediately so opening the popup cannot
  // lose the data while re-reading the local dataset. Additional rows still
  // come from the same local dataset in 100-row batches.
  useEffect(() => {
    const dataset = getDashboardLocalDataset();
    if (!dataset) {
      setLoading(false);
      return;
    }
    const filtered = filterDashboardRows(dataset, effectiveFilters);
    const result = buildLocalLeadTimeDetails(filtered, effectiveFilters, kind, 0, 100);
    setTotal(result.total);
    setTruncated(initialRows.length < result.total);
    if (!initialRows.length && result.rows.length) {
      setRows(result.rows);
      setOffset(result.rows.length);
    }
    setLoading(false);
  // The popup is mounted for one specific KPI/filter state; don't reset its
  // loaded rows on parent re-renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <DetailWindow
      title={kind === "fastest" ? "Fastest Invoices" : "Longest Lead Time Invoices"}
      columns={[
        { key: "invoice_no", label: "Invoice" },
        { key: "driver_name", label: "Driver" },
        { key: "customer_name", label: "Customer" },
        { key: "invoice_date", label: "Invoice Date" },
        { key: "dispatch_date", label: "Dispatch Date" },
        { key: "days", label: "Days" },
      ]}
      rows={rows}
      loading={loading}
      loadingMore={loadingMore}
      truncated={truncated}
      totalMatching={total}
      onLoadMore={() => {
        if (!loadingMore && truncated) loadBatch(offset, true);
      }}
      onClose={onClose}
    />
  );
}

function KpiTile({ value, label, onClick }: { value: string | number; label: string; onClick?: () => void }) {
  return (
    <GlassCard interactive={!!onClick} onClick={onClick} padding="md" className="flex flex-col gap-1.5">
      <span className="font-mono text-[26px] font-bold leading-none tabular-nums text-[var(--purple)]">{value}</span>
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
export function FastestKpi({ data, driver = "", globalFilters }: { data: LeadTimeData; driver?: string; globalFilters?: GlobalFilters }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <KpiTile value={data.kpis.fastest_days ?? "N/A"} label="Fastest (days)" onClick={() => setOpen(true)} />
      {open && <LeadTimeDetailModal kind="fastest" driver={driver} globalFilters={globalFilters} data={data} onClose={() => setOpen(false)} />}
    </>
  );
}
export function LongestKpi({ data, driver = "", globalFilters }: { data: LeadTimeData; driver?: string; globalFilters?: GlobalFilters }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <KpiTile value={data.kpis.longest_days ?? "N/A"} label="Longest (days)" onClick={() => setOpen(true)} />
      {open && <LeadTimeDetailModal kind="longest" driver={driver} globalFilters={globalFilters} data={data} onClose={() => setOpen(false)} />}
    </>
  );
}
export function AvgByClassificationChart({ data }: { data: LeadTimeData }) {
  return (
    <ChartPanel title="Avg Lead Time by Classification" icon={Timer}>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data.by_classification} layout="vertical">
          <CartesianGrid {...chartGrid} />
          <XAxis type="number" tick={chartAxisTick} axisLine={chartAxisLine} tickLine={false} />
          <YAxis type="category" dataKey="name" tick={chartAxisTick} axisLine={chartAxisLine} tickLine={false} width={100} />
          <Tooltip content={<GlassTooltip />} cursor={{ fill: "var(--row-hover)" }} />
          <Bar dataKey="avg_days" fill={CHART_PALETTE[1]} {...chartBarProps} />
        </BarChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}
export function DistributionChart({ data }: { data: LeadTimeData }) {
  // Excel-authoritative band labels ("0 Days"/"1 Day"/.../"More than 5
  // Days") come back as full strings from the backend now - no more
  // appending "day(s)" onto a raw numeric bin like "0"/"7+".
  const distChart = data.distribution.bins.map((b, i) => ({ name: b, count: data.distribution.counts[i] }));
  return (
    <ChartPanel title="Lead Time Distribution" icon={BarChart3}>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={distChart}>
          <CartesianGrid {...chartGrid} />
          <XAxis dataKey="name" tick={chartAxisTick} axisLine={chartAxisLine} tickLine={false} />
          <YAxis tick={chartAxisTick} axisLine={chartAxisLine} tickLine={false} />
          <Tooltip content={<GlassTooltip />} cursor={{ fill: "var(--row-hover)" }} />
          <Bar dataKey="count" fill={CHART_PALETTE[0]} {...chartBarProps} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartPanel>
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
    return <Comp {...({ ...(rest as unknown as P), data, driver, globalFilters } as P)} />;
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
