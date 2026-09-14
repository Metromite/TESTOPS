/**
 * pages/HomeTab.tsx (Overview)
 * Round -12: refactored to compose the atomic pieces in widgets/homeWidgets.tsx
 * instead of one large inline JSX tree. This page still owns exactly ONE
 * useHomeData() call (same as before this round) and passes that same data
 * down into the same presentational components Control Center's widget
 * library also uses standalone - so this page's rendering is unchanged,
 * not reimplemented, and there's no redundant fetching from decomposing it.
 *
 * PHASE 5-6 REDESIGN NOTE: visual layer only - same hook, same props,
 * same child components. Layout grid/spacing moved to Tailwind.
 */
import { useHomeData, useHomeKpisFast, METRIC_COLUMNS, DEFAULT_COLUMNS } from "../hooks/useHomeData";
import AvailabilityWidget from "../components/AvailabilityWidget";
import DetailWindow from "../components/DetailWindow";
import { GlobalFilters } from "../types/dashboardFilters";
import {
  HOME_KPI_DEFS, KpiTile, BoxesByDriverChart, FacilityDistributionChart,
  VehicleTypeChart, ReturnsChart, DriverOverviewTable,
} from "../widgets/homeWidgets";
import { GlassCard } from "../design-system/GlassCard";

interface Props {
  driver: string;
  onSelectDriver: (name: string) => void;
  onDriverListLoaded: (names: string[]) => void;
  globalFilters?: GlobalFilters;
}

/**
 * ITEM PASS 6 (Dashboard Part 1 - progressive loading): a lightweight,
 * zero-fetch skeleton for a KPI tile that hasn't resolved from either the
 * fast or full endpoint yet - NOT a spinner-as-the-fix, just something to
 * paint in that grid cell for the brief window before real data (fast or
 * full) actually arrives, so the KPI row's layout is stable immediately
 * rather than the whole row popping in later.
 */
function KpiTileSkeleton() {
  return (
    <div className="glass-card flex flex-col gap-2 p-4" aria-hidden="true">
      <span className="h-8 w-8 rounded-lg bg-[var(--navy3)] opacity-40" />
      <span className="h-6 w-16 rounded bg-[var(--navy3)] opacity-30" />
      <span className="h-3 w-20 rounded bg-[var(--navy3)] opacity-20" />
    </div>
  );
}

/** Same idea for the charts/table section while only the fast KPI data
 * (not the full response) has arrived yet. */
function SectionSkeleton({ label }: { label: string }) {
  return (
    <div className="glass-card flex h-[260px] items-center justify-center text-[12px] text-muted" aria-hidden="true">
      Loading {label}...
    </div>
  );
}

export default function HomeTab({ driver, onSelectDriver, onDriverListLoaded, globalFilters }: Props) {
  const { data, error, openDetail, closeDetail, detailMetric, detailTitle, detailRows, detailLoading, detailTruncated, detailTotal } =
    useHomeData(driver, globalFilters, onDriverListLoaded);
  // ITEM PASS 6: independent fast-KPI fetch, resolves well before the
  // full `data` above (see useHomeKpisFast's docstring). `data?.kpis`
  // always wins once it's in (it has the one field - avg_route_hours -
  // this fast path omits), `fastKpis` is only the bridge until then.
  const { kpis: fastKpis } = useHomeKpisFast(driver, globalFilters);
  const kpis = data?.kpis ?? fastKpis;

  if (error) return <GlassCard className="text-[var(--red)]">{error}</GlassCard>;

  return (
    <div className="flex flex-col gap-5">
      <AvailabilityWidget />
      {/*
        ITEM PASS 6 (Dashboard Part 1 - "PHASE 1/2": shell + KPIs appear
        before charts/tables): this grid now renders unconditionally -
        each tile independently shows real data (from `kpis`, whichever
        of fast/full has resolved) or its own skeleton, rather than the
        entire Overview page waiting on `data` before showing anything at
        all. Once `kpis` exists (fast endpoint usually wins the race),
        every tile has real numbers; `openDetail` still requires the full
        `data` to have loaded (it needs driver_overview for the not-yet-
        clicked metrics list), so click handlers only attach once `data`
        is ready - clicking a tile before then simply isn't wired yet,
        exactly like it wasn't reachable at all before this change.
      */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {HOME_KPI_DEFS.map((def) => kpis ? (
          <KpiTile key={def.key} icon={def.icon} label={def.label} value={def.getValue(kpis)}
            onClick={data && def.metric ? () => openDetail(def.metric!, def.label) : undefined} />
        ) : (
          <KpiTileSkeleton key={def.key} />
        ))}
      </div>

      {detailMetric && (
        <DetailWindow
          title={detailTitle}
          columns={METRIC_COLUMNS[detailMetric] || DEFAULT_COLUMNS}
          rows={detailRows}
          loading={detailLoading}
          truncated={detailTruncated}
          totalMatching={detailTotal}
          onClose={closeDetail}
        />
      )}

      {/*
        ITEM PASS 6 ("PHASE 3": heavier content loads independently):
        charts/table need the full `data` response (driver_overview +
        charts aren't part of the fast KPI payload at all) - while it's
        still in flight, each section shows its own skeleton instead of
        blocking the KPIs/shell above, which are already visible.
      */}
      {data ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BoxesByDriverChart data={data} />
          <FacilityDistributionChart data={data} />
          <VehicleTypeChart data={data} />
          <ReturnsChart data={data} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SectionSkeleton label="Boxes by Driver" />
          <SectionSkeleton label="Facility Distribution" />
          <SectionSkeleton label="Vehicle Types" />
          <SectionSkeleton label="Delivered vs Not Supplied" />
        </div>
      )}

      {data ? (
        <DriverOverviewTable data={data} driver={driver} onSelectDriver={onSelectDriver} />
      ) : (
        <SectionSkeleton label="Driver Overview" />
      )}

      <p className="text-[12px] text-muted">
        Overview tab - ported from V1's dashboard.html exactly (KPIs, Driver Overview, and these 4 charts).
      </p>
    </div>
  );
}
