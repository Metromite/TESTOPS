import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { featureFlagsService } from "./system";
import { getRole } from "../api/client";

export type PageVisibilityItem = { path: string; label: string; description?: string };

export const MANAGEABLE_PAGES: PageVisibilityItem[] = [
  { path: "/bulk-organizer", label: "Bulk Organizer" },
  { path: "/route-planner", label: "Route Planner" },
  { path: "/route-plan-driver", label: "Driver Route Plan" },
  { path: "/route-plan-helper", label: "Helper Route Plan" },
  { path: "/route-plan-sheet", label: "Route Plan Sheet" },
  { path: "/replacements", label: "Replacement Forecast" },
  { path: "/fleet", label: "Fleet Database" },
  { path: "/vacations", label: "Vacations" },
  { path: "/experience", label: "Experience" },
  { path: "/customer-intelligence", label: "Customer Area Intelligence" },
  { path: "/location-knowledge", label: "Customer Knowledge" },
  { path: "/route-intelligence", label: "Route Intelligence" },
  { path: "/control-center", label: "Control Center" },
  { path: "/price-change", label: "Price Change Portal" },
];

const FLAG_PREFIX = "page_visible:";
const DEFAULT_HIDDEN = new Set(["/route-intelligence", "/control-center"]);

type PageVisibilityContextValue = {
  loading: boolean;
  isVisible: (path: string) => boolean;
  refresh: () => Promise<void>;
  setVisible: (path: string, visible: boolean) => Promise<void>;
};

const PageVisibilityContext = createContext<PageVisibilityContextValue | null>(null);

export function PageVisibilityProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const rows = await featureFlagsService.list();
      const next: Record<string, boolean> = {};
      for (const row of rows) {
        if (row.name.startsWith(FLAG_PREFIX)) next[row.name.slice(FLAG_PREFIX.length)] = Boolean(row.enabled);
      }
      setFlags(next);
    } catch {
      // Fail open for existing application pages. Only the two explicitly
      // retired pages keep their safe default hidden state until configured.
      setFlags({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const value = useMemo<PageVisibilityContextValue>(() => ({
    loading,
    isVisible: (path) => Object.prototype.hasOwnProperty.call(flags, path) ? flags[path] : !DEFAULT_HIDDEN.has(path),
    refresh,
    setVisible: async (path, visible) => {
      const username = sessionStorage.getItem("dispatchops-username") || "admin";
      await featureFlagsService.set(`${FLAG_PREFIX}${path}`, visible, username, `Navigation visibility for ${path}`);
      setFlags((prev) => ({ ...prev, [path]: visible }));
    },
  }), [flags, loading]);

  return <PageVisibilityContext.Provider value={value}>{children}</PageVisibilityContext.Provider>;
}

export function usePageVisibility() {
  const value = useContext(PageVisibilityContext);
  if (!value) throw new Error("usePageVisibility must be used inside PageVisibilityProvider");
  return value;
}

export function PageVisibilityGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { loading, isVisible } = usePageVisibility();
  const role = getRole();

  useEffect(() => {
    if (!loading && role !== "admin" && MANAGEABLE_PAGES.some((p) => p.path === location.pathname) && !isVisible(location.pathname)) {
      navigate("/", { replace: true });
    }
  }, [loading, role, location.pathname, isVisible, navigate]);

  if (!loading && role !== "admin" && MANAGEABLE_PAGES.some((p) => p.path === location.pathname) && !isVisible(location.pathname)) return null;
  return <>{children}</>;
}
