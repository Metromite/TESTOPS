import { useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";

import {
  LayoutDashboard,
  Database,
  Users2,
  Route,
  MonitorPlay,
  Settings,
  LogOut,
  Sun,
  Moon,
  Milestone,
  BriefcaseBusiness,
  Tags,
  MapPinned,
  Boxes,
} from "lucide-react";

import { useTheme } from "../theme/ThemeProvider";

import {
  getRole,
  logout,
  isAuthEnabled,
} from "../api/client";

import {
  GlassSidebarShell,
  GlassNavItem,
  GlassNavGroup,
} from "../design-system/GlassSidebar";

import { GlassButton } from "../design-system/GlassButton";
import { featureFlagsService } from "../services/system";


export default function TopNav() {
  const { mode, resolvedTheme, setMode } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const role = getRole();
  const [hiddenPages, setHiddenPages] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    featureFlagsService.list().then((flags) => {
      if (!alive) return;
      setHiddenPages(flags.filter((f) => f.name.startsWith("page_visible:") && !f.enabled).map((f) => f.name.slice("page_visible:".length)));
    }).catch(() => { /* navigation remains fail-open */ });
    return () => { alive = false; };
  }, [location.pathname]);

  const pageHidden = (path: string) => role !== "admin" && hiddenPages.includes(path);

  return (
    <GlassSidebarShell>
      <img
        src="/app-icon.png"
        alt="Dispatch OPS"
        width={28}
        height={28}
        className="mr-1.5 rounded-[7px]"
      />

      <span className="mr-6 text-[15px] font-black tracking-tight text-[var(--text)]">
        DISPATCH OPS
      </span>

      <GlassNavItem
        layoutId="nav-pill"
        to="/"
        end
        label="Dashboard"
        icon={
          <LayoutDashboard className="h-4 w-4" />
        }
      />

      <GlassNavItem
        layoutId="nav-pill"
        to="/bulk-organizer"
        label="Bulk Organizer"
        icon={
          <Boxes className="h-4 w-4" />
        }
      />

      <GlassNavItem
        layoutId="nav-pill"
        to="/route-planner"
        label="Route Planning"
        icon={
          <Milestone className="h-4 w-4" />
        }
      />

      <GlassNavGroup
        layoutId="nav-pill"
        label="Services"
        icon={
          <BriefcaseBusiness className="h-4 w-4" />
        }
        items={[
          {
            to: "/price-change",
            label: "Price Change Portal",
            icon: <Tags className="h-4 w-4" />,
          },
        ]}
      />

      <GlassNavGroup
        layoutId="nav-pill"
        label="Fleet Data"
        icon={
          <Database className="h-4 w-4" />
        }
        items={[
          {
            to: "/fleet",
            label: "Fleet Database",
          },
          {
            to: "/vacations",
            label: "Vacations",
          },
          {
            to: "/experience",
            label: "Experience",
          },
        ]}
      />

      <GlassNavGroup
        layoutId="nav-pill"
        label="Customer Intelligence"
        icon={
          <Users2 className="h-4 w-4" />
        }
        items={[
          {
            to: "/customer-intelligence",
            label: "Customer Area Intelligence",
          },
          {
            to: "/location-knowledge",
            label: "Customer Knowledge",
            icon: (
              <MapPinned className="h-4 w-4" />
            ),
          },
        ]}
      />

      {!pageHidden("/route-intelligence") && <GlassNavItem
        layoutId="nav-pill"
        to="/route-intelligence"
        label="Route Intel"
        icon={
          <Route className="h-4 w-4" />
        }
      />}

      {!pageHidden("/control-center") && <GlassNavItem
        layoutId="nav-pill"
        to="/control-center"
        label="Control Center"
        icon={
          <MonitorPlay className="h-4 w-4" />
        }
      />}

      {role === "admin" && (
        <GlassNavGroup
          layoutId="nav-pill"
          label="Admin"
          icon={
            <Settings className="h-4 w-4" />
          }
          items={[
            {
              to: "/ai-settings",
              label: "AI & Account Settings",
            },
            {
              to: "/data-sync",
              label: "Cloud Connection",
            },
            {
              to: "/backup",
              label: "Backup & Restore",
            },
            {
              to: "/imports",
              label: "SAP / Landmark Imports",
            },
            {
              to: "/audit-log",
              label: "Audit Log",
            },
            {
              to: "/driver-mapping-review",
              label: "Driver Mapping Review",
            },
            {
              to: "/diagnostics",
              label: "Diagnostics",
            },
            {
              to: "/dashboard-configuration",
              label: "Page Visibility & Dashboard Configuration",
            },
          ]}
        />
      )}

      <div className="flex-1" />

      <div className="top-nav-actions ml-auto flex shrink-0 items-center gap-2">
        <div className="theme-switch" role="group" aria-label="Theme">
          <button
            type="button"
            className={`theme-switch-track ${((mode === "dark") || (mode === "auto" && resolvedTheme === "dark")) ? "is-dark" : "is-light"}`}
            onClick={() => setMode((mode === "dark" || (mode === "auto" && resolvedTheme === "dark")) ? "light" : "dark")}
            aria-label={((mode === "dark") || (mode === "auto" && resolvedTheme === "dark")) ? "Switch to light mode" : "Switch to dark mode"}
            title={((mode === "dark") || (mode === "auto" && resolvedTheme === "dark")) ? "Light mode" : "Dark mode"}
          >
            <span className="theme-switch-option theme-switch-light" aria-hidden="true"><Sun className="h-3.5 w-3.5" /></span>
            <span className="theme-switch-option theme-switch-dark" aria-hidden="true"><Moon className="h-3.5 w-3.5" /></span>
            <span className="theme-switch-thumb" aria-hidden="true" />
          </button>
        </div>

        {isAuthEnabled() && (
          <GlassButton
            variant="secondary"
            size="sm"
            className="top-nav-signout"
            onClick={() => {
              logout();
              navigate("/login", {
                replace: true,
              });
            }}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </GlassButton>
        )}
      </div>
    </GlassSidebarShell>
  );
}
