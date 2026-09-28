import { CheckCircle2, Download, Loader2, X, XCircle } from "lucide-react";
import type { ExportProgress } from "../services/desktopExport";

export default function ExportStatus({ state, onClose }: { state: ExportProgress | null; onClose?: () => void }) {
  if (!state) return null;
  const Icon = state.status === "success" ? CheckCircle2 : state.status === "error" ? XCircle : state.status === "saving" ? Download : Loader2;
  return (
    <div className="glass-card" style={{ minWidth: 310, padding: "10px 12px", marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon className={state.status === "preparing" ? "animate-spin" : ""} style={{ width: 16, height: 16 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{state.message}</div>
          {state.path && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2, wordBreak: "break-all" }}>{state.path}</div>}
        </div>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>{state.pct}%</span>
        {(state.status === "success" || state.status === "error") && onClose && (
          <button type="button" onClick={onClose} aria-label="Close export status" title="Close" style={{ border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", padding: 3 }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        )}
      </div>
      <div style={{ background: "var(--navy3)", borderRadius: 999, height: 6, overflow: "hidden", marginTop: 8 }}>
        <div style={{ width: `${state.pct}%`, background: state.status === "error" ? "var(--red)" : "var(--teal)", height: "100%", transition: "width .25s ease" }} />
      </div>
    </div>
  );
}
