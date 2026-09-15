import { useEffect, useRef } from "react";
import { getFederatedSupabaseClients } from "@/lib/supabase";

/** One grouped Realtime channel per mounted operational screen. */
export function useOperationalRealtime(channelName: string, tables: string[], onChange: () => void): void {
  const callbackRef = useRef(onChange);
  callbackRef.current = onChange;
  const tableKey = tables.join("|");
  useEffect(() => {
    const channels = getFederatedSupabaseClients().map((client, index) => {
      let channel = client.channel(`ops-${channelName}-${index}`);
      for (const table of tableKey.split("|").filter(Boolean)) {
        channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, () => callbackRef.current());
      }
      channel.subscribe();
      return { client, channel };
    });
    return () => { for (const item of channels) void item.client.removeChannel(item.channel); };
  }, [channelName, tableKey]);
}
