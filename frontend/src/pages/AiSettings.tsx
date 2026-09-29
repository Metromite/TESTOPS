import { useEffect, useState, FormEvent, useRef } from "react";
import { aiProviders, getAiConfig, reindexAi, saveAiConfig } from "../services/operational";
import { useTheme } from "../theme/ThemeProvider";
import { resetWallpaper, setWallpaper } from "../services/wallpaper";
import { deleteAppUser, listAppUsers, saveAppUser, unlockAppUser, unlockLocalLogin, type AppRole, type AppUser } from "../services/appAuth";
import { getAudit } from "../services/operational";
import { getPrimarySupabaseClient, getSecondarySupabaseClient, getTertiarySupabaseClient } from "../lib/supabase";
import { MANAGEABLE_PAGES, usePageVisibility } from "../services/pageVisibility";

interface ProviderInfo { key: string; label: string; needs_key: boolean; default_model: string; }
interface FallbackChainEntry { provider: string; model: string; api_key_set: boolean }
interface Config {
  provider: string; model: string; api_key_set: boolean;
  fallback_enabled: boolean; fallback_chain: FallbackChainEntry[];
}
interface EditableFallback { provider: string; model: string; api_key: string; api_key_set: boolean }
interface ProvidersResponse { providers: ProviderInfo[] }

function formatAuditChange(e:any): string {
  const before=e?.before_state&&typeof e.before_state==="object"?e.before_state:{};
  const after=e?.after_state&&typeof e.after_state==="object"?e.after_state:{};
  const keys=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>k!=="updated_at"&&k!=="created_at"&&k!=="id");
  const changed=keys.filter(k=>JSON.stringify(before?.[k])!==JSON.stringify(after?.[k])).slice(0,6);
  if(!changed.length) return e?.action||"updated";
  return changed.map(k=>`${k}: ${JSON.stringify(before?.[k])} → ${JSON.stringify(after?.[k])}`).join(" · ");
}

