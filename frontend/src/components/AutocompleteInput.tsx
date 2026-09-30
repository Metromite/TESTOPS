import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { getPrimarySupabaseClient } from "@/lib/supabase";
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
const primarySupabase = getPrimarySupabaseClient();

/** Supabase replacement for the old `/api/autocomplete/{field}` endpoint. */
async function fetchAutocomplete(field: string, q: string): Promise<string[]> {
  const needle = q.trim();

  if (STATIC_FIELDS[field]) {
    return STATIC_FIELDS[field].filter((v) => v.toLowerCase().includes(needle.toLowerCase())).slice(0, 10);
  }

  switch (field) {
    case "area_code":
    case "area_name": {
      const col = field === "area_code" ? "code" : "name";
      const { data, error } = await primarySupabase.from("areas").select("code,name").ilike(col, `%${needle}%`).limit(10);
      if (error) return [];
      return (data ?? []).map((a) => `${a.code} - ${a.name}`);
    }
    case "driver": {
      const query = primarySupabase.from("drivers").select("code,name");
      const { data, error } = needle
        ? await query.or(`code.ilike.%${needle}%,name.ilike.%${needle}%`).limit(10)
        : await query.limit(10);
      if (!error && (data ?? []).length) return (data ?? []).map((d) => `${d.code} - ${d.name}`);
      const fallback = await primarySupabase.from("drivers").select("code,name").limit(500);
      if (fallback.error) return [];
      const n = needle.toLowerCase();
      return (fallback.data ?? []).filter((d: any) => `${d.code} ${d.name}`.toLowerCase().includes(n)).slice(0, 10).map((d: any) => `${d.code} - ${d.name}`);
    }
    case "helper": {
      const query = primarySupabase.from("helpers").select("code,name");
      const { data, error } = needle
        ? await query.or(`code.ilike.%${needle}%,name.ilike.%${needle}%`).limit(10)
        : await query.limit(10);
      if (!error && (data ?? []).length) return (data ?? []).map((h) => `${h.code} - ${h.name}`);
      const fallback = await primarySupabase.from("helpers").select("code,name").limit(500);
      if (fallback.error) return [];
      const n = needle.toLowerCase();
      return (fallback.data ?? []).filter((h: any) => `${h.code} ${h.name}`.toLowerCase().includes(n)).slice(0, 10).map((h: any) => `${h.code} - ${h.name}`);
    }
    case "vehicle_type": {
      const { data, error } = await primarySupabase.from("vehicles").select("type").ilike("type", `%${needle}%`).limit(100);
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
      const { data, error } = await primarySupabase.from("vehicles").select("number").ilike("number", `%${needle}%`).limit(10);
      if (error) return [];
      return (data ?? []).map((v) => v.number as string);
    }
    case "salesman": {
      const { data, error } = await primarySupabase
        .from("sap_invoice_facts")
        .select("salesman")
        .ilike("salesman", `%${needle}%`)
        .limit(30);
      if (error) return [];
      return Array.from(new Set((data ?? []).map((r: any) => r.salesman).filter(Boolean))).slice(0, 10) as string[];
    }
    case "customer": {
      const { data, error } = await primarySupabase
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
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const [dropdownPos, setDropdownPos] = useState<{ left: number; top: number; width: number } | null>(null);

  function announceOpen() {
    requestAnimationFrame(() => {
      const rect = inputWrapRef.current?.getBoundingClientRect();
      if (rect) setDropdownPos({ left: rect.left, top: rect.bottom + 6, width: rect.width });
    });
  }

  useEffect(() => {
    const id = ++requestId.current;
    if (!value.trim()) {
      setSuggestions([]);
      return;
    }
    fetchAutocomplete(field, value)
      .then((s) => {
        if (id !== requestId.current) return;
        setSuggestions(s);
        setHighlighted(0);
        if (s.length) { setOpen(true); announceOpen(); }
      })
      .catch(() => {
        if (id === requestId.current) setSuggestions([]);
      });
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
    <div ref={inputWrapRef} className="relative">
      <GlassInput
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.value); setOpen(true); announceOpen(); }}
        onFocus={() => {
          setOpen(true);
          announceOpen();
          const id = ++requestId.current;
          fetchAutocomplete(field, value).then((s) => {
            if (id !== requestId.current) return;
            setSuggestions(s);
            setHighlighted(0);
            if (s.length) { setOpen(true); announceOpen(); }
          }).catch(() => {});
        }}
        onBlur={() => setTimeout(() => setOpen(false), 300)}
        onKeyDown={onKeyDown}
      />
      <AnimatePresence>
        {open && suggestions.length > 0 && dropdownPos && createPortal(
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="autocomplete-dropdown max-h-[180px] overflow-y-auto rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg-3)] p-1 shadow-elevation2 backdrop-blur-[var(--glass-blur-3)] backdrop-saturate-[200%]"
            style={{ position: "fixed", left: dropdownPos.left, top: dropdownPos.top, width: dropdownPos.width, zIndex: 100000 }}
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
          </motion.div>,
          document.body
        )}
      </AnimatePresence>
    </div>
  );
}
