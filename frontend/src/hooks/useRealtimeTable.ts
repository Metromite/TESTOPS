// ============================================================================
// Centralized Realtime subscription hook (architecture brief section 23).
//
// One channel per (table, filter) pair, ref-counted so five components
// mounting the same table in the same render pass share one Postgres
// Changes subscription instead of opening five — "do not create one
// uncontrolled subscription every time a component renders", per the
// brief. Cleans up (unsubscribes) automatically when the last consumer
// of a given channel unmounts.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { getFederatedSupabaseClients } from "@/lib/supabase";

type ChangeHandler<T extends Record<string, unknown>> = (payload: RealtimePostgresChangesPayload<T>) => void;

interface ChannelEntry {
  refCount: number;
  channel: any;
  handlers: Set<ChangeHandler<any>>;
  extraChannels?: any[];
}

const channels = new Map<string, ChannelEntry>();

function channelKey(table: string, filter?: string): string {
  return filter ? `${table}:${filter}` : table;
}

function subscribe<T extends Record<string, unknown>>(
  table: string,
  handler: ChangeHandler<T>,
  filter?: string
): () => void {
  const key = channelKey(table, filter);
  let entry = channels.get(key);

  if (!entry) {
    // One subscription per project so changes in either database refresh the
    // same UI state.
    const clients = getFederatedSupabaseClients();
    const channel = clients[0].channel(`db-${key}`);
    const extraChannels = clients.slice(1).map((client) => client.channel(`db-${key}-secondary`));
    const allChannels = [channel, ...extraChannels];
    const dispatch = (payload: RealtimePostgresChangesPayload<T>) => {
      const current = channels.get(key);
      current?.handlers.forEach((h) => h(payload));
    };
    for (const ch of allChannels) {
      ch.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, dispatch);
      ch.subscribe();
    }
    entry = { refCount: 0, channel, handlers: new Set(), extraChannels: allChannels.slice(1) } as ChannelEntry & { extraChannels: any[] };
    channels.set(key, entry);
  }

  entry.refCount += 1;
  entry.handlers.add(handler);

  return () => {
    const current = channels.get(key) as (ChannelEntry & { extraChannels?: any[] }) | undefined;
    if (!current) return;
    current.handlers.delete(handler);
    current.refCount -= 1;
    if (current.refCount <= 0) {
      const clients = getFederatedSupabaseClients();
      void clients[0].removeChannel(current.channel);
      for (let i = 0; i < (current.extraChannels || []).length; i++) void clients[i + 1].removeChannel(current.extraChannels![i]);
      channels.delete(key);
    }
  };
}

/** Subscribes to INSERT/UPDATE/DELETE on `table` (optionally filtered,
 * e.g. `plan_batch_id=eq.${batchId}`) and calls `onChange` for each
 * event. Handles reconnection automatically — the underlying
 * supabase-js Realtime client reconnects its websocket on its own; this
 * hook only needs to (re)attach the same channel key, which happens for
 * free since the channel map persists across the reconnect. */
export function useRealtimeTable<T extends Record<string, unknown>>(
  table: string,
  onChange: ChangeHandler<T>,
  filter?: string
) {
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;

  useEffect(() => {
    const stableHandler: ChangeHandler<T> = (payload) => handlerRef.current(payload);
    const unsubscribe = subscribe<T>(table, stableHandler, filter);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filter]);
}

/** Convenience variant for the common case: keep a list of rows in sync
 * with a table via Realtime, seeded from an initial fetch. */
export function useRealtimeList<T extends { id: string }>(
  table: string,
  fetchInitial: () => Promise<T[]>,
  filter?: string
): { rows: T[]; loading: boolean; error: string | null } {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchInitial()
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filter]);

  useRealtimeTable<T & Record<string, unknown>>(
    table,
    (payload) => {
      setRows((prev) => {
        if (payload.eventType === "INSERT") {
          const newRow = payload.new as T;
          return prev.some((r) => r.id === newRow.id) ? prev : [...prev, newRow];
        }
        if (payload.eventType === "UPDATE") {
          const newRow = payload.new as T;
          return prev.map((r) => (r.id === newRow.id ? newRow : r));
        }
        if (payload.eventType === "DELETE") {
          const oldRow = payload.old as Partial<T>;
          return prev.filter((r) => r.id !== oldRow.id);
        }
        return prev;
      });
    },
    filter
  );

  return { rows, loading, error };
}