export default function AiSettings() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [editingApiKey, setEditingApiKey] = useState(false);
  const [chain, setChain] = useState<EditableFallback[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [reindexResult, setReindexResult] = useState<any>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [users, setUsers] = useState<AppUser[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [userBusy, setUserBusy] = useState(false);
  const [userMsg, setUserMsg] = useState("");
  const [userForm, setUserForm] = useState<{id?:string;username:string;password:string;role:AppRole;active:boolean}>({username:"",password:"",role:"user",active:true});
  const [adminNewPassword, setAdminNewPassword] = useState("");
  const [recentUpdates, setRecentUpdates] = useState<any[]>([]);
  const [dbHealth, setDbHealth] = useState<{name:string;ok:boolean;ms:number}[]>([]);

  async function load() {
    try {
      const [p, c] = await Promise.all([
        Promise.resolve(aiProviders as ProvidersResponse),
        getAiConfig<Config>(),
      ]);
      setProviders(p.providers);
      setCfg(c);
      setChain(c.fallback_chain.map((f: FallbackChainEntry) => ({ ...f, api_key: "" })));
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    void load();
    void (async()=>{
      try {
        const entries = await getAudit<any>("");
        setRecentUpdates(entries.slice(0,5));
      } catch {}
      const targets=[
        {name:"Primary",client:getPrimarySupabaseClient()},
        {name:"Secondary",client:getSecondarySupabaseClient()},
        {name:"Tertiary",client:getTertiarySupabaseClient()},
      ];
      const results=await Promise.all(targets.map(async x=>{
        const t=performance.now();
        if (!x.client) return {name:x.name,ok:false,ms:Math.round(performance.now()-t)};
        try { const {error}=await x.client.from(x.name==="Primary"?"drivers":x.name==="Secondary"?"price_change_campaigns":"bulk_organizer_plans").select("id").limit(1); return {name:x.name,ok:!error,ms:Math.round(performance.now()-t)}; }
        catch { return {name:x.name,ok:false,ms:Math.round(performance.now()-t)}; }
      }));
      setDbHealth(results);
    })();
  }, []);

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
      await saveAiConfig({
        provider: cfg.provider, model: cfg.model, api_key: apiKey,
        fallback_enabled: cfg.fallback_enabled,
        fallback_chain: chain.map((c) => ({ provider: c.provider, model: c.model, api_key: c.api_key })),
      });
      setApiKey("");
      setEditingApiKey(false);
      setSaved(true);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleReindex() {
    setError("");
    try {
      setReindexResult(await reindexAi());
    } catch (e: any) {
      setError(e.message);
    }
  }

  const currentAdminUsername = sessionStorage.getItem("dispatchops-username") || "admin";

  async function loadUsers() {
    if (!adminPassword) { setUserMsg("Enter the current admin password first."); return; }
    setUserBusy(true); setUserMsg("");
    try {
      const rows = await listAppUsers(currentAdminUsername, adminPassword);
      setUsers(rows); setUsersLoaded(true);
    } catch (e:any) { setUserMsg(e.message || "Could not load users"); }
    finally { setUserBusy(false); }
  }

  async function changeAdminPassword() {
    if (!adminPassword || !adminNewPassword) { setUserMsg("Enter the current admin password and the new admin password first."); return; }
    setUserBusy(true); setUserMsg("");
    try {
      const rows = usersLoaded ? users : await listAppUsers(currentAdminUsername, adminPassword);
      const me = rows.find(u => u.id === sessionStorage.getItem("dispatchops-user-id")) || rows.find(u => u.username.toLowerCase() === currentAdminUsername.toLowerCase() && u.role === "admin");
      if (!me) throw new Error("Current admin account was not found.");
      const savedAdmin = await saveAppUser({adminUsername:currentAdminUsername,adminPassword,id:me.id,username:me.username,password:adminNewPassword,role:"admin",active:true});
      setAdminNewPassword("");
      setAdminPassword("");
      setUserMsg(`Admin password changed for ${savedAdmin.username}. Enter the new password next time you manage users.`);
      if (!usersLoaded) { setUsers(rows); setUsersLoaded(true); }
    } catch(e:any) { setUserMsg(e.message || "Could not change admin password"); }
    finally { setUserBusy(false); }
  }

  function resetUserForm() { setUserForm({username:"",password:"",role:"user",active:true}); }

  async function saveUser() {
    if (!adminPassword) { setUserMsg("Enter the current admin password first."); return; }
    setUserBusy(true); setUserMsg("");
    try {
      const savedUser = await saveAppUser({adminUsername:currentAdminUsername,adminPassword, ...userForm});
      if (savedUser.id === sessionStorage.getItem("dispatchops-user-id")) sessionStorage.setItem("dispatchops-username", savedUser.username);
      await loadUsers();
      resetUserForm();
      setUserMsg(`User ${savedUser.username} saved.`);
      try { setRecentUpdates((await getAudit<any>("")).slice(0,5)); } catch {}
    } catch (e:any) { setUserMsg(e.message || "Could not save user"); }
    finally { setUserBusy(false); }
  }

  async function removeUser(id:string) {
    if (!adminPassword) { setUserMsg("Enter the current admin password first."); return; }
    if (!confirm("Delete this login account?")) return;
    setUserBusy(true); setUserMsg("");
    try { await deleteAppUser(currentAdminUsername,adminPassword,id); await loadUsers(); setUserMsg("User deleted."); }
    catch(e:any){ setUserMsg(e.message || "Could not delete user"); }
    finally { setUserBusy(false); }
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
            API Key {cfg.api_key_set && <span style={{ color: "var(--green)" }}>(SAVED SECURELY)</span>}
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="password" placeholder={cfg.api_key_set && !editingApiKey ? "Saved API key ••••••••••••••••" : "Enter API key"}
                   value={apiKey} readOnly={cfg.api_key_set && !editingApiKey}
                   onChange={(e) => setApiKey(e.target.value)} style={{ width: "100%" }} />
            {cfg.api_key_set && (
              <button type="button" className="btn" onClick={() => { setEditingApiKey(true); setApiKey(""); }} style={{ whiteSpace: "nowrap" }}>Change Key</button>
            )}
          </div>
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
                         placeholder={f.api_key_set ? "••••••••••  (saved — leave blank)" : "key / endpoint"} style={{ width: "100%" }} />
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

      <div className="glass-card" style={{ marginBottom: 20 }}>
        <strong>Admin Accounts & Login Users</strong>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          Manage the username, password, role and active status of application logins.
          The current admin password is required for every account change. Passwords are stored as hashes in the database.
        </p>
        <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) auto", gap:8, alignItems:"end" }}>
          <label className="field"><span>Current admin password</span><input type="password" value={adminPassword} onChange={e=>setAdminPassword(e.target.value)} placeholder="Enter admin password to manage users" /></label>
          <button className="btn" type="button" disabled={userBusy} onClick={()=>void loadUsers()}>{userBusy?"Loading…":"Load users"}</button>
        </div>
        <div style={{marginTop:14,display:"grid",gap:8}}>
          {usersLoaded && users.map(u=><div key={u.id} style={{display:"grid",gridTemplateColumns:"minmax(130px,1fr) 120px 90px 90px auto",gap:8,alignItems:"center",padding:9,border:"1px solid var(--line)",borderRadius:10}}>
            <b>{u.username}</b><span className="muted small">{u.role}</span><span className="muted small">{u.active?"Active":"Disabled"}</span>
            <button className="btn" type="button" onClick={()=>setUserForm({id:u.id,username:u.username,password:"",role:u.role,active:u.active})}>Edit</button><button className="btn" type="button" onClick={async()=>{try{await unlockAppUser(currentAdminUsername,adminPassword,u.id,u.username);unlockLocalLogin(u.username);setUserMsg(`Login lock cleared for ${u.username}.`);}catch(e:any){setUserMsg(e.message||"Could not unlock user");}}}>Unlock</button>
            <button className="btn" type="button" style={{background:"var(--red)"}} onClick={()=>void removeUser(u.id)}>Delete</button>
          </div>)}
          <div style={{padding:12,border:"1px solid var(--line)",borderRadius:10}}>
            <strong>Change Admin Password</strong>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,marginTop:8,alignItems:"end"}}>
              <input type="password" placeholder="Current admin password" value={adminPassword} onChange={e=>setAdminPassword(e.target.value)}/>
              <input type="password" placeholder="New admin password" value={adminNewPassword} onChange={e=>setAdminNewPassword(e.target.value)}/>
              <button className="btn" type="button" disabled={userBusy} onClick={()=>void changeAdminPassword()}>Change Password</button>
            </div>
          </div>
          <div style={{padding:12,border:"1px solid var(--line)",borderRadius:10}}>
            <strong>{userForm.id?"Edit login":"Add login"}</strong>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:8,marginTop:8}}>
              <input placeholder="Username" value={userForm.username} onChange={e=>setUserForm(x=>({...x,username:e.target.value}))}/>
              <input type="password" placeholder={userForm.id?"New password (optional)":"Password"} value={userForm.password} onChange={e=>setUserForm(x=>({...x,password:e.target.value}))}/>
              <select value={userForm.role} onChange={e=>setUserForm(x=>({...x,role:e.target.value as AppRole}))}><option value="admin">Admin</option><option value="user">User</option><option value="dispatcher">Dispatcher</option></select>
              <label style={{display:"flex",alignItems:"center",gap:7}}><input type="checkbox" checked={userForm.active} onChange={e=>setUserForm(x=>({...x,active:e.target.checked}))}/> Active</label>
            </div>
            <div style={{display:"flex",gap:8,marginTop:8}}><button className="btn" type="button" disabled={userBusy} onClick={()=>void saveUser()}>{userForm.id?"Save user":"Add user"}</button>{userForm.id&&<button className="btn" type="button" onClick={resetUserForm}>Cancel</button>}</div>
          </div>
        </div>
        {userMsg && <div style={{marginTop:8,color:userMsg.toLowerCase().includes("saved")||userMsg.toLowerCase().includes("deleted")?"var(--green)":"var(--amber)",fontSize:13}}>{userMsg}</div>}
      </div>

      <div className="glass-card" style={{ marginBottom: 20 }}>
        <strong>Database Health</strong>
        <p style={{fontSize:13,color:"var(--muted)",marginTop:6}}>Connection status is shown here instead of a banner on every page.</p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:8}}>
          {dbHealth.map(x=><div key={x.name} style={{padding:10,border:"1px solid var(--line)",borderRadius:10}}><b>{x.name}</b><div style={{fontSize:12,color:x.ok?"var(--green)":"var(--red)",marginTop:4}}>{x.ok?`Connected · ${x.ms} ms`:"Connection problem"}</div></div>)}
        </div>
      </div>

      <div className="glass-card" style={{ marginBottom: 20 }}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}><strong>Recent Updates</strong><span className="muted small">Last 5 changes</span></div>
        <div style={{marginTop:10}}>
          {recentUpdates.length===0 ? <div className="muted small">No recent updates recorded yet.</div> : recentUpdates.map((e:any)=><div key={String(e.id)} style={{padding:"9px 0",borderBottom:"1px solid var(--line)"}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:10}}><b>{e.actor||"unknown"}</b><span className="muted small">{e.timestamp?new Date(e.timestamp).toLocaleString():""}</span></div>
            <div style={{fontSize:12,marginTop:3}}>{e.action||"update"} · {e.entity_type||"record"} · {e.entity_key||""}</div>
            <div className="muted small" style={{marginTop:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{formatAuditChange(e)}</div>
          </div>)}
        </div>
      </div>

      <PageVisibilitySettings />
      <AppearanceSettings />
    </div>
  );
}

