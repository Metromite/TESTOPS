/**
 * widgets/registry.tsx
 * ----------------------
 * Round -12: the single manifest Control Center's widget library UI reads
 * from. Every entry here is a standalone (self-fetching) component from
 * one of the widgets/*.tsx files above - same calculation as its source
 * page, just individually addable.
 *
 * Categories: "kpi" | "chart" | "table" | "page" - "page" covers the
 * pages that were NOT decomposed further this round (see the note on each
 * below) plus every original whole-page card from rounds -7/-8, kept for
 * anyone who still wants "the whole Overview page" as one card instead of
 * assembling it from 17 individual pieces.
 */
import { ReactNode } from "react";
import {
  StandaloneHomeKpiWidget, StandaloneAvailabilityWidget, StandaloneBoxesByDriverChart,
  StandaloneFacilityDistributionChart, StandaloneVehicleTypeChart, StandaloneReturnsChart,
  StandaloneDriverOverviewTable, HOME_KPI_DEFS,
} from "./homeWidgets";
import {
  StandaloneDpKpiWidget, StandaloneStopsPerDriverChart, StandaloneRouteDurationChart,
  StandaloneRouteDetailTable, DP_KPI_DEFS,
} from "./driverPerformanceWidgets";
import {
  StandaloneTotalInvoicesKpi, StandaloneOverallAvgKpi, StandaloneFastestKpi, StandaloneLongestKpi,
  StandaloneAvgByClassificationChart, StandaloneDistributionChart, StandaloneByClassificationTable,
} from "./leadTimeWidgets";
import { StandaloneOrderSummaryTable } from "./orderSummaryWidgets";
import { StandaloneOrdersByAreaChart, StandaloneByAreaTable, StandaloneWeeklyByAreaTable } from "./areaAnalyticsWidgets";
import { StandaloneNotSuppliedTable, StandaloneZeroBoxTable } from "./notSuppliedWidgets";
import { TotalAliasesKpi, ConfirmedAliasesKpi, AliasListWidget } from "./customerIntelligenceWidgets";

export type WidgetCategory = "kpi" | "chart" | "table" | "page";

export interface WidgetDef {
  id: string;
  label: string;
  category: WidgetCategory;
  pageLabel: string; // which original page/section this came from, for grouping in the library UI
  render: () => ReactNode;
}

const homeKpiWidgets: WidgetDef[] = HOME_KPI_DEFS.map((def) => ({
  id: `home-kpi-${def.key}`, label: def.label, category: "kpi", pageLabel: "Overview",
  render: () => <StandaloneHomeKpiWidget metricKey={def.key} />,
}));
const dpKpiWidgets: WidgetDef[] = DP_KPI_DEFS.map((def) => ({
  id: `dp-kpi-${def.key}`, label: def.label, category: "kpi", pageLabel: "Driver Performance",
  render: () => <StandaloneDpKpiWidget metricKey={def.key} />,
}));

