import { cn } from "@/lib/utils";

interface Tab { key: string; label: string; }

export default function DashboardTabs({ tabs, active, onChange }: { tabs: Tab[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="dashboard-tabs mb-5">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn("dashboard-tab", active === t.key ? "is-active" : "")}
        >
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
