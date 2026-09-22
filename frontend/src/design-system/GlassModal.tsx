import { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fadeIn, scaleIn } from "./motion";

export interface GlassModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** "content" (default, auto-sizes and caps at 92vw - matches the app's
   *  existing responsive-dialog convention) or a fixed max-width class. */
  size?: "content" | "sm" | "md" | "lg" | "xl" | "full";
  className?: string;
}

const sizeClass: Record<NonNullable<GlassModalProps["size"]>, string> = {
  content: "w-fit min-w-[320px] max-w-[92vw]",
  sm: "w-full max-w-md",
  md: "w-full max-w-2xl",
  lg: "w-full max-w-4xl",
  xl: "w-full max-w-6xl",
  full: "w-[94vw] h-[90vh]",
};

/**
 * GlassModal - the design system's dialog primitive (Radix Dialog underneath
 * for focus-trap/ESC/aria, glass skin on top). Auto-sizes to content and
 * caps width at 92vw by default, matching the app's existing "no horizontal
 * scroll on dialogs" rule; only scrolls vertically.
 */
export function GlassModal({ open, onOpenChange, title, description, children, footer, size = "content", className }: GlassModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[300] bg-black/45 backdrop-blur-sm" {...fadeIn} />
            </Dialog.Overlay>
            {/*
              BUGFIX (popup not centered - screenshot showed it anchored
              near its top-left corner at screen-center instead of truly
              centered, overflowing off the right/bottom edge):
              Dialog.Content used to BE the positioned box itself, centered
              via `fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2`
              (the standard "center by pulling back half your own size"
              trick). That box was also a Framer Motion `motion.div`
              animating `scale`/`y` (scaleIn preset) - Framer Motion
              manages the `transform` CSS property via an INLINE style for
              whatever it's animating, and inline styles beat classes, so
              its own transform (`scale(...) translateY(...)`) silently
              replaced the Tailwind translate class entirely - centering
              was live for exactly zero frames.
              Fix: Dialog.Content is now a plain, non-animated, full-screen
              flex container that centers its child with flexbox (`inset-0
              flex items-center justify-center`) - flexbox centering never
              touches `transform`, so it can't be clobbered by whatever
              Framer Motion is animating on the box inside it. The
              motion.div is now just that inner box, with its own scaleIn
              animation and none of the old positioning classes.
            */}
            <Dialog.Content asChild forceMount>
              {/*
                BUGFIX (item 18/19 - "must click the X, clicking outside
                does nothing"): this is a side effect of the centering fix
                above. Radix's own "click outside Dialog.Content closes it"
                logic checks whether the click landed outside Dialog.
                Content's DOM boundary - but Dialog.Content here is now a
                `fixed inset-0` full-screen wrapper (required for the
                flexbox centering fix), so a click on the backdrop is
                still technically INSIDE Dialog.Content and Radix's own
                outside-click detection can never fire for it.
                Fix: an explicit onClick on this wrapper that only closes
                when the click target IS the wrapper itself (the backdrop
                area), not a descendant of it - a click that started/ended
                inside the inner motion.div box always has some deeper
                element as e.target, never the wrapper, so it's a no-op
                there. This doesn't touch the centering/transform/size
                classes on either this div or the inner motion.div at all.
              */}
              <div
                className="fixed inset-0 z-[301] flex items-center justify-center p-4"
                onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
              >
                <motion.div
                  {...scaleIn}
                  className={cn(
                    "max-h-[88vh] overflow-y-auto overflow-x-hidden",
                    /* ITEM PASS 6 (Part 5/6, glass surface hierarchy): Level 3
                       (modals/dropdowns - the strongest frost tier) instead of
                       the same Level 1 alpha/blur every card uses. DELIBERATELY
                       kept as the same `bg-[...]`/`backdrop-blur-[...]` Tailwind
                       arbitrary-value pattern already used here, just pointing at
                       the `-3` tokens, rather than swapping in the `.glass-level-3`
                       CSS class - that class also declares its own border/box-shadow,
                       which could cascade-conflict with the `shadow-[...]` utility
                       class two lines below in ways I can't verify without a real
                       build in this sandbox. This popup's positioning/transform/
                       centering classes below are completely untouched. */
                    "rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg-3)] backdrop-blur-[var(--glass-blur-3)] backdrop-saturate-[180%]",
                    "shadow-[var(--elevation-2),var(--glass-highlight)] p-6",
                    sizeClass[size],
                    className
                  )}
                >
                  <div className="mb-4 flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      {title && (
                        <Dialog.Title className="whitespace-nowrap text-[16px] font-semibold text-ink">{title}</Dialog.Title>
                      )}
                      {description && <Dialog.Description className="mt-1 text-[13px] text-muted">{description}</Dialog.Description>}
                    </div>
                    <Dialog.Close className="shrink-0 rounded-md p-1 text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink">
                      <X className="h-5 w-5" />
                    </Dialog.Close>
                  </div>
                  {children}
                  {footer && <div className="mt-5 flex items-center justify-end gap-2">{footer}</div>}
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