export const WIDGET_REGISTRY: WidgetDef[] = [
  // Overview (Home) - 12 KPIs + availability + 4 charts + 1 table
  ...homeKpiWidgets,
  { id: "home-availability", label: "Driver/Helper Availability", category: "kpi", pageLabel: "Overview", render: () => <StandaloneAvailabilityWidget /> },
  { id: "home-chart-boxes-by-driver", label: "Boxes by Driver", category: "chart", pageLabel: "Overview", render: () => <StandaloneBoxesByDriverChart /> },
  { id: "home-chart-facility", label: "Facility Distribution", category: "chart", pageLabel: "Overview", render: () => <StandaloneFacilityDistributionChart /> },
  { id: "home-chart-vehicle-type", label: "Units by Vehicle Type", category: "chart", pageLabel: "Overview", render: () => <StandaloneVehicleTypeChart /> },
  { id: "home-chart-returns", label: "Delivered vs Not Supplied", category: "chart", pageLabel: "Overview", render: () => <StandaloneReturnsChart /> },
  { id: "home-table-driver-overview", label: "Driver Overview", category: "table", pageLabel: "Overview", render: () => <StandaloneDriverOverviewTable /> },

  // Driver Performance - 4 KPIs + 2 charts + 1 table
  ...dpKpiWidgets,
  { id: "dp-chart-stops", label: "Stops per Driver", category: "chart", pageLabel: "Driver Performance", render: () => <StandaloneStopsPerDriverChart /> },
  { id: "dp-chart-hours", label: "Route Duration (hrs)", category: "chart", pageLabel: "Driver Performance", render: () => <StandaloneRouteDurationChart /> },
  { id: "dp-table-route-detail", label: "Route Detail", category: "table", pageLabel: "Driver Performance", render: () => <StandaloneRouteDetailTable /> },

  // Lead Time - 4 KPIs + 2 charts + 1 table
  { id: "lt-kpi-total", label: "Total Invoices", category: "kpi", pageLabel: "Lead Time", render: () => <StandaloneTotalInvoicesKpi /> },
  { id: "lt-kpi-avg", label: "Overall Avg Lead Time", category: "kpi", pageLabel: "Lead Time", render: () => <StandaloneOverallAvgKpi /> },
  { id: "lt-kpi-fastest", label: "Fastest (days)", category: "kpi", pageLabel: "Lead Time", render: () => <StandaloneFastestKpi /> },
  { id: "lt-kpi-longest", label: "Longest (days)", category: "kpi", pageLabel: "Lead Time", render: () => <StandaloneLongestKpi /> },
  { id: "lt-chart-classification", label: "Avg Lead Time by Classification", category: "chart", pageLabel: "Lead Time", render: () => <StandaloneAvgByClassificationChart /> },
  { id: "lt-chart-distribution", label: "Lead Time Distribution", category: "chart", pageLabel: "Lead Time", render: () => <StandaloneDistributionChart /> },
  { id: "lt-table-classification", label: "By Classification", category: "table", pageLabel: "Lead Time", render: () => <StandaloneByClassificationTable /> },

  // Order Summary - 1 table
  { id: "os-table", label: "Orders by Driver × Facility Type", category: "table", pageLabel: "Order Summary", render: () => <StandaloneOrderSummaryTable /> },

  // Area Analytics - 1 chart + 2 tables
  { id: "aa-chart", label: "Orders by Area", category: "chart", pageLabel: "Area Analytics", render: () => <StandaloneOrdersByAreaChart /> },
  { id: "aa-table", label: "By Area", category: "table", pageLabel: "Area Analytics", render: () => <StandaloneByAreaTable /> },
  { id: "aa-table-weekly", label: "Weekly by Area", category: "table", pageLabel: "Area Analytics", render: () => <StandaloneWeeklyByAreaTable /> },

  // Not Supplied - 2 tables
  { id: "ns-table", label: "Not Supplied", category: "table", pageLabel: "Not Supplied", render: () => <StandaloneNotSuppliedTable /> },
  { id: "ns-table-zero", label: "Zero Boxes", category: "table", pageLabel: "Not Supplied", render: () => <StandaloneZeroBoxTable /> },

  // Customer Intelligence - 2 KPIs (the alias list itself is registered as
  // a "page"-category widget below, since it's one cohesive search+list
  // unit, same reasoning as Experience/Route Intelligence)
  { id: "ci-kpi-total", label: "Total Aliases Learned", category: "kpi", pageLabel: "Customer Intelligence", render: () => <TotalAliasesKpi /> },
  { id: "ci-kpi-confirmed", label: "Confirmed More Than Once", category: "kpi", pageLabel: "Customer Intelligence", render: () => <ConfirmedAliasesKpi /> },
  { id: "ci-alias-list", label: "Alias Search & List", category: "table", pageLabel: "Customer Intelligence", render: () => <AliasListWidget /> },
];

export const WIDGET_CATEGORIES: { key: WidgetCategory; label: string }[] = [
  { key: "kpi", label: "KPIs & Metrics" },
  { key: "chart", label: "Charts" },
  { key: "table", label: "Tables" },
];