function PageVisibilitySettings() {
  const { isVisible, setVisible } = usePageVisibility();
  const [busyPath, setBusyPath] = useState("");
  const [msg, setMsg] = useState("");

  async function toggle(path: string, visible: boolean) {
    setBusyPath(path);
    setMsg("");
    try {
      await setVisible(path, visible);
      setMsg(`${MANAGEABLE_PAGES.find((p) => p.path === path)?.label || path} is now ${visible ? "visible" : "hidden"}.`);
    } catch (e: any) {
      setMsg(e.message || "Could not update page visibility.");
    } finally {
      setBusyPath("");
    }
  }

  return (
    <div className="glass-card" style={{ marginBottom: 20 }}>
      <strong>Page Visibility</strong>
      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
        Admin-only controls. Hide any operational page from normal users without changing that page's data or functionality.
      </p>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {MANAGEABLE_PAGES.map((page) => {
          const visible = isVisible(page.path);
          return (
            <div key={page.path} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "9px 11px", border: "1px solid var(--line)", borderRadius: 10 }}>
              <div><b>{page.label}</b><div className="muted small">{page.path}</div></div>
              <button type="button" className="btn" disabled={busyPath === page.path} onClick={() => void toggle(page.path, !visible)} style={{ minWidth: 96 }}>
                {busyPath === page.path ? "Saving…" : visible ? "Hide" : "Show"}
              </button>
            </div>
          );
        })}
      </div>
      {msg && <div style={{ fontSize: 12, color: "var(--teal)", marginTop: 10 }}>{msg}</div>}
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
    try {
      await setWallpaper(mode, file, "dispatchops");
      setMsg(`${mode === "light" ? "Light" : "Dark"} mode background updated.`);
      refreshBackground();
      if (fileInput) fileInput.value = "";
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  async function reset(mode: "light" | "dark") {
    try {
      await resetWallpaper(mode);
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
