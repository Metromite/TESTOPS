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
    <div className="mb-5 flex flex-wrap gap-1.5 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2 backdrop-blur-glass">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "relative rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors duration-150",
            active === t.key ? "text-white" : "text-muted hover:text-ink hover:bg-[var(--row-hover)]"
          )}
        >
          {active === t.key && (
            <motion.span
              layoutId="dashboard-tab-pill"
              className="absolute inset-0 -z-10 rounded-lg bg-[var(--blue)]"
              transition={{ type: "spring", stiffness: 500, damping: 38 }}
            />
          )}
          {t.label}
        </button>
      ))}
    </div>
  );
}
