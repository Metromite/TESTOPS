/**
 * lib/domainIcons.tsx
 * --------------------
 * ITEM 16 (Icons everywhere) / ITEM 4 (every dropdown OPTION needs its own
 * icon, not just the dropdown itself):
 *
 * MultiSelectSlicer already gives every filter (Driver/Division/Facility
 * Type/Area/Vehicle Type/Route Type/Salesman) its own icon in the trigger
 * button and reused it for every option inside. This maps individual
 * option VALUES to their own icon, for the domains where the real values
 * are known ahead of time:
 *   - Facility types: keys of backend/app/data/facility_keyword_map.json
 *     (Hospital, Representative, Government, Dental Clinic, Store,
 *     Supermarket, Pharmacy, Medical clinic, Medical Lab, Medical Equip)
 *   - Divisions: "Pharma" / "Consumer" (pages/Fleet.tsx meta.divisions)
 *   - Vehicle types: Pick-Up / Van / 2-8 Van / 2-8 Pick-Up / Bus (plus
 *     whatever /api/meta/options returns at runtime - falls back to a
 *     generic truck icon for any value not in the static map, since
 *     vehicle type is free text and not a fixed enum, see item 10)
 *   - Route types: Main Route / Second Trip / Urgent & Government / Fleet
 *     / Cold Chain
 *
 * Matching is case-insensitive substring matching against these known
 * keywords (mirrors how facility_keyword_map.json itself is used
 * elsewhere: partial/keyword matching, not exact-string equality), so new
 * values that are close variants of a known one still get a sensible
 * icon instead of always falling through to the generic fallback.
 */
import {
  Building2, Landmark, Stethoscope, Store, ShoppingCart, Pill, Microscope,
  HeartPulse, Users, Truck, Bus, Car, Route, Snowflake, AlertTriangle,
  Repeat, MapPinned, type LucideIcon,
} from "lucide-react";

const FACILITY_ICONS: [string, LucideIcon][] = [
  ["hospital", Building2],
  ["representative", Users],
  ["government", Landmark],
  ["dental", Stethoscope],
  ["store", Store],
  ["supermarket", ShoppingCart],
  ["pharmacy", Pill],
  ["medical clinic", Stethoscope],
  ["medical lab", Microscope],
  ["medical equip", HeartPulse],
  ["clinic", Stethoscope],
  ["warehouse", Building2],
];

const DIVISION_ICONS: [string, LucideIcon][] = [
  ["pharma", Pill],
  ["consumer", ShoppingCart],
];

const VEHICLE_ICONS: [string, LucideIcon][] = [
  ["bus", Bus],
  ["van", Car],
  ["pick-up", Truck],
  ["pickup", Truck],
  ["truck", Truck],
];

const ROUTE_TYPE_ICONS: [string, LucideIcon][] = [
  ["second trip", Repeat],
  ["urgent", AlertTriangle],
  ["government", Landmark],
  ["cold chain", Snowflake],
  ["fleet", Truck],
  ["main route", Route],
];

function lookup(value: string, table: [string, LucideIcon][]): LucideIcon | null {
  const v = value.toLowerCase();
  for (const [keyword, icon] of table) {
    if (v.includes(keyword)) return icon;
  }
  return null;
}

/**
 * Best-effort per-option icon for a dropdown filter, given the filter's
 * label (e.g. "Facility Type") and the specific option value. Falls back
 * to the group's own icon (whatever the dropdown trigger already uses)
 * when the value isn't in a known domain, and to MapPinned as a last
 * resort so an option is never fully icon-less.
 */
export function getOptionIcon(filterLabel: string, value: string, fallback?: LucideIcon): LucideIcon {
  const label = filterLabel.toLowerCase();
  let found: LucideIcon | null = null;
  if (label.includes("facility")) found = lookup(value, FACILITY_ICONS);
  else if (label.includes("division")) found = lookup(value, DIVISION_ICONS);
  else if (label.includes("vehicle")) found = lookup(value, VEHICLE_ICONS);
  else if (label.includes("route")) found = lookup(value, ROUTE_TYPE_ICONS);
  else if (label.includes("area")) found = MapPinned;
  return found || fallback || MapPinned;
}
