import { getPrimarySupabaseClient, getSecondarySupabaseClient, getTertiarySupabaseClient } from "@/lib/supabase";

export interface DatabaseStats { usedBytes:number; capacityBytes:number; remainingBytes:number; percentUsed:number; }

export interface StorageStats {
  fileCount: number;
  bytesUsed: number;
  bucket: string;
  primaryBytesUsed: number;
  secondaryBytesUsed: number;
  primaryFileCount: number;
  secondaryFileCount: number;
  primaryCapacityBytes: number;
  secondaryCapacityBytes: number;
  primaryPercentUsed: number;
  secondaryPercentUsed: number;
  tertiaryBytesUsed: number;
  tertiaryFileCount: number;
  tertiaryCapacityBytes: number;
  tertiaryPercentUsed: number;
  totalCapacityBytes: number;
  totalPercentUsed: number;
}

const BUCKET = "dispatchops-files";
const CAPACITY = 1024 * 1024 * 1024;

async function walk(client: ReturnType<typeof getPrimarySupabaseClient>, prefix = ""): Promise<{ count: number; bytes: number }> {
  let count = 0, bytes = 0, offset = 0;
  while (true) {
    const { data, error } = await client.storage.from(BUCKET).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(error.message);
    const items = data ?? [];
    for (const item of items) {
      if (item.id) { count++; bytes += Number(item.metadata?.size ?? 0); }
      else if (item.name && item.name !== ".emptyFolderPlaceholder") {
        const child = await walk(client, prefix ? `${prefix}/${item.name}` : item.name);
        count += child.count; bytes += child.bytes;
      }
    }
    if (items.length < 1000) break;
    offset += 1000;
  }
  return { count, bytes };
}

export async function getDispatchopsStorageStats(): Promise<StorageStats> {
  const primary = getPrimarySupabaseClient();
  const secondary = getSecondarySupabaseClient();
  const tertiary = getTertiarySupabaseClient();
  const [p, s, t] = await Promise.all([walk(primary), secondary ? walk(secondary) : Promise.resolve({ count: 0, bytes: 0 }), tertiary ? walk(tertiary) : Promise.resolve({ count: 0, bytes: 0 })]);
  const totalBytes = p.bytes + s.bytes + t.bytes;
  return {
    fileCount: p.count + s.count + t.count, bytesUsed: totalBytes, bucket: BUCKET,
    primaryBytesUsed: p.bytes, secondaryBytesUsed: s.bytes, tertiaryBytesUsed: t.bytes,
    primaryFileCount: p.count, secondaryFileCount: s.count, tertiaryFileCount: t.count,
    primaryCapacityBytes: CAPACITY, secondaryCapacityBytes: secondary ? CAPACITY : 0, tertiaryCapacityBytes: tertiary ? CAPACITY : 0,
    primaryPercentUsed: p.bytes / CAPACITY * 100,
    secondaryPercentUsed: secondary ? s.bytes / CAPACITY * 100 : 0,
    tertiaryPercentUsed: tertiary ? t.bytes / CAPACITY * 100 : 0,
    totalCapacityBytes: CAPACITY * (1 + (secondary ? 1 : 0) + (tertiary ? 1 : 0)),
    totalPercentUsed: totalBytes / (CAPACITY * (1 + (secondary ? 1 : 0) + (tertiary ? 1 : 0))) * 100,
  };
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 MB";
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}


const DATABASE_CAPACITY = 500 * 1024 * 1024; // Supabase default database quota used by this UI; can be changed centrally later.

export async function getDispatchopsDatabaseStats(): Promise<{ primary: DatabaseStats | null; secondary: DatabaseStats | null; tertiary: DatabaseStats | null }> {
  const projects = [
    { name: "primary" as const, client: getPrimarySupabaseClient() },
    { name: "secondary" as const, client: getSecondarySupabaseClient() },
    { name: "tertiary" as const, client: getTertiarySupabaseClient() },
  ];
  const pairs = await Promise.all(projects.map(async ({ name, client }) => {
    if (!client) return [name, null] as const;
    try {
      const { data, error } = await client.rpc("dispatchops_database_size");
      if (error) return [name, null] as const;
      const used = Math.max(0, Number((data as any)?.used_bytes ?? data ?? 0));
      if (!Number.isFinite(used) || used <= 0) return [name, null] as const;
      return [name, { usedBytes: used, capacityBytes: DATABASE_CAPACITY, remainingBytes: Math.max(0, DATABASE_CAPACITY - used), percentUsed: used / DATABASE_CAPACITY * 100 }] as const;
    } catch {
      return [name, null] as const;
    }
  }));
  return Object.fromEntries(pairs) as { primary: DatabaseStats | null; secondary: DatabaseStats | null; tertiary: DatabaseStats | null };
}
