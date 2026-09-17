import { forwardRef, HTMLAttributes } from "react";
import { motion, HTMLMotionProps } from "framer-motion";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { fadeUp } from "./motion";

const glassCardVariants = cva(
  [
    "relative rounded-[20px] border",
    "border-[var(--glass-border)] bg-[var(--glass-bg)]",
    "backdrop-blur-glass backdrop-saturate-[175%]",
    "shadow-[inset_0_1px_0_rgba(255,255,255,.22),inset_0_-1px_0_rgba(255,255,255,.06),0_18px_50px_rgba(0,0,0,.12)]",
  ].join(" "),
  {
    variants: {
      padding: {
        none: "p-0",
        sm: "p-4",
        md: "p-5",
        lg: "p-7",
      },
      interactive: {
        true: "cursor-pointer",
        false: "",
      },
      tone: {
        default: "",
        solid: "bg-[var(--navy3)] backdrop-blur-0 backdrop-saturate-100",
      },
    },
    defaultVariants: { padding: "md", interactive: false, tone: "default" },
  }
);

export interface GlassCardProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart">,
    VariantProps<typeof glassCardVariants> {
  animate?: boolean;
  motionProps?: HTMLMotionProps<"div">;
}

/**
 * GlassCard - base surface for the app's "liquid glass" design language.
 * Equivalent to shadcn's <Card> but pre-skinned for this app's dark/light/
 * high-contrast theme system (reads --glass-bg / --glass-border / etc, so
 * it re-themes automatically with the rest of the app).
 */
export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, padding, interactive, tone, animate = false, motionProps, children, ...props }, ref) => {
    const classes = cn(glassCardVariants({ padding, interactive, tone }), className);
    if (animate) {
      return (
        <motion.div ref={ref} className={classes} {...fadeUp} {...motionProps} {...(props as HTMLMotionProps<"div">)}>
          {children}
        </motion.div>
      );
    }
    return (
      <div ref={ref} className={classes} {...props}>
        {children}
      </div>
    );
  }
);
GlassCard.displayName = "GlassCard";
