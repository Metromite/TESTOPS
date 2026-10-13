import { ReactNode, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { claimDropdown, releaseDropdown } from "../components/dropdownCoordinator";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * GlassSidebar - the app's primary-navigation design-system unit. The V1
 * decision to use a top command bar instead of a left sidebar is a
 * navigation/workflow choice, not a visual one, and this redesign is
 * scoped to visuals only - so it stays a horizontal bar. The pieces below
 * (Shell, Item, Group) are what TopNav.tsx is built from.
 */

export function GlassSidebarShell({ children }: { children: ReactNode }) {
  return (
    // ITEM PASS 6 (Part 5/6, glass surface hierarchy): nav is now
    // `.glass-level-2` instead of the same Level 1 alpha/blur every card
    // uses - persistent chrome that sits above scrolling page content
    // needs to be more frosted than a card sitting inline in the page,
    // per the spec's explicit multi-level glass request.
    <nav className="glass-level-2 top-nav sticky top-0 z-50 flex items-center gap-1 border-b border-[var(--glass-border)] px-5 py-2.5 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
      {children}
    </nav>
  );
}

interface NavItemDef {
  to: string;
  label: string;
  end?: boolean;
  icon?: ReactNode;
}

/** Single nav link with a shared, sliding "liquid" active-pill (Framer
 *  Motion layoutId) - the one signature motion detail of the nav bar. */
export function GlassNavItem({ to, label, end, icon, layoutId }: NavItemDef & { layoutId: string }) {
  const location = useLocation();
  const routePlanningChildren = ["/route-planner", "/route-plan-driver", "/route-plan-helper", "/route-plan-sheet", "/replacements"];
  const isRoutePlanningItem = to === "/route-planner";
  const activeForRoute = isRoutePlanningItem ? routePlanningChildren.includes(location.pathname) : (end ? location.pathname === to : location.pathname.startsWith(to));
  return (
    <NavLink
      to={to}
      end={end}
      data-route-planning-active={isRoutePlanningItem && activeForRoute ? "true" : undefined}
      className={() => {
        const active = activeForRoute;
        return cn(
          "relative flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[13.5px] font-semibold transition-colors duration-150",
          active ? `text-white ${isRoutePlanningItem ? "route-planning-top-level" : ""}` : "text-muted hover:text-ink hover:bg-[var(--row-hover)]"
        );
      }}
    >
      {() => {
        const active = activeForRoute;
        return (
        <>
          {active && (
            <motion.span
              layoutId={layoutId}
              aria-hidden="true"
              className="absolute inset-0 -z-10 rounded-md bg-[var(--blue)]"
              transition={{ type: "spring", stiffness: 520, damping: 30 }}
            />
          )}
          {icon}
          {label}
        </>
        );
      }}
    </NavLink>
  );
}

/** Dropdown / mega-menu group trigger, e.g. "Dashboard" -> [Overview, Route Planner, ...] */
export function GlassNavGroup({
  label,
  icon,
  items,
  layoutId,
  onOpen,
}: {
  label: string;
  icon?: ReactNode;
  items: NavItemDef[];
  layoutId: string;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const isActiveGroup = items.some((i) => (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to)));
  const groupId = layoutId + label;

  useEffect(() => {
    if (!open) {
      releaseDropdown(groupId);
      return;
    }

    claimDropdown(groupId, () => setOpen(false));

    function onPointerDownOutside(e: PointerEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDownOutside, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownOutside, true);
      document.removeEventListener("keydown", onKeyDown);
      releaseDropdown(groupId);
    };
  }, [open, groupId]);

  useEffect(() => {
    if (!open) return;
    function updatePos() {
      const rect = ref.current?.getBoundingClientRect();
      if (rect) setMenuPos({ left: rect.left, top: rect.bottom + 6 });
    }
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [open]);

  function toggleOpen() {
    setOpen((current) => {
      const next = !current;
      if (next) onOpen?.();
      return next;
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          toggleOpen();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleOpen();
          }
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        data-active={isActiveGroup ? "true" : "false"}
        className={cn(
          "relative flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[13.5px] font-semibold transition-colors duration-150",
          isActiveGroup ? "text-white" : "text-white/90 hover:text-white hover:bg-[var(--row-hover)]"
        )}
      >
        {isActiveGroup && (
          <motion.span
            layoutId={layoutId}
            className="absolute inset-0 -z-10 rounded-md bg-[var(--blue)]"
            transition={{ type: "spring", stiffness: 520, damping: 30 }}
          />
        )}
        {icon}
        {label}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-150", open && "rotate-180")} />
      </button>
      {/*
        BUGFIX (dropdown hidden behind glass cards): this menu used to be
        an absolutely-positioned child of the nav item, trapped inside the
        nav bar's own stacking context - page content with its own
        backdrop-filter/z-index (both create new stacking contexts) could
        paint over it depending on DOM order. Portaling it to
        document.body, positioned from the trigger's live bounding rect,
        guarantees it always paints above all page content.
      */}
      {menuPos && open && createPortal(
            <div
              style={{ position: "fixed", left: menuPos.left, top: menuPos.top, zIndex: 9999 }}
              // ITEM PASS 6: same fix as MultiSelectSlicer's dropdown -
              // shared Level 3 tokens instead of an ad hoc navy2/95 value.
              ref={menuRef}
              className="liquid-glass-dropdown min-w-[220px] rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg-3)] p-1.5 shadow-elevation2 backdrop-blur-[var(--glass-blur-3)] backdrop-saturate-[200%]"
            >
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-[13.5px] font-medium transition-colors",
                      isActive ? "bg-[var(--blue)] text-white" : "text-muted hover:bg-[var(--row-hover)] hover:text-ink"
                    )
                  }
                >
                  {item.icon}
                  {item.label}
                </NavLink>
              ))}
            </div>,
        document.body
      )}
    </div>
  );
}
