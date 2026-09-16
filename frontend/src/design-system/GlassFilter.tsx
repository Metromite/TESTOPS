import { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function GlassFilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2.5 backdrop-blur-glass",
        className
      )}
    >
      {children}
    </div>
  );
}

export function GlassFilterChip({
  label,
  onRemove,
  active = true,
}: {
  label: ReactNode;
  onRemove?: () => void;
  active?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors",
        active ? "bg-[var(--blue)] text-white" : "bg-[var(--navy3)] text-muted"
      )}
    >
      {label}
      {onRemove && (
        <button onClick={onRemove} className="rounded-full p-0.5 hover:bg-white/20" aria-label="Remove filter">
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
