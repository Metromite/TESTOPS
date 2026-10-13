const AUTH_KEY = "dispatchops-auth";

export function isAuthenticated(): boolean {
  return sessionStorage.getItem(AUTH_KEY) === "true";
}

export function getRole(): string | null {
  return isAuthenticated() ? (sessionStorage.getItem("dispatchops-role") || "user") : null;
}

export function logout(): void {
  sessionStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem("dispatchops-role");
  sessionStorage.removeItem("dispatchops-username");
  sessionStorage.removeItem("dispatchops-user-id");
}

export function isAuthEnabled(): boolean {
  return true;
}
