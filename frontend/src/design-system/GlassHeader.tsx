import { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { fadeUp } from "./motion";

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
    <motion.div {...fadeUp} className={cn("mb-6 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[11.5px] font-bold uppercase tracking-widest text-[var(--cyan)]">{eyebrow}</div>}
        <h1 className="text-[22px] font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13.5px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </motion.div>
  );
}
