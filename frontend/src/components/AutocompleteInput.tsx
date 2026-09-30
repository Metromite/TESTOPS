import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { supabase, getPrimarySupabaseClient } from "@/lib/supabase";
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

// Driver/helper pools are loaded once from Primary and filtered locally.
// This restores the old predictive behavior: suggestions appear immediately
// for names or codes without firing a new database request on every keypress.
let employeePools: { drivers: string[]; helpers: string[] } | null = null;
let employeePoolPromise: Promise<{ drivers: string[]; helpers: string[] }> | null = null;

async function loadEmployeePools() {
  if (employeePools) return employeePools;
  if (employeePoolPromise) return employeePoolPromise;
  employeePoolPromise = (async () => {
    const client = getPrimarySupabaseClient();
    const [{ data: drivers }, { data: helpers }] = await Promise.all([
      client.from("drivers").select("code,name").limit(1000),
      client.from("helpers").select("code,name").limit(1000),
    ]);
    const format = (rows: any[] | null | undefined): string[] => (rows ?? [])
      .map((r: any) => {
        const code = String(r.code ?? r.driver_code ?? r.helper_code ?? "").trim();
        const name = String(r.name ?? r.driver_name ?? r.helper_name ?? "").trim();
        return code && name ? `${code} - ${name}` : code || name;
      })
      .filter((v): v is string => Boolean(v));
    employeePools = { drivers: format(drivers), helpers: format(helpers) };
    return employeePools;
  })().catch(() => {
    employeePools = { drivers: [], helpers: [] };
    return employeePools;
  });
  return employeePoolPromise;
}


/** Supabase replacement for the old `/api/autocomplete/{field}` endpoint. */
async function fetchAutocomplete(field: string, q: string): Promise<string[]> {
  const needle = q.trim().toLowerCase();
  const limit = needle ? 20 : 20;

  if (STATIC_FIELDS[field]) {
    return STATIC_FIELDS[field].filter((v) => v.toLowerCase().includes(needle)).slice(0, limit);
  }

  try {
    switch (field) {
      case "driver": {
        const pool = await loadEmployeePools();
        return pool.drivers.filter((v) => v.toLowerCase().includes(needle)).slice(0, limit);
      }
      case "helper": {
        const pool = await loadEmployeePools();
        return pool.helpers.filter((v) => v.toLowerCase().includes(needle)).slice(0, limit);
      }
      case "area_code":
      case "area_name": {
        const { data, error } = await supabase.from("areas").select("code,name").limit(500);
        if (error) return [];
        return (data ?? []).map((a: any) => `${a.code} - ${a.name}`).filter((v) => v.toLowerCase().includes(needle)).slice(0, limit);
      }
      case "vehicle_type": {
        const { data, error } = await supabase.from("vehicles").select("type").limit(500);
        if (error) return [];
        return Array.from(new Set((data ?? []).map((v: any) => String(v.type || "").trim()).filter(Boolean)))
          .filter((v) => v.toLowerCase().includes(needle)).slice(0, limit);
      }
      case "vehicle_number": {
        const { data, error } = await supabase.from("vehicles").select("number").limit(500);
        if (error) return [];
        return (data ?? []).map((v: any) => String(v.number || "").trim()).filter(Boolean).filter((v) => v.toLowerCase().includes(needle)).slice(0, limit);
      }
      case "salesman": {
        const { data, error } = await supabase.from("sap_invoice_facts").select("salesman").limit(1000);
        if (error) return [];
        return Array.from(new Set((data ?? []).map((r: any) => String(r.salesman || "").trim()).filter(Boolean))).filter((v) => v.toLowerCase().includes(needle)).slice(0, limit);
      }
      case "customer": {
        const { data, error } = await supabase.from("sap_invoice_facts").select("customer_name").limit(1000);
        if (error) return [];
        return Array.from(new Set((data ?? []).map((r: any) => String(r.customer_name || "").trim()).filter(Boolean))).filter((v) => v.toLowerCase().includes(needle)).slice(0, limit);
      }
      default:
        return [];
    }
  } catch {
    return [];
  }
}

export default function AutocompleteInput({
  field, value, onChange, placeholder, disabled, onSelectRaw, showSelectedLabel = false,
}: {
  field: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean;
  /** Optional: fires with the full raw suggestion (e.g. "D001 - John Doe")
   * before the " - " split that `onChange` receives just the code half
   * of. Lets a caller capture both halves of a driver/helper suggestion
   * at once instead of just the code. */
  onSelectRaw?: (raw: string) => void;
  showSelectedLabel?: boolean;
}) {
  const [displayValue, setDisplayValue] = useState(value);
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
  const inputWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showSelectedLabel) setDisplayValue(value);
    else if (!value) setDisplayValue("");
  }, [value, showSelectedLabel]);

  const [dropdownPos, setDropdownPos] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    function onOtherOpened(e: Event) {
      if ((e as CustomEvent).detail !== instanceId) setOpen(false);
    }
    document.addEventListener("nav-dropdown-open", onOtherOpened);
    return () => document.removeEventListener("nav-dropdown-open", onOtherOpened);
  }, [instanceId]);

  function announceOpen() {
    document.dispatchEvent(new CustomEvent("nav-dropdown-open", { detail: instanceId }));
    requestAnimationFrame(() => {
      const rect = inputWrapRef.current?.getBoundingClientRect();
      if (rect) setDropdownPos({ left: rect.left, top: rect.bottom + 6, width: rect.width });
    });
  }

  useEffect(() => {
    if (!open) return;
    const sync = () => {
      const rect = inputWrapRef.current?.getBoundingClientRect();
      if (rect) setDropdownPos({ left: rect.left, top: rect.bottom + 6, width: rect.width });
    };
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => { window.removeEventListener("resize", sync); window.removeEventListener("scroll", sync, true); };
  }, [open]);

  useEffect(() => {
    if (!value.trim()) { setSuggestions([]); return; }
    const handle = setTimeout(() => {
      fetchAutocomplete(field, value).then((s) => { setSuggestions(s); setHighlighted(0); }).catch(() => {});
    }, 200);
    return () => clearTimeout(handle);
  }, [value, field]);

  function pick(s: string) {
    const code = s.includes(" - ") ? s.split(" - ")[0] : s;
    onChange(code);
    onSelectRaw?.(s);
    if (showSelectedLabel) setDisplayValue(s);
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
        value={showSelectedLabel ? displayValue : value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => { setDisplayValue(e.target.value); onChange(e.target.value); setOpen(true); announceOpen(); }}
        onFocus={() => { setOpen(true); announceOpen(); fetchAutocomplete(field, showSelectedLabel ? displayValue : value).then((s) => { setSuggestions(s); setHighlighted(0); }).catch(() => {}); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
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
