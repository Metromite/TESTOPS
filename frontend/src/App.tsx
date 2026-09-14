import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HeroUIProvider } from "@heroui/react";
import { ThemeProvider } from "./theme/ThemeProvider";
import ProtectedLayout from "./components/ProtectedLayout";
import RoutePlanningToolbar from "./components/RoutePlanningToolbar";
import SetupGate from "./components/SetupGate";
import Setup from "./pages/Setup";
import Login from "./pages/Login";

/**
 * ITEM PASS (loading performance, section 1): every routed page used to be
 * a top-level static `import`, which means the production bundle bundles
 * every page's code - including every dashboard chart, every heavy table,
 * every page's own dependencies - into the JS that has to be downloaded
 * and parsed before ANYTHING can render, even if the user only ever opens
 * Dashboard. That's a real, measurable contributor to "the app takes 1-2
 * minutes to open": none of that is a backend/database problem, it's
 * shipping the whole app's worth of JS up front regardless of which one
 * page is actually being viewed.
 *
 * Fix: every page except the two that must be available before anything
 * else can be trusted (Setup, Login - both tiny, no heavy chart/table
 * deps) is now `React.lazy()`-loaded, so its code only downloads the
 * first time that specific route is actually visited. The app shell
 * (HeroUIProvider/ThemeProvider/BrowserRouter/nav) and whichever single
 * page is being opened are the only things blocking first paint now -
 * exactly the "shell appears immediately, pages load progressively"
 * target from the spec. Every route path, every prop, and every page
 * component's own internals are completely unchanged - this only changes
 * *when* each page's JS is fetched, not what it does once loaded.
 *
 * The <Suspense fallback> renders instantly (no data fetch, no async
 * work) so navigating to a not-yet-loaded page shows this immediately
 * while that page's small JS chunk downloads, rather than a blank screen.
 */
const Dashboard = lazy(() => import("./pages/Dashboard"));
const RoutePlanner = lazy(() => import("./pages/RoutePlanner"));
const RoutePlanSheet = lazy(() => import("./pages/RoutePlanSheet"));
const DriverRoutePlan = lazy(() => import("./pages/DriverRoutePlan"));
const HelperRoutePlan = lazy(() => import("./pages/HelperRoutePlan"));
const Replacements = lazy(() => import("./pages/Replacements"));
const Fleet = lazy(() => import("./pages/Fleet"));
const Experience = lazy(() => import("./pages/Experience"));
const Vacations = lazy(() => import("./pages/Vacations"));
const CustomerIntelligence = lazy(() => import("./pages/CustomerIntelligence"));
const RouteIntelligence = lazy(() => import("./pages/RouteIntelligence"));
const AiSettings = lazy(() => import("./pages/AiSettings"));
const Backup = lazy(() => import("./pages/Backup"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const Imports = lazy(() => import("./pages/Imports"));
const ControlCenter = lazy(() => import("./pages/ControlCenter"));
const DriverMappingReviewPage = lazy(() => import("./pages/DriverMappingReviewPage"));
const DiagnosticsPage = lazy(() => import("./pages/DiagnosticsPage"));
const DashboardConfigurationPage = lazy(() => import("./pages/DashboardConfigurationPage"));

/** Instant, zero-dependency shell fallback - no spinner-as-a-fix, just
 * something that paints immediately so the route change doesn't look
 * broken while that page's chunk downloads (usually near-instant on a
 * warm cache/fast connection, but still real network+parse time on the
 * very first visit to a given page). */
function PageLoadingFallback() {
  return <div className="page" aria-busy="true" style={{ minHeight: "40vh" }} />;
}

export default function App() {
  return (
    <HeroUIProvider>
      <ThemeProvider>
        <BrowserRouter>
          <SetupGate>
            <Suspense fallback={<PageLoadingFallback />}>
              <Routes>
                <Route path="/setup" element={<Setup />} />
                <Route path="/login" element={<Login />} />
                <Route element={<ProtectedLayout />}>
                  <Route path="/" element={<Dashboard />} />
                  {/* NAV REDESIGN: these three now live under a persistent
                      Route Planning toolbar (see RoutePlanningToolbar.tsx)
                      instead of a Dashboard dropdown - same routes/pages,
                      just a different parent layout. */}
                  <Route element={<RoutePlanningToolbar />}>
                    <Route path="/route-planner" element={<RoutePlanner />} />
                    <Route path="/route-plan-driver" element={<DriverRoutePlan />} />
                    <Route path="/route-plan-helper" element={<HelperRoutePlan />} />
                    <Route path="/route-plan-sheet" element={<RoutePlanSheet />} />
                    <Route path="/replacements" element={<Replacements />} />
                  </Route>
                  <Route path="/fleet" element={<Fleet />} />
                  <Route path="/experience" element={<Experience />} />
                  <Route path="/vacations" element={<Vacations />} />
                  <Route path="/customer-intelligence" element={<CustomerIntelligence />} />
                  <Route path="/route-intelligence" element={<RouteIntelligence />} />
                  <Route path="/ai-settings" element={<AiSettings />} />
                  <Route path="/backup" element={<Backup />} />
                  <Route path="/audit-log" element={<AuditLog />} />
                  <Route path="/imports" element={<Imports />} />
                  <Route path="/control-center" element={<ControlCenter />} />
                  {/* NAV REDESIGN: relocated from Dashboard's internal tabs
                      (Dashboard now only has Overview/Analytics) into the
                      Admin nav group. */}
                  <Route path="/driver-mapping-review" element={<DriverMappingReviewPage />} />
                  <Route path="/diagnostics" element={<DiagnosticsPage />} />
                  <Route path="/dashboard-configuration" element={<DashboardConfigurationPage />} />
                </Route>
              </Routes>
            </Suspense>
          </SetupGate>
        </BrowserRouter>
      </ThemeProvider>
    </HeroUIProvider>
  );
}
