import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface Tab { key: string; label: string; }

/**
 * DashboardTabs - same sliding "liquid" active-pill pattern as TopNav
 * (Framer Motion layoutId), scoped to its own tab strip so it doesn't
 * fight the nav bar's indicator.
 */
export default function DashboardTabs({ tabs, active, onChange }: { tabs: Tab[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="dashboard-tabs mb-5 flex w-full min-w-0 flex-wrap items-center gap-1.5 overflow-x-auto rounded-[18px] border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2 backdrop-blur-glass backdrop-saturate-[180%] shadow-[var(--elevation-1)]">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "relative flex shrink-0 items-center gap-1.5 rounded-[11px] px-3.5 py-2 text-[13px] font-semibold transition-colors duration-150",
            active === t.key ? "text-white" : "text-muted hover:text-ink hover:bg-[var(--row-hover)]"
          )}
        >
          {active === t.key && (
            <motion.span
              layoutId="dashboard-tab-pill"
              className="absolute inset-0 -z-10 rounded-lg bg-[var(--blue)]"
              transition={{ type: "spring", stiffness: 520, damping: 30 }}
            />
          )}
          {t.label}
        </button>
      ))}
    </div>
  );
}
