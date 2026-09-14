import { useEffect, useState, FormEvent, useRef } from "react";
import { api } from "../api/client";
import { useTheme } from "../theme/ThemeProvider";

interface ProviderInfo { key: string; label: string; needs_key: boolean; default_model: string; }
interface FallbackChainEntry { provider: string; model: string; api_key_set: boolean }
interface Config {
  provider: string; model: string; api_key_set: boolean;
  fallback_enabled: boolean; fallback_chain: FallbackChainEntry[];
}
interface EditableFallback { provider: string; model: string; api_key: string; api_key_set: boolean }

export default function AiSettings() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [chain, setChain] = useState<EditableFallback[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [reindexResult, setReindexResult] = useState<any>(null);

  async function load() {
    try {
      const [p, c] = await Promise.all([api.get("/ai/providers"), api.get("/ai/config")]);
      setProviders(p.providers);
      setCfg(c);
      setChain(c.fallback_chain.map((f: FallbackChainEntry) => ({ ...f, api_key: "" })));
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => { load(); }, []);

  function addFallback() {
    setChain([...chain, { provider: providers[0]?.key || "ollama", model: "", api_key: "", api_key_set: false }]);
  }
  function removeFallback(i: number) {
    setChain(chain.filter((_, idx) => idx !== i));
  }
  function updateFallback(i: number, field: keyof EditableFallback, value: string) {
    setChain(chain.map((c, idx) => (idx === i ? { ...c, [field]: value } : c)));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!cfg) return;
    setError("");
    setSaved(false);
    try {
      await api.put("/ai/config", {
        provider: cfg.provider, model: cfg.model, api_key: apiKey,
        fallback_enabled: cfg.fallback_enabled,
        fallback_chain: chain.map((c) => ({ provider: c.provider, model: c.model, api_key: c.api_key })),
      });
      setApiKey("");
      setSaved(true);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleReindex() {
    setError("");
    try {
      setReindexResult(await api.post("/ai/reindex", {}));
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (error && !cfg) return <div className="page"><div className="glass-card error-text">{error}</div></div>;
  if (!cfg) return <div className="page">Loading...</div>;

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <h2>AI Settings</h2>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -8 }}>
        Choose which AI provider powers the LOGI Assistant. API keys are never sent back to
        the browser once saved - only whether one is set.
      </p>

      <form className="glass-card" onSubmit={handleSave} style={{ marginBottom: 20 }}>
        <div className="field" style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>Primary Provider</label>
          <select value={cfg.provider} onChange={(e) => setCfg({ ...cfg, provider: e.target.value })} style={{ width: "100%" }}>
            {providers.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>Model (blank = provider default)</label>
          <input value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} style={{ width: "100%" }} />
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>
            API Key {cfg.api_key_set && <span style={{ color: "var(--green)" }}>(currently set)</span>}
          </label>
          <input type="password" placeholder={cfg.api_key_set ? "Leave blank to keep current key" : "Enter API key"}
                 value={apiKey} onChange={(e) => setApiKey(e.target.value)} style={{ width: "100%" }} />
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "16px 0" }} />

        <div className="field" style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={cfg.fallback_enabled} onChange={(e) => setCfg({ ...cfg, fallback_enabled: e.target.checked })} />
          <label style={{ fontSize: 13 }}>Enable fallback chain if the primary provider fails (e.g. free quota exhausted)</label>
        </div>

        {cfg.fallback_enabled && (
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 12, color: "var(--muted)" }}>
              Tried in order after the primary fails - stops at the first one that succeeds.
            </p>
            {chain.map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 8, background: "var(--navy3)", padding: 10, borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: "var(--muted)", minWidth: 18 }}>#{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>Provider</label>
                  <select value={f.provider} onChange={(e) => updateFallback(i, "provider", e.target.value)} style={{ width: "100%" }}>
                    {providers.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>Model</label>
                  <input value={f.model} onChange={(e) => updateFallback(i, "model", e.target.value)} placeholder="default" style={{ width: "100%" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>
                    API Key {f.api_key_set && <span style={{ color: "var(--green)" }}>✓ set</span>}
                  </label>
                  <input type="password" value={f.api_key} onChange={(e) => updateFallback(i, "api_key", e.target.value)}
                         placeholder={f.api_key_set ? "keep current" : "key / endpoint"} style={{ width: "100%" }} />
                </div>
                <button type="button" className="btn" style={{ background: "var(--red)" }} onClick={() => removeFallback(i)}>×</button>
              </div>
            ))}
            <button type="button" className="btn" style={{ background: "var(--navy3)", color: "var(--muted)" }} onClick={addFallback}>
              + Add fallback provider
            </button>
          </div>
        )}

        <button className="btn" type="submit" style={{ width: "100%", marginTop: 10 }}>Save Settings</button>
        {saved && <div style={{ color: "var(--green)", fontSize: 13, marginTop: 8 }}>Saved.</div>}
      </form>

      {error && <div className="glass-card error-text" style={{ marginBottom: 20 }}>{error}</div>}

      <div className="glass-card" style={{ marginBottom: 20 }}>
        <strong>Search Index</strong>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          The assistant searches a local index of your drivers/routes/vehicles/vacations data.
          It refreshes automatically on each chat message, but you can force it now.
        </p>
        <button className="btn" onClick={handleReindex}>Rebuild Index Now</button>
        {reindexResult && (
          <pre style={{ fontSize: 11, color: "var(--muted)", marginTop: 10, background: "var(--navy3)", padding: 10, borderRadius: 8 }}>
            {JSON.stringify(reindexResult, null, 2)}
          </pre>
        )}
      </div>

      <AppearanceSettings />
    </div>
  );
}

function AppearanceSettings() {
  const lightRef = useRef<HTMLInputElement>(null);
  const darkRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");
  const { refreshBackground } = useTheme();

  async function upload(mode: "light" | "dark", fileInput: HTMLInputElement | null) {
    const file = fileInput?.files?.[0];
    if (!file) return;
    setMsg("");
    const token = localStorage.getItem("access_token");
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`/api/appearance/upload/${mode}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Upload failed");
      setMsg(`${mode === "light" ? "Light" : "Dark"} mode background updated.`);
      refreshBackground();
      if (fileInput) fileInput.value = "";
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  async function reset(mode: "light" | "dark") {
    try {
      await fetch(`/api/appearance/reset/${mode}`, { method: "DELETE" });
      setMsg(`${mode === "light" ? "Light" : "Dark"} mode background reset to default.`);
      refreshBackground();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  return (
    <div className="glass-card">
      <strong>Appearance — Background Images</strong>
      <p style={{ fontSize: 13, color: "var(--muted)" }}>
        Upload a custom background for light mode and dark mode independently. Changes apply
        immediately for everyone, and can be changed again at any time.
      </p>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Light Mode Background</label>
          <input ref={lightRef} type="file" accept="image/*" style={{ maxWidth: 200 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn" onClick={() => upload("light", lightRef.current)}>Upload</button>
            <button className="btn" style={{ background: "var(--navy3)", color: "var(--muted)" }} onClick={() => reset("light")}>Reset</button>
          </div>
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Dark Mode Background</label>
          <input ref={darkRef} type="file" accept="image/*" style={{ maxWidth: 200 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn" onClick={() => upload("dark", darkRef.current)}>Upload</button>
            <button className="btn" style={{ background: "var(--navy3)", color: "var(--muted)" }} onClick={() => reset("dark")}>Reset</button>
          </div>
        </div>
      </div>
      {msg && <div style={{ fontSize: 12, color: "var(--teal)", marginTop: 10 }}>{msg}</div>}
    </div>
  );
}
