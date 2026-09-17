import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface GlassHeaderProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * GlassHeader - standard page header. One consistent title/description/
 * actions layout used at the top of every migrated page, matching the
 * "clean enterprise (SAP / Power BI / Linear)" hierarchy the brief calls for.
 */
export function GlassHeader({ eyebrow, title, description, actions, className }: GlassHeaderProps) {
  return (
    <div className={cn("dashboard-glass-header relative mb-3 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-[22px] border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 backdrop-blur-glass backdrop-saturate-[180%] shadow-[var(--elevation-1)]", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[11.5px] font-bold uppercase tracking-widest text-[var(--cyan)]">{eyebrow}</div>}
        <h1 className="text-[20px] font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13.5px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
