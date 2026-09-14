import { ReactNode } from "react";

/**
 * TEMPORARY: auth/setup gating is disabled app-wide while the rest of the
 * app is being finished, matching backend core/config.py's AUTH_DISABLED
 * flag. To re-enable later: restore the real setup-check logic here (see
 * git history / the version before this comment) and flip AUTH_DISABLED
 * back to False on the backend.
 */
export default function SetupGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
