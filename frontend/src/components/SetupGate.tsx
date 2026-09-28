import { ReactNode, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useConnectionStatus } from "../hooks/useConnectionStatus";

/**
 * ZERO-BLOCK ARCHITECTURE (unchanged principle from the old backend-era
 * version of this file, now pointed at Supabase instead of a local
 * backend sidecar): nothing outside the main UI is allowed to prevent
 * DispatchOPS from opening. `children` (the real app shell/routes) is
 * ALWAYS rendered. Connection status is shown as a small, dismissible,
 * non-blocking banner stacked on top of the app instead of replacing
 * it - never a full-screen gate.
 *
 * There is no more "needs-setup" state: the old one meant "no shared
 * OneDrive sync folder has been chosen yet", which doesn't exist in the
 * Supabase architecture - every install already knows how to reach the
 * one shared Supabase project (baked in at build time), so there is
 * nothing left to choose on first run (architecture brief section 15).
 */
export default function SetupGate({ children }: { children: ReactNode }) {
  const { status, retryNow } = useConnectionStatus();
  const [dismissed, setDismissed] = useState(false);

  const showBanner = (status === "connecting" || status === "reconnecting" || status === "offline") && !dismissed;

  const message =
    status === "offline"
      ? "Cloud data temporarily unavailable. The app is still open - some data may be unavailable until this reconnects."
      : status === "reconnecting"
        ? "Reconnecting to cloud data\u2026 the app is usable now; live data will resume once it connects."
        : "Connecting to cloud data\u2026 the app is usable now; live data will appear once it connects.";

  return (
    <>
      {showBanner && (
        <div
          role="status"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            background: status === "offline" ? "rgba(120,30,30,0.95)" : "rgba(30,40,60,0.95)",
            color: "#fff",
            fontSize: 13,
            padding: "8px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ flex: "1 1 auto" }}>{message}</span>
          <button className="btn" style={{ fontSize: 12, padding: "2px 10px" }} onClick={retryNow}>
            Retry now
          </button>
          <button
            aria-label="Dismiss"
            className="btn"
            style={{ fontSize: 12, padding: "2px 10px" }}
            onClick={() => setDismissed(true)}
          >
            Dismiss
          </button>
        </div>
      )}
      {children}
    </>
  );
}
