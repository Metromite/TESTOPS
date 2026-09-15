import { InputHTMLAttributes, forwardRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface IOSSliderProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

/**
 * IOSSlider - a native `<input type="range">` underneath (so keyboard
 * control, accessibility semantics, and drag behavior are exactly the
 * browser's own, unchanged) with an iOS-style filled track and a tactile
 * thumb that scales up slightly while being dragged. Deliberately NOT a
 * from-scratch pointer-tracking component - that would be new interaction
 * logic, which is out of scope for a presentation-only redesign.
 *
 * `value`/`onValueChange` mirror the native element's `value`/`onChange`
 * one-to-one (`onValueChange(Number(e.target.value))`), so wiring this in
 * place of an existing `<input type="range">` doesn't change what the
 * value means or how it's used downstream.
 */
export const IOSSlider = forwardRef<HTMLInputElement, IOSSliderProps>(
  ({ value, onValueChange, min = 0, max = 100, step = 1, className, disabled, ...props }, ref) => {
    const [active, setActive] = useState(false);
    const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

    return (
      <div className={cn("relative flex items-center py-2", disabled && "opacity-50")}>
        <div
          className="pointer-events-none absolute left-0 right-0 h-[6px] rounded-full bg-[var(--glass-bg)] border border-[var(--glass-border)] backdrop-blur-glass"
          aria-hidden
        >
          <div
            className="h-full rounded-full bg-[var(--blue)] transition-[width] duration-150 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <input
          ref={ref}
          type="range"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => onValueChange(Number(e.target.value))}
          onPointerDown={() => setActive(true)}
          onPointerUp={() => setActive(false)}
          onPointerLeave={() => setActive(false)}
          className={cn(
            "ios-slider relative z-10 w-full appearance-none bg-transparent focus-visible:outline-none",
            active && "ios-slider-active",
            className
          )}
          {...props}
        />
      </div>
    );
  }
);
IOSSlider.displayName = "IOSSlider";
