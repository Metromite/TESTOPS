import { ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassCard } from "./GlassCard";
import { fadeUp } from "./motion";

export interface GlassWidgetProps {
  label: string;
  value: ReactNode;
  description?: ReactNode;
  trend?: { value: number; label?: string } | null;
  icon?: ReactNode;
  accent?: "blue" | "teal" | "cyan" | "purple" | "amber" | "red" | "green";
  onClick?: () => void;
  className?: string;
}

const accentVar: Record<NonNullable<GlassWidgetProps["accent"]>, string> = {
  blue: "var(--blue2)",
  teal: "var(--teal)",
  cyan: "var(--cyan)",
  purple: "var(--purple)",
  amber: "var(--amber)",
  red: "var(--red)",
  green: "var(--green)",
};

/**
 * GlassWidget - the app's KPI card. Large tabular-figure value (JetBrains
 * Mono, so numbers stay legible and precisely aligned at dashboard/TV-kiosk
 * sizes), label, optional trend arrow, glass surface, subtle hover lift.
 */
export function GlassWidget({ label, value, description, trend, icon, accent = "blue", onClick, className }: GlassWidgetProps) {
  const isUp = trend && trend.value > 0;
  const isDown = trend && trend.value < 0;
  return (
    <motion.div {...fadeUp}>
      <GlassCard
        interactive={!!onClick}
        onClick={onClick}
        padding="md"
        className={cn("flex flex-col gap-2 text-left", className)}
      >
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] font-semibold uppercase tracking-wide text-muted">{label}</span>
          {icon && (
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ color: accentVar[accent], background: `color-mix(in srgb, ${accentVar[accent]} 14%, transparent)` }}
            >
              {icon}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[30px] font-bold tabular-nums leading-none" style={{ color: accentVar[accent] }}>
            {value}
          </span>
          {trend && (
            <span
              className={cn(
                "flex items-center gap-0.5 text-[12.5px] font-semibold",
                isUp && "text-[var(--green)]",
                isDown && "text-[var(--red)]",
                !isUp && !isDown && "text-muted"
              )}
            >
              {isUp ? <ArrowUpRight className="h-3.5 w-3.5" /> : isDown ? <ArrowDownRight className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
              {Math.abs(trend.value)}
              {trend.label ?? "%"}
            </span>
          )}
        </div>
        {description && <p className="text-[12.5px] leading-snug text-muted">{description}</p>}
      </GlassCard>
    </motion.div>
  );
}
