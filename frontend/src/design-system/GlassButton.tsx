import { ButtonHTMLAttributes, forwardRef } from "react";
import { motion } from "framer-motion";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-colors duration-150 focus-visible:outline-none disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary: "bg-[var(--blue)] text-white hover:bg-[var(--blue2)] shadow-elevation1",
        secondary:
          "bg-[var(--glass-bg)] text-ink border border-[var(--glass-border)] backdrop-blur-glass hover:bg-[var(--row-hover)]",
        outline: "border border-edge text-ink bg-transparent hover:bg-[var(--row-hover)]",
        ghost: "text-muted hover:text-ink hover:bg-[var(--row-hover)] bg-transparent",
        danger: "bg-[var(--red)] text-white hover:brightness-110",
        subtle: "bg-[var(--navy3)] text-ink hover:bg-[var(--navy4)]",
      },
      size: {
        sm: "h-8 px-3 text-[12.5px]",
        md: "h-10 px-4 text-[14px]",
        lg: "h-12 px-6 text-[15px]",
        icon: "h-10 w-10 shrink-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd"
>;

export interface GlassButtonProps extends NativeButtonProps, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

/**
 * GlassButton - the app's standard button. Visual equivalent of HeroUI's
 * <Button>, kept as a lightweight native <button> + Framer Motion so it has
 * zero extra runtime cost on pages that just need a button (forms, tables,
 * toolbars use HeroUI's <Button>/<Autocomplete> directly where richer
 * behavior - like built-in loading/ripple - is worth the dependency).
 */
export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => {
    return (
      <motion.button
        ref={ref}
        whileTap={{ scale: 0.97 }}
        whileHover={{ scale: disabled ? 1 : 1.015 }}
        transition={{ duration: 0.12 }}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </motion.button>
    );
  }
);
GlassButton.displayName = "GlassButton";
