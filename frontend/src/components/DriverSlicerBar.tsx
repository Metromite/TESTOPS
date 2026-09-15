import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search, User, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * DriverSlicerBar - Excel-style Driver Slicer.
 *
 * TARGETED FIX PASS (driver-slicer usability): the previous version of
 * this component put every driver button in a single row with
 * `overflow-x-auto` - fine for a handful of drivers, but with the full
 * Fleet Database roster that turns into one very long strip the user has
 * to horizontal-scroll through button-by-button to find anyone past the
 * first screenful. Fixed below by switching the button row from
 * `flex ... overflow-x-auto` (one line, scrolls sideways) to
 * `flex flex-wrap` (wraps into as many rows/columns as the container
 * width allows, growing downward instead of sideways) with a measured
 * collapse/expand ("Show more / Show less") instead of a fixed-height
 * scroll box, so:
 *   - a small Fleet Database (a handful of drivers) renders as just one
 *     short wrapped row, no extra chrome
 *   - a large one wraps into several rows, and only gets a "Show N more"
 *     toggle once it's actually tall enough to need one (measured via
 *     scrollHeight vs a collapsed cap, not a hardcoded driver count)
 *   - expanding reveals every driver - there is still no [:N] slice
 *     anywhere in this file; `options` (and therefore `visibleOptions`)
 *     is never truncated, only visually clipped by CSS max-height, which
 *     "Show more" lifts
 *   - the outer Dashboard page itself never scrolls horizontally to
 *     reach this component - only this component's own content can wrap
 *     to a taller box, never a wider one
 *
 * CRITICAL (unchanged): this component still holds NO filtering state of
 * its own. `options`, `selected`, and `onChange` are the exact same
 * `filterOptions.drivers` / `selDrivers` / `setSelDrivers` already wired
 * into Dashboard.tsx's shared `globalFilters` object and passed to every
 * tab/endpoint - this is only a different way to edit that same array. An
 * empty `selected` array is already how the rest of the app represents
 * "ALL / no driver restriction" (see dashboard_kpis.apply_global_filters:
 * `if drivers: ...` - empty string/list = no filter applied) - so
 * "deselecting everything returns to ALL" and "ALL is the default" both
 * fall out of the existing contract for free, with no special-case logic
 * needed here.
 *
 * `driverDirectory` is optional, purely cosmetic enrichment (Fleet
 * Database code+name for a nicer label than the bare identifier alone) -
 * if it hasn't loaded yet, or a given option has no match in it, the raw
 * identifier is shown, exactly as it always has been elsewhere in the
 * Dashboard (Driver Overview, Lead Time, etc. all already show this same
 * raw `driver_name` identifier).
 */
export interface DriverDirectoryEntry {
  code: string;
  name: string;
}

// Collapsed height cap in px - roughly 2 rows of pill buttons at the
// current padding/font size. Not a driver-count limit: it only controls
// how much is visible before "Show more" is needed; `visibleOptions`
// underneath is always the FULL (search-filtered) list.
const COLLAPSED_MAX_HEIGHT = 84;

