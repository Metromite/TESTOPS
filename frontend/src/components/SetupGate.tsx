import { ReactNode } from "react";

/**
 * The application shell is never blocked by connection checks. Database
 * health is available from the Admin/Cloud Connection settings page instead
 * of showing a banner on every screen.
 */
export default function SetupGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
