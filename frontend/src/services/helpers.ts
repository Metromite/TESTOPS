import { makeCrudService } from "./crud";
import type { Helper } from "./types";

const baseHelpersService = makeCrudService<Helper>("helpers");

// The Helpers UI uses `name`, while the live helpers table requires
// `helper_name`. Keep both columns synchronized for manual writes.
function normalizeHelper(row: any): Helper {
  const name = String(row?.name || row?.helper_name || "");
  return { ...row, name, helper_name: String(row?.helper_name || name) } as Helper;
}

export const helpersService = {
  ...baseHelpersService,
  async list(opts?: Parameters<typeof baseHelpersService.list>[0]): Promise<Helper[]> {
    return (await baseHelpersService.list(opts)).map(normalizeHelper);
  },
  async create(row: Partial<Helper>): Promise<Helper> {
    const name = String((row as any).name || (row as any).helper_name || "").trim();
    return normalizeHelper(await baseHelpersService.create({ ...row, name, helper_name: name } as any));
  },
  async update(id: string, patch: Partial<Helper>): Promise<Helper> {
    const next: any = { ...patch };
    if (Object.prototype.hasOwnProperty.call(next, "name") || Object.prototype.hasOwnProperty.call(next, "helper_name")) {
      const name = String(next.name || next.helper_name || "").trim();
      next.name = name;
      next.helper_name = name;
    }
    return normalizeHelper(await baseHelpersService.update(id, next));
  },
};
