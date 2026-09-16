import { forwardRef, HTMLAttributes } from "react";
import { motion, HTMLMotionProps } from "framer-motion";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { fadeUp } from "./motion";

const glassCardVariants = cva(
  [
    "relative rounded-xl border",
    "border-[var(--glass-border)] bg-[var(--glass-bg)]",
    "backdrop-blur-glass backdrop-saturate-[180%]",
    "shadow-elevation1",
    // specular highlight rim, the signature detail of this design system
    "shadow-[var(--elevation-1),var(--glass-highlight)]",
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
        true: "transition-transform duration-150 ease-out hover:-translate-y-0.5 hover:shadow-elevation2 cursor-pointer",
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
