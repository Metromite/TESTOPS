// ============================================================================
// Connection status (architecture brief sections 3, 13, 14):
//   - The app UI must render regardless of this hook's state — nothing
//     here ever blocks or throws during render.
//   - Reflects "Cloud data temporarily unavailable. Reconnecting..." via
//     `status`, polled with backoff, and re-checks immediately when the
//     browser/webview's own online/offline events fire.
//   - Settings/Admin UI must remain reachable regardless of `status` —
//     this hook only reports state, it never gates navigation.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline";

const POLL_INTERVAL_MS = 5000;

export function useConnectionStatus(): { status: ConnectionStatus; retryNow: () => void } {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const wasConnected = useRef(false);

  async function check() {
    if (!isSupabaseConfigured) {
      setStatus("offline");
      return;
    }
    try {
      // Cheapest possible round trip that still proves the anon key and
      // RLS policy actually work, not just that DNS resolves — a
      // head-only count against a small, always-present table.
      const { error } = await supabase.from("sap_invoice_facts").select("invoice_number").limit(1);
      if (error) throw error;
      wasConnected.current = true;
      setStatus("connected");
    } catch {
      setStatus(wasConnected.current ? "reconnecting" : "connecting");
    }
  }

  useEffect(() => {
    check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    const onOnline = () => check();
    const onOffline = () => setStatus(wasConnected.current ? "reconnecting" : "connecting");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, retryNow: check };
}
