import { NavLink, Outlet } from "react-router-dom";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/route-planner", label: "Route Planner" },
  { to: "/route-plan-driver", label: "Driver Route Plan" },
  { to: "/route-plan-helper", label: "Helper Route Plan" },
  { to: "/route-plan-sheet", label: "Route Plan Sheet" },
  { to: "/replacements", label: "Replacement Forecast" },
];

/**
 * NAV REDESIGN: Route Planning is its own top-level nav item (see
 * TopNav.tsx). This toolbar sits above all five of its pages (nested
 * under it in App.tsx, same pattern ProtectedLayout uses for the whole
 * app) so they're always one click apart with no dropdown - real routes
 * (not client-side tab state), so the URL, browser back button, and deep
 * links all still work normally.
 *
 * "Route Planner" and "Candidate Review" are intentionally ONE entry
 * here, not two: in the current implementation they're the exact same
 * screen (CandidateReviewPanel shows the date-picker/Generate button AND
 * the just-generated candidate results together, see RoutePlanner.tsx) -
 * splitting them into separate destinations would mean designing a new
 * screen split, not fixing/extending the existing one.
 */
export default function RoutePlanningToolbar() {
  return (
    <div style={{ maxWidth: 1440, margin: "0 auto", padding: "24px 24px 0" }}>
      <div className="mb-5 flex flex-wrap gap-1.5 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2 backdrop-blur-glass">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              cn(
                "relative rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors duration-150",
                isActive ? "text-white" : "text-muted hover:text-ink hover:bg-[var(--row-hover)]"
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId="route-planning-tab-pill"
                    className="absolute inset-0 -z-10 rounded-lg bg-[var(--blue)]"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                )}
                {t.label}
              </>
            )}
          </NavLink>
        ))}
      </div>
      {/*
        Each of the 3 child pages (RoutePlanner/RoutePlanSheet/Replacements)
        already wraps its own content in a `.page` div (max-width, its own
        24px padding). This wrapper only handles the toolbar's own
        max-width/centering with padding on the sides+top (not bottom), so
        the toolbar lines up with child page content below it without
        doubling anyone's padding.
      */}
      <Outlet />
    </div>
  );
}
