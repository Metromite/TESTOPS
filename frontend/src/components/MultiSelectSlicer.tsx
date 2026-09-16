import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { getOptionIcon } from "@/lib/domainIcons";
import type { LucideIcon } from "lucide-react";

/**
 * V2 milestone: Dashboard Filter Improvements - Excel/Power BI-style
 * slicers. A closed button shows the label + selected count; opening it
 * reveals a checkbox list supporting single or multiple selection, plus a
 * "Clear" shortcut. Selecting/deselecting fires onChange immediately, so
 * the caller can instantly refetch - no separate "Apply" step.
 *
 * BUGFIX (dropdowns behind panels / stay open / overlap): this menu used
 * to be an absolutely-positioned child with a fairly low z-index (30) and
 * no real dismiss handling (only onMouseLeave, which doesn't fire for
 * keyboard/touch and doesn't coordinate with sibling slicers at all - so
 * two could be open at once and each was still trapped inside whatever
 * stacking context its parent filter bar created). Now: portaled to
 * document.body positioned from the trigger's live rect (always paints
 * above everything), closes on outside click, closes on Escape, and
 * closes whenever any OTHER slicer/nav dropdown opens (shared
 * "nav-dropdown-open" event, same mechanism GlassSidebar's nav dropdowns
 * use) so only one of these can ever be open at a time.
 */
let slicerInstanceCounter = 0;

export default function MultiSelectSlicer({
  label, options, selected, onChange, icon: Icon,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  icon?: LucideIcon;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const instanceId = useRef(`slicer-${++slicerInstanceCounter}`).current;

  function toggle(opt: string) {
    onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]);
  }

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onOtherOpened(e: Event) {
      if ((e as CustomEvent).detail !== instanceId) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("nav-dropdown-open", onOtherOpened);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("nav-dropdown-open", onOtherOpened);
    };
  }, [instanceId]);

  useEffect(() => {
    if (!open) return;
    function updatePos() {
      const rect = ref.current?.getBoundingClientRect();
      if (rect) setMenuPos({ left: rect.left, top: rect.bottom + 6, width: rect.width });
    }
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [open]);

  function toggleOpen() {
    setOpen((o) => {
      const next = !o;
      if (next) document.dispatchEvent(new CustomEvent("nav-dropdown-open", { detail: instanceId }));
      return next;
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        title={`Slicer: filter by ${label}`}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[13px] font-semibold transition-colors duration-150",
          selected.length ? "bg-[var(--teal)] text-[var(--navy)]" : "bg-[var(--navy3)] text-muted hover:text-ink"
        )}
      >
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}{selected.length ? ` (${selected.length})` : ""}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {menuPos && createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.14 }}
              style={{ position: "fixed", left: menuPos.left, top: menuPos.top, zIndex: 9999, minWidth: Math.max(200, menuPos.width) }}
              // ITEM PASS 6 (Part 5/6, glass surface hierarchy): was
              // `bg-[var(--navy2)]/95` - an ad hoc opacity value specific to
              // this one component, not the shared token system. Now reads
              // the same Level 3 (strongest frost, modals/dropdowns) tokens
              // as GlassModal, so every "floats above everything else"
              // surface in the app shares one consistent visual language
              // instead of each dropdown/modal picking its own opacity.
              className="max-h-[280px] overflow-y-auto rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg-3)] p-2 shadow-elevation2 backdrop-blur-[var(--glass-blur-3)] backdrop-saturate-[200%]"
            >
              <div className="mb-1.5 flex items-center justify-between">
                <strong className="flex items-center gap-1.5 text-[12px] text-ink">{Icon && <Icon className="h-3.5 w-3.5" />}{label}</strong>
                {selected.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onChange([])}
                    className="flex items-center gap-0.5 rounded bg-transparent text-[12px] text-[var(--teal)] hover:underline"
                  >
                    <X className="h-3 w-3" />Clear
                  </button>
                )}
              </div>
              {options.length === 0 && <div className="text-[12px] text-muted">No values yet</div>}
              {options.map((opt) => {
                // ITEM 4/16: per-option icon (e.g. Pharmacy vs Hospital vs
                // Government each get their own glyph), not just the
                // shared filter-group icon every option used to repeat.
                const OptIcon = getOptionIcon(label, opt, Icon);
                return (
                  <label key={opt} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] text-ink transition-colors hover:bg-[var(--row-hover)]">
                    <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} className="h-3.5 w-3.5 accent-[var(--teal)]" />
                    <OptIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                    {opt}
                  </label>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
