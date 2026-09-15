import { ComponentPropsWithoutRef, forwardRef } from "react";
import * as Switch from "@radix-ui/react-switch";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { springSlide } from "./motion";

export interface IOSSwitchProps
  extends Omit<ComponentPropsWithoutRef<typeof Switch.Root>, "asChild" | "onCheckedChange"> {
  onCheckedChange: (checked: boolean) => void;
  size?: "sm" | "md";
}

/**
 * IOSSwitch - drop-in replacement for a native `<input type="checkbox">`
 * toggle, built on `@radix-ui/react-switch` (already a declared dependency
 * - unused until now) rather than a bare styled `<button>`, so it gets
 * correct `role="switch"`/keyboard/focus semantics for free instead of
 * reimplementing them. Same `checked` / `onCheckedChange` props every
 * existing toggle in this app already exposes (`checked` / `onChange`),
 * so swapping one in for a native checkbox is presentation-only - no
 * state or business logic moves.
 *
 * Visual/interaction: a single "liquid" thumb that slides between the two
 * positions via `springSlide` (the same shared spring used for the nav's
 * sliding active-pill), with a brief elastic squash while pressed. Track
 * recolors to `--blue` on the "on" state, matching every other
 * affirmative-state accent already used across the app (nav active pill,
 * primary buttons).
 */
export const IOSSwitch = forwardRef<HTMLButtonElement, IOSSwitchProps>(
  ({ checked, onCheckedChange, size = "md", className, disabled, ...props }, ref) => {
    const trackW = size === "sm" ? 38 : 46;
    const trackH = size === "sm" ? 22 : 26;
    const thumb = trackH - 4;

    return (
      <Switch.Root
        ref={ref}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className={cn(
          "relative inline-flex shrink-0 items-center rounded-full border transition-colors duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
          disabled && "opacity-50 pointer-events-none",
          checked
            ? "bg-[var(--blue)] border-transparent"
            : "bg-[var(--glass-bg)] border-[var(--glass-border)] backdrop-blur-glass",
          className
        )}
        style={{ width: trackW, height: trackH }}
        {...props}
      >
        <Switch.Thumb asChild>
          <motion.span
            layout
            transition={springSlide}
            whileTap={{ scaleX: 1.12 }}
            className="block rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)]"
            style={{
              width: thumb,
              height: thumb,
              marginLeft: checked ? trackW - thumb - 2 : 2,
            }}
          />
        </Switch.Thumb>
      </Switch.Root>
    );
  }
);
IOSSwitch.displayName = "IOSSwitch";
