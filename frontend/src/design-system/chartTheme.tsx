import { ReactNode } from "react";
import { BarChart3, type LucideIcon } from "lucide-react";
import { GlassPanel } from "./GlassPanel";

/**
 * Chart palette references the same CSS custom properties as the rest of
 * the app (var(--blue2), var(--teal), ...) rather than hardcoded hex, so
 * charts automatically re-theme with dark/light/high-contrast/custom
 * background instead of staying frozen to whichever theme they were
 * designed against. SVG fill/stroke attributes support css var() in all
 * current evergreen browsers.
 */
export const CHART_PALETTE = [
  "var(--blue2)",
  "var(--teal)",
  "var(--amber)",
  "var(--purple)",
  "var(--cyan)",
  "var(--red)",
  "var(--green)",
  "var(--blue)",
];


export function ChartPanel({
  title,
  icon: Icon = BarChart3,
  actions,
  description,
  bodyClassName,
  className,
  children,
}: {
  title: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  description?: ReactNode;
  bodyClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <GlassPanel
      title={
        <span className="dispatch-chart-title">
          <span className="dispatch-chart-title-icon"><Icon size={15} strokeWidth={1.8} /></span>
          <span className="truncate">{title}</span>
        </span>
      }
      description={description}
      actions={actions}
      bodyClassName={bodyClassName}
      className={`dispatch-chart-panel ${className || ""}`}
    >
      {children}
    </GlassPanel>
  );
}

export const chartBarProps = {
  radius: [0, 5, 5, 0] as [number, number, number, number],
  activeBar: { opacity: 0.82 },
};

export const chartGrid = {
  stroke: "var(--border)",
  strokeDasharray: "3 6",
  vertical: false,
};

export const chartAxisTick = { fontSize: 11, fill: "var(--muted)" };
export const chartAxisLine = { stroke: "var(--border)" };

/**
 * GlassTooltip - drop into any Recharts <Tooltip content={<GlassTooltip />} />.
 * Matches the app's glass-card surface instead of Recharts' plain white
 * default box, and keeps numbers in the mono/tabular type role.
 */
export function GlassTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  label?: string;
  payload?: { name?: string; value?: number | string; color?: string; dataKey?: string | number }[];
  formatter?: (value: number, name: string) => ReactNode | [ReactNode, ReactNode];
}) {
  if (!active || !payload || !payload.length) return null;
  return (
    // CHART READABILITY FIX: bumped from bg-[var(--navy2)]/95 to fully
    // opaque (no alpha) - a tooltip's only job is quick number readability
    // on hover, so unlike big glass panels (where translucency is
    // intentional) it should never have ANY of the chart bleeding through
    // behind the numbers.
    <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--navy2)] px-3 py-2 text-[12.5px] shadow-elevation2">
      {label && <div className="mb-1 font-semibold text-ink">{label}</div>}
      <div className="flex flex-col gap-0.5">
        {payload.map((p, i) => {
          const formatted = formatter && p.value !== undefined ? formatter(Number(p.value), String(p.name)) : null;
          const [fLabel, fValue] = Array.isArray(formatted) ? formatted : [p.name, formatted ?? p.value];
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="text-muted">{fLabel}</span>
              <span className="ml-auto font-mono font-semibold tabular-nums text-ink">{fValue}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
