import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import DashboardConfigTab from "./DashboardConfigTab";
import { featureFlagsService } from "../services/system";
import { getRole } from "../api/client";

const PAGE_VISIBILITY = [
  { path: "/route-intelligence", label: "Route Intelligence" },
  { path: "/control-center", label: "Control Center" },
];

export default function DashboardConfigurationPage() {
  const [hidden, setHidden] = useState<string[]>([]);
  const [busy, setBusy] = useState<string>("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    featureFlagsService.list().then((flags) => {
      setHidden(flags.filter((f) => f.name.startsWith("page_visible:") && !f.enabled).map((f) => f.name.slice("page_visible:".length)));
    }).catch((e) => setMessage(e instanceof Error ? e.message : String(e)));
  }, []);

  async function toggle(path: string) {
    if (getRole() !== "admin") return;
    setBusy(path); setMessage("");
    try {
      const nextVisible = hidden.includes(path);
      await featureFlagsService.set(`page_visible:${path}`, nextVisible, sessionStorage.getItem("dispatchops-username") || "admin", `${path} visibility for non-admin users`);
      setHidden((current) => nextVisible ? current.filter((x) => x !== path) : [...current, path]);
      setMessage(nextVisible ? `${path} is now visible to users.` : `${path} is now hidden from users. Admins can still access it.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally { setBusy(""); }
  }

  return (
    <div className="page">
      <h2>Dashboard Configuration</h2>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        Rules that exclude or reclassify data before it reaches the Dashboard/reporting numbers.
      </p>

      {getRole() === "admin" && (
        <div className="glass-card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
            <div>
              <h3 style={{ margin: 0 }}>Page Visibility</h3>
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 3 }}>Hide pages from regular users while keeping them available to Admin.</div>
            </div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {PAGE_VISIBILITY.map((page) => {
              const isHidden = hidden.includes(page.path);
              return (
                <div key={page.path} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", border: "1px solid var(--glass-border)", borderRadius: 12 }}>
                  <div><strong>{page.label}</strong><div style={{ color: "var(--muted)", fontSize: 11 }}>{page.path}</div></div>
                  <button className="btn" type="button" disabled={busy === page.path} onClick={() => void toggle(page.path)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {isHidden ? <EyeOff size={14} /> : <Eye size={14} />} {isHidden ? "Hidden for Users" : "Visible to Users"}
                  </button>
                </div>
              );
            })}
          </div>
          {message && <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 12 }}>{message}</div>}
        </div>
      )}

      <DashboardConfigTab />
    </div>
  );
}
