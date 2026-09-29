import { useNavigate } from "react-router-dom";

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
import { usePageVisibility } from "../services/pageVisibility";


export default function TopNav() {
  const { mode, resolvedTheme, setMode } = useTheme();
  const navigate = useNavigate();
  const role = getRole();
  const { isVisible } = usePageVisibility();

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

      {isVisible("/bulk-organizer") && <GlassNavItem
        layoutId="nav-pill"
        to="/bulk-organizer"
        label="Bulk Organizer"
        icon={
          <Boxes className="h-4 w-4" />
        }
      />}

      {isVisible("/route-planner") && <GlassNavItem
        layoutId="nav-pill"
        to="/route-planner"
        label="Route Planning"
        icon={
          <Milestone className="h-4 w-4" />
        }
      />}

      {isVisible("/price-change") && <GlassNavGroup
        layoutId="nav-pill"
        label="Services"
        icon={
          <BriefcaseBusiness className="h-4 w-4" />
        }
        items={[
          ...(isVisible("/price-change") ? [{
            to: "/price-change",
            label: "Price Change Portal",
            icon: <Tags className="h-4 w-4" />,
          }] : []),
        ]}
      />}

      {(isVisible("/fleet") || isVisible("/vacations") || isVisible("/experience")) && <GlassNavGroup
        layoutId="nav-pill"
        label="Fleet Data"
        icon={
          <Database className="h-4 w-4" />
        }
        items={[
          ...(isVisible("/fleet") ? [{ to: "/fleet", label: "Fleet Database" }] : []),
          ...(isVisible("/vacations") ? [{ to: "/vacations", label: "Vacations" }] : []),
          ...(isVisible("/experience") ? [{ to: "/experience", label: "Experience" }] : []),
        ]}
      />}

      {(isVisible("/customer-intelligence") || isVisible("/location-knowledge")) && <GlassNavGroup
        layoutId="nav-pill"
        label="Customer Intelligence"
        icon={
          <Users2 className="h-4 w-4" />
        }
        items={[
          ...(isVisible("/customer-intelligence") ? [{ to: "/customer-intelligence", label: "Customer Area Intelligence" }] : []),
          ...(isVisible("/location-knowledge") ? [{
            to: "/location-knowledge", label: "Customer Knowledge", icon: <MapPinned className="h-4 w-4" />,
          }] : []),
        ]}
      />}

      {isVisible("/route-intelligence") && <GlassNavItem
        layoutId="nav-pill"
        to="/route-intelligence"
        label="Route Intel"
        icon={
          <Route className="h-4 w-4" />
        }
      />}

      {isVisible("/control-center") && <GlassNavItem
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
              label: "Dashboard Configuration",
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
