/**
 * components/OccGridCard.tsx
 * A single card's chrome inside Control Center's Manual Layout (grid) mode.
 * Wraps whatever slide content is passed as children with a header bar
 * (title, lock, pin, duplicate, remove, accent color, style popover) that
 * react-grid-layout treats as one draggable/resizable grid item.
 *
 * Card-level customization implemented (round -11 added glass/shadow/
 * rounded-corners/animation/refresh-interval on top of round -7/-8's
 * title/accent/compact/header/lock/pin): these are all WRAPPER-level
 * properties - CSS applied to this component's own container - so none of
 * them needed new props threaded into the 10 existing slide components.
 * refreshIntervalSec works by changing the `key` on the div wrapping
 * `children` on a timer, which forces React to fully unmount+remount
 * whatever's inside (re-running its own effects/fetches from scratch) -
 * no cooperation needed from the slide component itself.
 *
 * STILL NOT implemented per-card (this genuinely does require new props
 * INSIDE the 10 existing slide components, which is a different, larger
 * change than anything in this file): footer on/off, legend on/off, value
 * on/off - those toggle specific inner elements (a chart's legend, a
 * table's footer row) that only the component rendering them can control.
 *
 * PHASE 10 REDESIGN NOTE: visual layer only. `.occ-card-drag-handle`
 * (react-grid-layout's/Canvas mode's drag-handle selector) stays on the
 * exact same header element, and every button keeps its
 * `onMouseDown={stopPropagation}` guard so grid-drag detection is
 * unaffected. Emoji glyphs replaced with Lucide icons; header/popover
 * restyled onto the design system.
 */