export default function DriverSlicerBar({
  options,
  selected,
  onChange,
  driverDirectory,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  driverDirectory?: DriverDirectoryEntry[];
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [needsExpand, setNeedsExpand] = useState(false);
  const [fullHeight, setFullHeight] = useState<number | undefined>(undefined);
  const gridRef = useRef<HTMLDivElement>(null);

  // item 7 (display name): map each raw identifier (whatever value SAP/
  // Fleet Database convention uses - code or name, matching exactly what
  // /api/dashboard/filter-options already resolved) to a richer "CODE ·
  // Name" label when the Fleet Database driver directory has a match.
  // Never changes what's stored in `selected` - display-only.
  const labelFor = useMemo(() => {
    const byCode = new Map<string, DriverDirectoryEntry>();
    const byName = new Map<string, DriverDirectoryEntry>();
    for (const d of driverDirectory || []) {
      if (d.code) byCode.set(d.code.toLowerCase(), d);
      if (d.name) byName.set(d.name.toLowerCase(), d);
    }
    return (identifier: string): string => {
      const key = identifier.toLowerCase();
      const match = byCode.get(key) || byName.get(key);
      if (!match) return identifier;
      return match.code && match.name ? `${match.code} · ${match.name}` : identifier;
    };
  }, [driverDirectory]);

  // item 8 (search / large driver list): filters which buttons are
  // VISIBLE only - never touches `selected`/onChange, exactly as
  // required, and never truncates the list - ALL matches render (wrapped
  // + collapsible below), not just the first N. Matches against both the
  // raw identifier and the enriched label so searching "Hussain" finds
  // D040 even if the identifier itself is just the code.
  const visibleOptions = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.trim().toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(q) || labelFor(o).toLowerCase().includes(q));
  }, [options, search, labelFor]);

  // Measures actual rendered height (after wrapping) against the
  // collapsed cap - this is what decides whether "Show more" appears at
  // all, so a short roster never gets a pointless toggle and a long one
  // always does, regardless of exactly how many drivers that turns out
  // to be at any given screen width.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    setFullHeight(el.scrollHeight);
    setNeedsExpand(el.scrollHeight > COLLAPSED_MAX_HEIGHT + 4);
  }, [visibleOptions]);

  useEffect(() => {
    if (!needsExpand) setExpanded(false);
  }, [needsExpand]);

  const allActive = selected.length === 0;

  function toggleDriver(opt: string) {
    if (selected.includes(opt)) {
      // Deselecting - if this was the last one, `onChange([])` already
      // IS "ALL" per the shared filter contract described above.
      onChange(selected.filter((s) => s !== opt));
    } else {
      onChange([...selected, opt]);
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-[var(--glass-border)]",
        "bg-[var(--glass-bg)] p-2.5 backdrop-blur-glass"
      )}
      role="group"
      aria-label="Driver slicer"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex shrink-0 items-center gap-1.5 pl-0.5 pr-1 text-[12px] font-semibold uppercase tracking-wide text-muted">
          <User className="h-3.5 w-3.5" />
          Drivers
        </div>

        {/* item 8: search only shown once the list is large enough that
            scanning by eye alone would be unwieldy - stays out of the way
            for small Fleet Databases. */}
        {options.length > 12 && (
          <div className="relative shrink-0">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search drivers…"
              className="w-[140px] rounded-md border border-[var(--glass-border)] bg-[var(--navy3)] py-1.5 pl-7 pr-2 text-[12.5px] text-ink placeholder:text-muted focus:outline-none"
            />
          </div>
        )}

        <button
          type="button"
          onClick={() => onChange([])}
          className={cn(
            "shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors duration-150",
            allActive ? "bg-[var(--teal)] text-[var(--navy)]" : "bg-[var(--navy3)] text-muted hover:text-ink"
          )}
          aria-pressed={allActive}
          title="Show all Fleet Database drivers"
        >
          ALL
        </button>

        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-[12px] font-medium text-[var(--teal)] hover:underline"
          >
            Clear ({selected.length})
          </button>
        )}
      </div>

      {/* Excel-style wrapping grid: buttons flow left-to-right and wrap
          into as many rows as the container needs - never a single
          sideways-scrolling strip, never a fixed vertical scrollbox.
          Collapsed state clips via max-height (CSS only - every button is
          still in the DOM, so "Show more" is instant, and browser
          find-in-page / accessibility tools still see every driver). */}
      <div
        ref={gridRef}
        className="flex flex-wrap gap-1.5 overflow-hidden transition-[max-height] duration-200 ease-in-out"
        style={{ maxHeight: expanded || !needsExpand ? (fullHeight ?? "none") : COLLAPSED_MAX_HEIGHT }}
      >
        {visibleOptions.length === 0 && (
          <span className="whitespace-nowrap px-2 py-1 text-[12.5px] text-muted">
            {options.length === 0 ? "No drivers yet" : "No match"}
          </span>
        )}

        {visibleOptions.map((opt) => {
          const isSelected = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggleDriver(opt)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors duration-150",
                isSelected ? "bg-[var(--teal)] text-[var(--navy)]" : "bg-[var(--navy3)] text-muted hover:text-ink"
              )}
              aria-pressed={isSelected}
              title={labelFor(opt)}
            >
              {labelFor(opt)}
            </button>
          );
        })}
      </div>

      {needsExpand && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex w-fit shrink-0 items-center gap-1 self-center whitespace-nowrap rounded-md px-2 py-1 text-[12px] font-medium text-[var(--teal)] hover:underline"
        >
          {expanded ? (
            <>Show less <ChevronUp className="h-3 w-3" /></>
          ) : (
            <>Show all {visibleOptions.length} drivers <ChevronDown className="h-3 w-3" /></>
          )}
        </button>
      )}
    </div>
  );
}
