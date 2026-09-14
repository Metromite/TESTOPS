import { ReactNode, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
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
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[13.5px] font-semibold transition-colors duration-150",
          isActive ? "text-white" : "text-muted hover:text-ink hover:bg-[var(--row-hover)]"
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId={layoutId}
              className="absolute inset-0 -z-10 rounded-md bg-[var(--blue)]"
              transition={{ type: "spring", stiffness: 500, damping: 38 }}
            />
          )}
          {icon}
          {label}
        </>
      )}
    </NavLink>
  );
}

/** Dropdown / mega-menu group trigger, e.g. "Dashboard" -> [Overview, Route Planner, ...] */
export function GlassNavGroup({
  label,
  icon,
  items,
  layoutId,
}: {
  label: string;
  icon?: ReactNode;
  items: NavItemDef[];
  layoutId: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const isActiveGroup = items.some((i) => (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to)));
  const groupId = layoutId + label;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    // BUGFIX (only one dropdown open at a time, robustly): close this
    // dropdown whenever ANY other nav dropdown reports it just opened,
    // not just on outside clicks - so two menus can never both show.
    function onOtherGroupOpened(e: Event) {
      if ((e as CustomEvent).detail !== groupId) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("nav-dropdown-open", onOtherGroupOpened);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("nav-dropdown-open", onOtherGroupOpened);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [groupId]);

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
    setOpen((o) => {
      const next = !o;
      if (next) document.dispatchEvent(new CustomEvent("nav-dropdown-open", { detail: groupId }));
      return next;
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggleOpen}
        className={cn(
          "relative flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[13.5px] font-semibold transition-colors duration-150",
          isActiveGroup ? "text-white" : "text-muted hover:text-ink hover:bg-[var(--row-hover)]"
        )}
      >
        {isActiveGroup && (
          <motion.span
            layoutId={layoutId}
            className="absolute inset-0 -z-10 rounded-md bg-[var(--blue)]"
            transition={{ type: "spring", stiffness: 500, damping: 38 }}
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
      {menuPos && createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              style={{ position: "fixed", left: menuPos.left, top: menuPos.top, zIndex: 9999 }}
              // ITEM PASS 6: same fix as MultiSelectSlicer's dropdown -
              // shared Level 3 tokens instead of an ad hoc navy2/95 value.
              className="min-w-[220px] rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg-3)] p-1.5 shadow-elevation2 backdrop-blur-[var(--glass-blur-3)] backdrop-saturate-[200%]"
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
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
