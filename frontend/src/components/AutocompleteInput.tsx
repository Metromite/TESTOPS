import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { GlassInput } from "../design-system/GlassInput";

/**
 * Generic predictive autocomplete input (Fleet Database + Master Data
 * Learning milestone). SUPABASE PORT (was GET /api/autocomplete/{field} on
 * the old FastAPI backend, which no longer exists) - field is one of:
 * area_code, area_name, vehicle_number, driver, helper, salesman, customer,
 * vehicle_type, division, route_type. Queries the relevant table directly
 * with `ilike` so it keeps reflecting live data (new SAP imports / new
 * Areas & Vehicles) without a dedicated backend endpoint.
 *
 * salesman/customer are sourced from sap_invoice_fact (imported SAP data) -
 * if nothing has been imported yet those two fields simply return no
 * suggestions, which is expected (there's nothing to suggest yet), not a
 * bug.
 *
 * BUGFIX ("manually typing/pressing Enter does nothing" reported for
 * salesman fields, but this same input backs predictive search
 * everywhere per the field list above): this only ever supported mouse
 * click on a suggestion - no keyboard navigation, and Enter did nothing
 * at all. Added standard autocomplete keyboard behavior: Up/Down moves a
 * highlighted suggestion (wrapping both ways), Enter accepts the
 * highlighted one (or just closes the list with the typed value kept, if
 * nothing is highlighted / list is empty - typing something not in the
 * suggestions and pressing Enter is a valid, common flow and shouldn't
 * be blocked), Escape closes without changing the value.
 */
const STATIC_FIELDS: Record<string, string[]> = {};

/** Supabase replacement for the old `/api/autocomplete/{field}` endpoint. */
async function fetchAutocomplete(field: string, q: string): Promise<string[]> {
  const needle = q.trim();
  if (!needle) return [];

  if (STATIC_FIELDS[field]) {
    return STATIC_FIELDS[field].filter((v) => v.toLowerCase().includes(needle.toLowerCase())).slice(0, 10);
  }

  switch (field) {
    case "area_code":
    case "area_name": {
      const col = field === "area_code" ? "code" : "name";
      const { data, error } = await supabase.from("areas").select("code,name").ilike(col, `%${needle}%`).limit(10);
      if (error) return [];
      return (data ?? []).map((a) => `${a.code} - ${a.name}`);
    }
    case "driver": {
      const { data, error } = await supabase
        .from("drivers")
        .select("code,name")
        .or(`code.ilike.%${needle}%,name.ilike.%${needle}%`)
        .limit(10);
      if (error) return [];
      return (data ?? []).map((d) => `${d.code} - ${d.name}`);
    }
    case "helper": {
      const { data, error } = await supabase
        .from("helpers")
        .select("code,name")
        .or(`code.ilike.%${needle}%,name.ilike.%${needle}%`)
        .limit(10);
      if (error) return [];
      return (data ?? []).map((h) => `${h.code} - ${h.name}`);
    }
    case "vehicle_type": {
      const { data, error } = await supabase.from("vehicles").select("type").ilike("type", `%${needle}%`).limit(100);
      if (error) return [];
      const seen = new Map<string, string>();
      for (const v of data ?? []) {
        const raw = String((v as any).type || "").trim();
        if (!raw) continue;
        const key = raw.toLowerCase().replace(/\s+/g, " ");
        if (!seen.has(key)) seen.set(key, raw);
      }
      return [...seen.values()].slice(0, 20);
    }
    case "vehicle_number": {
      const { data, error } = await supabase.from("vehicles").select("number").ilike("number", `%${needle}%`).limit(10);
      if (error) return [];
      return (data ?? []).map((v) => v.number as string);
    }
    case "salesman": {
      const { data, error } = await supabase
        .from("sap_invoice_facts")
        .select("salesman")
        .ilike("salesman", `%${needle}%`)
        .limit(30);
      if (error) return [];
      return Array.from(new Set((data ?? []).map((r: any) => r.salesman).filter(Boolean))).slice(0, 10) as string[];
    }
    case "customer": {
      const { data, error } = await supabase
        .from("sap_invoice_facts")
        .select("customer_name")
        .ilike("customer_name", `%${needle}%`)
        .limit(30);
      if (error) return [];
      return Array.from(new Set((data ?? []).map((r: any) => r.customer_name).filter(Boolean))).slice(0, 10) as string[];
    }
    default:
      return [];
  }
}

export default function AutocompleteInput({
  field, value, onChange, placeholder, disabled, onSelectRaw,
}: {
  field: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean;
  /** Optional: fires with the full raw suggestion (e.g. "D001 - John Doe")
   * before the " - " split that `onChange` receives just the code half
   * of. Lets a caller capture both halves of a driver/helper suggestion
   * at once instead of just the code. */
  onSelectRaw?: (raw: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  // ITEM PASS 7 (dropdown behavior, "only ONE dropdown remains open"):
  // MultiSelectSlicer/GlassSidebar's nav dropdown already coordinate via a
  // shared `nav-dropdown-open` document event so opening one closes any
  // other - this component (Salesman Categorization, Vacations, and every
  // other predictive field using it) didn't participate, so it could stay
  // open alongside an already-open filter dropdown elsewhere on the same
  // page. Joining the same coordinator, same pattern as those two files.
  const instanceId = useRef(`autocomplete-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    function onOtherOpened(e: Event) {
      if ((e as CustomEvent).detail !== instanceId) setOpen(false);
    }
    document.addEventListener("nav-dropdown-open", onOtherOpened);
    return () => document.removeEventListener("nav-dropdown-open", onOtherOpened);
  }, [instanceId]);

  function announceOpen() {
    document.dispatchEvent(new CustomEvent("nav-dropdown-open", { detail: instanceId }));
  }

  useEffect(() => {
    if (!value.trim()) { setSuggestions([]); return; }
    const handle = setTimeout(() => {
      fetchAutocomplete(field, value).then((s) => { setSuggestions(s); setHighlighted(0); }).catch(() => {});
    }, 200);
    return () => clearTimeout(handle);
  }, [value, field]);

  function pick(s: string) {
    onChange(s.includes(" - ") ? s.split(" - ")[0] : s);
    onSelectRaw?.(s);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(suggestions[highlighted] ?? suggestions[0]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <GlassInput
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.value); setOpen(true); announceOpen(); }}
        onFocus={() => { setOpen(true); announceOpen(); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      <AnimatePresence>
        {open && suggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            // ITEM PASS 6 (Part 5/6, glass surface hierarchy): shared
            // Level 3 tokens instead of an ad hoc navy2/95 value - this is
            // the reusable autocomplete used by Salesman Categorization
            // and Vacations, so this one fix covers both.
            className="absolute z-[9999] mt-1.5 max-h-[180px] min-w-full overflow-y-auto rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg-3)] p-1 shadow-elevation2 backdrop-blur-[var(--glass-blur-3)] backdrop-saturate-[200%]"
          >
            {suggestions.map((s, i) => (
              <div
                key={s}
                onMouseDown={() => pick(s)}
                onMouseEnter={() => setHighlighted(i)}
                className="cursor-pointer rounded-md px-2.5 py-1.5 text-[13px] text-ink transition-colors hover:bg-[var(--row-hover)]"
                style={{ background: i === highlighted ? "var(--row-hover)" : undefined }}
              >
                {s}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