import { ReactNode, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Maximize2, Minimize2, Pin, PinOff, Lock, Unlock, Palette,
  ChevronsUpDown, Copy, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface OccCardChrome {
  title: string;
  accent: string;
  compact: boolean;
  headerOn: boolean;
  locked: boolean;
  pinned: boolean;
  glass: boolean;
  shadow: boolean;
  roundedCorners: boolean;
  animation: boolean;
  refreshIntervalSec: number; // 0 = off
}

export const DEFAULT_CARD_STYLE: Pick<OccCardChrome, "glass" | "shadow" | "roundedCorners" | "animation" | "refreshIntervalSec"> = {
  glass: true, shadow: true, roundedCorners: true, animation: true, refreshIntervalSec: 0,
};

const REFRESH_OPTIONS = [0, 15, 30, 60, 120, 300, 600];

function HeaderIconBtn({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      title={title}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--row-hover)]",
        danger ? "text-[var(--red)]" : "text-muted hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

export default function OccGridCard({
  chrome,
  selected,
  onSelect,
  onTitleChange,
  onToggleLock,
  onTogglePin,
  onDuplicate,
  onRemove,
  onAccentChange,
  onToggleCompact,
  onToggleHeader,
  onStyleChange,
  children,
}: {
  chrome: OccCardChrome;
  selected?: boolean;
  onSelect?: () => void;
  onTitleChange: (v: string) => void;
  onToggleLock: () => void;
  onTogglePin: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onAccentChange: (v: string) => void;
  onToggleCompact: () => void;
  onToggleHeader: () => void;
  onStyleChange: (patch: Partial<OccCardChrome>) => void;
  children: ReactNode;
}) {
  const [styleOpen, setStyleOpen] = useState(false);
  const [remountTick, setRemountTick] = useState(0);
  const popoverRef = useRef<HTMLDivElement>(null);
  // ITEM PASS 8 (dropdown coordinator audit): this popover had outside-
  // click handling but no Escape handler and didn't participate in the
  // shared `nav-dropdown-open` coordinator (MultiSelectSlicer/
  // GlassSidebar/AutocompleteInput all do) - so it could stay open
  // simultaneously with another dropdown elsewhere on the page, and
  // Escape didn't close it. Fixed both, same pattern as those files.
  const occCardInstanceId = useRef(`occ-card-style-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    if (!chrome.refreshIntervalSec) return;
    const id = setInterval(() => setRemountTick((t) => t + 1), chrome.refreshIntervalSec * 1000);
    return () => clearInterval(id);
  }, [chrome.refreshIntervalSec]);

  useEffect(() => {
    if (!styleOpen) return;
    function onOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setStyleOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setStyleOpen(false);
    }
    function onOtherOpened(e: Event) {
      if ((e as CustomEvent).detail !== occCardInstanceId) setStyleOpen(false);
    }
    window.addEventListener("mousedown", onOutside);
    window.addEventListener("keydown", onEscape);
    document.addEventListener("nav-dropdown-open", onOtherOpened);
    return () => {
      window.removeEventListener("mousedown", onOutside);
      window.removeEventListener("keydown", onEscape);
      document.removeEventListener("nav-dropdown-open", onOtherOpened);
    };
  }, [styleOpen, occCardInstanceId]);

  return (
    <div
      className={"occ-grid-card" + (chrome.glass ? " glass-card" : " occ-card-solid") + (chrome.animation ? " occ-slide" : "")}
      onMouseDown={(e) => { if (onSelect && (e.target as HTMLElement).closest(".occ-card-drag-handle") === null) onSelect(); }}
      style={{
        display: "flex", flexDirection: "column", height: "100%", overflow: "hidden",
        borderLeft: `4px solid ${chrome.accent}`, padding: chrome.compact ? 8 : undefined,
        borderRadius: chrome.roundedCorners ? undefined : 2,
        boxShadow: chrome.shadow ? undefined : "none",
        outline: selected ? "2px solid var(--blue)" : "none", outlineOffset: -2,
        position: "relative",
      }}
    >
      {chrome.headerOn ? (
        <div
          // react-grid-layout drags by any element inside the item unless
          // told otherwise - this header is the intended "grab handle"
          // when the card isn't locked.
          className="occ-card-drag-handle mb-2 flex items-center gap-1 border-b border-edge pb-2"
          style={{ cursor: chrome.locked ? "default" : "grab" }}
        >
          <input
            value={chrome.title}
            onChange={(e) => onTitleChange(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] font-bold text-ink outline-none"
          />
          <input
            type="color"
            value={chrome.accent}
            onChange={(e) => onAccentChange(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            title="Accent color"
            className="h-5 w-5 shrink-0 cursor-pointer border-0 bg-transparent p-0"
          />
          <HeaderIconBtn title={chrome.compact ? "Expand" : "Compact"} onClick={onToggleCompact}>
            {chrome.compact ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
          </HeaderIconBtn>
          <HeaderIconBtn title={chrome.pinned ? "Unpin" : "Pin"} onClick={onTogglePin}>
            {chrome.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </HeaderIconBtn>
          <HeaderIconBtn title={chrome.locked ? "Unlock" : "Lock"} onClick={onToggleLock}>
            {chrome.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
          </HeaderIconBtn>
          <HeaderIconBtn title="Style" onClick={() => setStyleOpen((s) => { const next = !s; if (next) document.dispatchEvent(new CustomEvent("nav-dropdown-open", { detail: occCardInstanceId })); return next; })}>
            <Palette className="h-3.5 w-3.5" />
          </HeaderIconBtn>
          <HeaderIconBtn title="Hide header" onClick={onToggleHeader}>
            <ChevronsUpDown className="h-3.5 w-3.5" />
          </HeaderIconBtn>
          <HeaderIconBtn title="Duplicate" onClick={onDuplicate}>
            <Copy className="h-3.5 w-3.5" />
          </HeaderIconBtn>
          <HeaderIconBtn title="Remove" onClick={onRemove} danger>
            <X className="h-3.5 w-3.5" />
          </HeaderIconBtn>
        </div>
      ) : (
        <button
          className="occ-card-drag-handle mb-1 flex items-center gap-1 self-end rounded-md px-1.5 py-0.5 text-muted opacity-60 transition-opacity hover:opacity-100"
          title="Show header"
          onClick={onToggleHeader}
        >
          <ChevronsUpDown className="h-3 w-3" />
        </button>
      )}

      <AnimatePresence>
        {styleOpen && (
          <motion.div
            ref={popoverRef}
            onMouseDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.14 }}
            // ITEM PASS 6: shared Level 3 tokens instead of ad hoc navy2/95
            className="absolute right-2 top-[34px] z-[9999] w-[210px] rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg-3)] p-2.5 text-[12px] shadow-elevation2 backdrop-blur-[var(--glass-blur-3)] backdrop-saturate-[200%]"
          >
            <label className="mb-1.5 flex items-center gap-2 text-ink">
              <input type="checkbox" checked={chrome.glass} onChange={(e) => onStyleChange({ glass: e.target.checked })} className="accent-[var(--teal)]" /> Glass transparency
            </label>
            <label className="mb-1.5 flex items-center gap-2 text-ink">
              <input type="checkbox" checked={chrome.shadow} onChange={(e) => onStyleChange({ shadow: e.target.checked })} className="accent-[var(--teal)]" /> Shadow
            </label>
            <label className="mb-1.5 flex items-center gap-2 text-ink">
              <input type="checkbox" checked={chrome.roundedCorners} onChange={(e) => onStyleChange({ roundedCorners: e.target.checked })} className="accent-[var(--teal)]" /> Rounded corners
            </label>
            <label className="mb-2 flex items-center gap-2 text-ink">
              <input type="checkbox" checked={chrome.animation} onChange={(e) => onStyleChange({ animation: e.target.checked })} className="accent-[var(--teal)]" /> Entrance animation
            </label>
            <div className="mb-1 text-muted">Auto-refresh</div>
            <select
              value={chrome.refreshIntervalSec}
              onChange={(e) => onStyleChange({ refreshIntervalSec: Number(e.target.value) })}
              className="w-full rounded-md border border-edge bg-[var(--navy3)] px-2 py-1.5 text-ink"
            >
              {REFRESH_OPTIONS.map((s) => <option key={s} value={s}>{s === 0 ? "Off" : `${s}s`}</option>)}
            </select>
          </motion.div>
        )}
      </AnimatePresence>

      <div key={remountTick} style={{ flex: 1, overflow: "auto", minHeight: 0 }}>{children}</div>
    </div>
  );
}
