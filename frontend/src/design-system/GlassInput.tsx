import { forwardRef, InputHTMLAttributes, LabelHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-md border border-edge bg-[var(--navy3)] px-3.5 py-2.5 text-[14px] text-ink placeholder:text-muted/70 transition-shadow duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)]/60 focus-visible:border-[var(--cyan)] disabled:opacity-50";

export interface GlassInputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
}

/**
 * GlassInput - standard text input. For rich fields (autocomplete, combobox,
 * date pickers, selects with search) prefer HeroUI's <Input>/<Autocomplete>
 * per the design brief; this covers the plain-input case those wrap around.
 */
export const GlassInput = forwardRef<HTMLInputElement, GlassInputProps>(({ className, icon, ...props }, ref) => {
  if (icon) {
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">{icon}</span>
        <input ref={ref} className={cn(fieldBase, "pl-9", className)} {...props} />
      </div>
    );
  }
  return <input ref={ref} className={cn(fieldBase, className)} {...props} />;
});
GlassInput.displayName = "GlassInput";

export const GlassTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(fieldBase, "min-h-[96px] resize-y", className)} {...props} />
);
GlassTextarea.displayName = "GlassTextarea";

export function GlassLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-[12.5px] font-medium text-muted", className)} {...props} />;
}

export function GlassField({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      {label && <GlassLabel>{label}</GlassLabel>}
      {children}
      {hint && !error && <p className="mt-1 text-[12px] text-muted">{hint}</p>}
      {error && <p className="mt-1 text-[12px] text-[var(--red)]">{error}</p>}
    </div>
  );
}
