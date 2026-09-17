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
    <div className={cn("mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-[rgba(255,255,255,.23)] bg-[rgba(13,24,41,.43)] p-4 backdrop-blur-[42px] backdrop-saturate-[190%] shadow-[0_18px_55px_rgba(0,0,0,.25),inset_0_1px_0_rgba(255,255,255,.20),inset_0_-1px_0_rgba(255,255,255,.06)]", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[11.5px] font-bold uppercase tracking-widest text-[var(--cyan)]">{eyebrow}</div>}
        <h1 className="text-[20px] font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13.5px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
