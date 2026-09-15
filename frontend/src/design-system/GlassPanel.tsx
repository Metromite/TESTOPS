import { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GlassCard } from "./GlassCard";

export interface GlassPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  bodyClassName?: string;
}

/**
 * GlassPanel - a GlassCard with an optional header row (title / description
 * / actions). Use for page sections, dashboard panels, and grouped form
 * areas - anywhere HeroUI/shadcn's Card+CardHeader+CardContent pattern
 * would normally go.
 */
export function GlassPanel({ title, description, actions, className, bodyClassName, children, ...props }: GlassPanelProps) {
  return (
    <GlassCard padding="lg" className={cn("flex flex-col gap-4", className)} {...props}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-ink tracking-tight">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(bodyClassName)}>{children}</div>
    </GlassCard>
  );
}
