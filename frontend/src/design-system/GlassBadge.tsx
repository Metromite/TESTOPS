import { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none",
  {
    variants: {
      tone: {
        neutral: "bg-[var(--navy3)] text-muted",
        ok: "bg-[color-mix(in_srgb,var(--green)_16%,transparent)] text-[var(--green)]",
        warning: "bg-[color-mix(in_srgb,var(--amber)_16%,transparent)] text-[var(--amber)]",
        danger: "bg-[color-mix(in_srgb,var(--red)_16%,transparent)] text-[var(--red)]",
        info: "bg-[color-mix(in_srgb,var(--cyan)_16%,transparent)] text-[var(--cyan)]",
        accent: "bg-[color-mix(in_srgb,var(--blue)_18%,transparent)] text-[var(--blue2)]",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export interface GlassBadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function GlassBadge({ className, tone, ...props }: GlassBadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
