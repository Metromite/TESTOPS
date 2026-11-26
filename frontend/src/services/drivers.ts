import { makeCrudService } from "./crud";
import type { Driver } from "./types";

const baseDriversService = makeCrudService<Driver>("drivers");

// The Fleet UI uses `name` as its display field, while the live drivers
// table also has a NOT NULL canonical `driver_name` column. Keep both in
// sync on manual create/update so inserts never omit the required column.
function normalizeDriver(row: any): Driver {
  const name = String(row?.name || row?.driver_name || "");
  return { ...row, name, driver_name: String(row?.driver_name || name) } as Driver;
}

export const driversService = {
  ...baseDriversService,
  async list(opts?: Parameters<typeof baseDriversService.list>[0]): Promise<Driver[]> {
    return (await baseDriversService.list(opts)).map(normalizeDriver);
  },
  async create(row: Partial<Driver>): Promise<Driver> {
    const name = String((row as any).name || (row as any).driver_name || "").trim();
    return normalizeDriver(await baseDriversService.create({ ...row, name, driver_name: name } as any));
  },
  async update(id: string, patch: Partial<Driver>): Promise<Driver> {
    const next: any = { ...patch };
    if (Object.prototype.hasOwnProperty.call(next, "name") || Object.prototype.hasOwnProperty.call(next, "driver_name")) {
      const name = String(next.name || next.driver_name || "").trim();
      next.name = name;
      next.driver_name = name;
    }
    return normalizeDriver(await baseDriversService.update(id, next));
  },
};

/** Convenience lookup by the business code (matches old app's /drivers/{code} usage). */
export async function getDriverByCode(code: string): Promise<Driver | null> {
  const { supabase } = await import("@/lib/supabase");
  const { data, error } = await supabase.from("drivers").select("*").eq("code", code).maybeSingle();
  if (error) throw new Error(`Failed to fetch driver ${code}: ${error.message}`);
  return data ? normalizeDriver(data) : null;
}
