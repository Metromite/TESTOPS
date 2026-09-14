import { useEffect, useRef, useState, DragEvent } from "react";
import { GripVertical, Folder, X } from "lucide-react";
import { api } from "../api/client";
import { GlassInput } from "../design-system/GlassInput";
import { cn } from "@/lib/utils";

/**
 * V2 milestone: Permitted Areas / Driver Anchoring redesign.
 * Predictive multi-select supporting BOTH individual Areas and whole Area
 * Groups, searchable by Area Code or Area Name (GET /areas/search) or
 * Group name (GET /area-groups?q=...) - replaces manual Area Code typing.
 * Selected items render as removable, drag-to-reorder chips. Used by both
 * the Vehicles panel (Permitted Areas) and the Drivers panel (Anchored
 * Areas) in Fleet.tsx.
 */
export interface AreaGroupItem {
  kind: "area" | "group";
  id: number;
  label: string;   // "JA - Jabal Ali" for an area, "Dubai" for a group
  sub?: string;     // division, for areas
}

export default function AreaGroupMultiSelect({
  selectedAreas, selectedGroups, onChange, placeholder, emptyHint,
}: {
  selectedAreas: { id: number; code: string; name: string }[];
  selectedGroups: { id: number; name: string }[];
  onChange: (areas: { id: number; code: string; name: string }[], groups: { id: number; name: string }[]) => void;
  placeholder?: string;
  emptyHint?: string;
}) {
  const [query, setQuery] = useState("");
  const [areaSuggestions, setAreaSuggestions] = useState<{ id: number; code: string; name: string; sector: string }[]>([]);
  const [groupSuggestions, setGroupSuggestions] = useState<{ id: number; name: string }[]>([]);
  const dragItem = useState<{ current: { kind: "area" | "group"; id: number } | null }>({ current: null })[0];
  // ITEM PASS 8 (dropdown coordinator audit): this dropdown had NO
  // outside-click handling, NO Escape handler, and did not participate
  // in the shared `nav-dropdown-open` coordinator at all (it only closed
  // itself when a suggestion was picked). Adding a wrapper ref +
  // outside-click + Escape + coordinator, same pattern as every other
  // dropdown in the app.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const instanceId = useRef(`area-group-select-${Math.random().toString(36).slice(2)}`).current;
  const isOpen = areaSuggestions.length > 0 || groupSuggestions.length > 0;

  function closeSuggestions() {
    setAreaSuggestions([]);
    setGroupSuggestions([]);
  }

  useEffect(() => {
    if (!isOpen) return;
    function onOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) closeSuggestions();
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") closeSuggestions();
    }
    function onOtherOpened(e: Event) {
      if ((e as CustomEvent).detail !== instanceId) closeSuggestions();
    }
    window.addEventListener("mousedown", onOutside);
    window.addEventListener("keydown", onEscape);
    document.addEventListener("nav-dropdown-open", onOtherOpened);
    return () => {
      window.removeEventListener("mousedown", onOutside);
      window.removeEventListener("keydown", onEscape);
      document.removeEventListener("nav-dropdown-open", onOtherOpened);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, instanceId]);

  useEffect(() => {
    if (!query.trim()) { setAreaSuggestions([]); setGroupSuggestions([]); return; }
    const handle = setTimeout(() => {
      api.get(`/areas/search?q=${encodeURIComponent(query)}`).then((rs) => {
        setAreaSuggestions(rs);
        if (rs.length > 0) document.dispatchEvent(new CustomEvent("nav-dropdown-open", { detail: instanceId }));
      }).catch(() => {});
      api.get(`/area-groups?q=${encodeURIComponent(query)}`).then((gs) => setGroupSuggestions(gs.map((g: any) => ({ id: g.id, name: g.name })))).catch(() => {});
    }, 200);
    return () => clearTimeout(handle);
  }, [query, instanceId]);

  // Combined ordered list of chips: areas + groups, in whichever order
  // they were added - reordering (drag) operates on this combined list.
  const items: AreaGroupItem[] = [
    ...selectedGroups.map((g) => ({ kind: "group" as const, id: g.id, label: g.name })),
    ...selectedAreas.map((a) => ({ kind: "area" as const, id: a.id, label: `${a.code} - ${a.name}` })),
  ];

  function addArea(a: { id: number; code: string; name: string }) {
    if (!selectedAreas.some((s) => s.id === a.id)) onChange([...selectedAreas, a], selectedGroups);
    setQuery(""); closeSuggestions();
  }
  function addGroup(g: { id: number; name: string }) {
    if (!selectedGroups.some((s) => s.id === g.id)) onChange(selectedAreas, [...selectedGroups, g]);
    setQuery(""); closeSuggestions();
  }
  function removeItem(kind: "area" | "group", id: number) {
    if (kind === "area") onChange(selectedAreas.filter((a) => a.id !== id), selectedGroups);
    else onChange(selectedAreas, selectedGroups.filter((g) => g.id !== id));
  }

  function handleDragStart(kind: "area" | "group", id: number) { dragItem.current = { kind, id }; }
  function handleDragOver(e: DragEvent) { e.preventDefault(); }
  function handleDrop(targetKind: "area" | "group", targetId: number) {
    const dragged = dragItem.current;
    dragItem.current = null;
    if (!dragged || (dragged.kind === targetKind && dragged.id === targetId)) return;
    const reordered = [...items];
    const fromIdx = reordered.findIndex((it) => it.kind === dragged.kind && it.id === dragged.id);
    const toIdx = reordered.findIndex((it) => it.kind === targetKind && it.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const newAreas = reordered.filter((it) => it.kind === "area").map((it) => selectedAreas.find((a) => a.id === it.id)!).filter(Boolean);
    const newGroups = reordered.filter((it) => it.kind === "group").map((it) => selectedGroups.find((g) => g.id === it.id)!).filter(Boolean);
    onChange(newAreas, newGroups);
  }

  return (
    <div ref={wrapperRef} className="relative min-w-[260px]">
      <div className="mb-1.5 flex flex-wrap gap-1.5">
        {items.map((it) => (
          <span
            key={`${it.kind}-${it.id}`}
            draggable
            onDragStart={() => handleDragStart(it.kind, it.id)}
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(it.kind, it.id)}
            title="Drag to reorder"
            className={cn(
              "inline-flex cursor-grab items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold",
              it.kind === "group" ? "bg-[var(--teal)] text-[var(--navy)]" : "bg-[var(--navy3)] text-ink"
            )}
          >
            <GripVertical className="h-3 w-3 opacity-60" />
            {it.kind === "group" ? <Folder className="h-3 w-3" /> : null}
            {it.kind === "group" ? `${it.label} (Group)` : it.label}
            <button type="button" onClick={() => removeItem(it.kind, it.id)} className="ml-0.5 rounded-full p-0.5 hover:bg-black/15">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {items.length === 0 && <span className="text-[12px] text-muted">{emptyHint || "None selected"}</span>}
      </div>
      <GlassInput
        placeholder={placeholder || "Search Area code/name or Group name…"}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {(areaSuggestions.length > 0 || groupSuggestions.length > 0) && (
        // ITEM PASS 6: shared Level 3 tokens instead of ad hoc navy2/95
        <div className="absolute z-[9999] mt-1.5 max-h-[220px] min-w-full overflow-y-auto rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg-3)] p-1 shadow-elevation2 backdrop-blur-[var(--glass-blur-3)] backdrop-saturate-[200%]">
          {groupSuggestions.map((g) => (
            <div key={`g-${g.id}`} onClick={() => addGroup(g)} className="flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-semibold text-ink hover:bg-[var(--row-hover)]">
              <Folder className="h-3.5 w-3.5" /> {g.name} (Group)
            </div>
          ))}
          {areaSuggestions.map((a) => (
            <div key={`a-${a.id}`} onClick={() => addArea(a)} className="cursor-pointer rounded-md px-2.5 py-1.5 text-[13px] text-ink hover:bg-[var(--row-hover)]">
              {a.code} — {a.name} ({a.sector})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
