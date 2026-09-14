const BASE = "/api";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle(res: Response) {
  if (res.status === 401) {
    localStorage.removeItem("access_token");
    localStorage.removeItem("role");
    window.location.href = "/login";
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail || "Request failed");
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  get: (path: string) => fetch(`${BASE}${path}`, { headers: { ...authHeaders() } }).then(handle),
  post: (path: string, body?: unknown) =>
    fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: body ? JSON.stringify(body) : undefined,
    }).then(handle),
  put: (path: string, body: unknown) =>
    fetch(`${BASE}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then(handle),
  del: (path: string) => fetch(`${BASE}${path}`, { method: "DELETE", headers: { ...authHeaders() } }).then(handle),
};

export async function checkSetupStatus(): Promise<boolean> {
  const res = await fetch(`${BASE}/setup/status`);
  const data = await res.json();
  return data.needs_setup;
}

export async function login(username: string, password: string) {
  const form = new URLSearchParams();
  form.set("username", username);
  form.set("password", password);
  const res = await fetch(`${BASE}/auth/login`, { method: "POST", body: form });

  // Deliberately NOT using handle() here: handle() treats any 401 as an
  // expired session and force-redirects to /login, clearing storage. That
  // makes sense for an already-logged-in user whose token stopped working,
  // but a failed login attempt isn't a session that ever existed - it
  // should just show "incorrect username or password", not reload the
  // page the person is already sitting on.
  const data = await res.json().catch(() => ({ detail: "Unexpected server response" }));
  if (!res.ok) {
    throw new Error(data.detail || "Login failed");
  }
  localStorage.setItem("access_token", data.access_token);
  localStorage.setItem("role", data.role);
  return data;
}

export function logout() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("role");
  // ITEM PASS 4 (item 2 local cache safety): the Dashboard localStorage
  // cache (hooks/dashboardCache.ts) key-scopes only by endpoint+params,
  // not by user - harmless while AUTH_DISABLED means everyone is
  // effectively "admin" seeing the same data, but on a shared machine
  // after auth is re-enabled, a different user logging in right after
  // this one should not briefly see the previous user's last-cached
  // dashboard numbers before the background refetch corrects it. Clear
  // on logout so a fresh login always starts from a clean cache.
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("dc_dashcache_v1:")) keysToRemove.push(k);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // localStorage unavailable - nothing to clear, nothing to fail on.
  }
}

// TEMPORARY: auth is disabled app-wide (see backend core/config.py's
// AUTH_DISABLED). Defaulting to "admin" here keeps every role-gated UI
// element (Imports, AI Settings, write buttons) visible/usable during
// this phase. To re-enable auth: remove the `|| "admin"` fallback below.
export function getRole(): string | null {
  return localStorage.getItem("role") || "admin";
}

export function isLoggedIn(): boolean {
  return true; // TEMPORARY - see getRole() comment above
}

/** Subscribes to a Server-Sent Events job stream - used for background job
 * progress (SAP/Landmark import, correlation, route intelligence, analytics
 * rebuild) so the UI never freezes and never needs a manual refresh. */
export function subscribeJobEvents(jobId: string, onMessage: (data: any) => void): () => void {
  const token = localStorage.getItem("access_token") || "";
  const es = new EventSource(`${BASE}/jobs/${jobId}/stream?token=${encodeURIComponent(token)}`);
  es.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  return () => es.close();
}
