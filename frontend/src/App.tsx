import {
  Suspense,
  lazy,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  BrowserRouter,
  Routes,
  Route,
} from "react-router-dom";

import { HeroUIProvider } from "@heroui/react";

import { ThemeProvider } from "./theme/ThemeProvider";
import ProtectedLayout from "./components/ProtectedLayout";
import RoutePlanningToolbar from "./components/RoutePlanningToolbar";
import SetupGate from "./components/SetupGate";

import Login from "./Login";

import { syncPrimaryConfigurationToSecondary } from "./lib/supabase";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const RoutePlanner = lazy(() => import("./pages/RoutePlanner"));
const RoutePlanSheet = lazy(() => import("./pages/RoutePlanSheet"));
const DriverRoutePlan = lazy(() => import("./pages/DriverRoutePlan"));
const HelperRoutePlan = lazy(() => import("./pages/HelperRoutePlan"));
const Replacements = lazy(() => import("./pages/Replacements"));
const Fleet = lazy(() => import("./pages/Fleet"));
const Experience = lazy(() => import("./pages/Experience"));
const Vacations = lazy(() => import("./pages/Vacations"));
const CustomerIntelligence = lazy(
  () => import("./pages/CustomerIntelligence")
);
const RouteIntelligence = lazy(
  () => import("./pages/RouteIntelligence")
);
const AiSettings = lazy(() => import("./pages/AiSettings"));
const DataSync = lazy(() => import("./pages/DataSync"));
const Backup = lazy(() => import("./pages/Backup"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const Imports = lazy(() => import("./pages/Imports"));
const LocationKnowledge = lazy(
  () => import("./pages/LocationKnowledge")
);
const ControlCenter = lazy(
  () => import("./pages/ControlCenter")
);
const DriverMappingReviewPage = lazy(
  () => import("./pages/DriverMappingReviewPage")
);
const DiagnosticsPage = lazy(
  () => import("./pages/DiagnosticsPage")
);
const DashboardConfigurationPage = lazy(
  () => import("./pages/DashboardConfigurationPage")
);
const PriceChangeManager = lazy(
  () => import("./pages/PriceChangeManager")
);

function PageLoadingFallback() {
  return (
    <div
      className="page"
      aria-busy="true"
      style={{ minHeight: "40vh" }}
    />
  );
}

function AuthGate({
  children,
}: {
  children: ReactNode;
}) {
  const [authenticated, setAuthenticated] = useState(
    () => sessionStorage.getItem("dispatchops-auth") === "true"
  );

  useEffect(() => {
    const handleAuthChange = () => {
      setAuthenticated(
        sessionStorage.getItem("dispatchops-auth") === "true"
      );
    };

    window.addEventListener(
      "dispatchops-auth-change",
      handleAuthChange
    );

    return () => {
      window.removeEventListener(
        "dispatchops-auth-change",
        handleAuthChange
      );
    };
  }, []);

  if (!authenticated) {
    return <Login />;
  }

  return <>{children}</>;
}

export default function App() {
  useEffect(() => {
    void syncPrimaryConfigurationToSecondary().catch(
      () => undefined
    );
  }, []);

  return (
    <HeroUIProvider>
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route
              path="/login"
              element={<Login />}
            />

            <Route
              path="*"
              element={
                <SetupGate>
                  <AuthGate>
                    <Suspense
                      fallback={<PageLoadingFallback />}
                    >
                      <Routes>
                        <Route
                          element={<ProtectedLayout />}
                        >
                          <Route
                            path="/"
                            element={<Dashboard />}
                          />

                          <Route
                            element={
                              <RoutePlanningToolbar />
                            }
                          >
                            <Route
                              path="/route-planner"
                              element={<RoutePlanner />}
                            />

                            <Route
                              path="/route-plan-driver"
                              element={
                                <DriverRoutePlan />
                              }
                            />

                            <Route
                              path="/route-plan-helper"
                              element={
                                <HelperRoutePlan />
                              }
                            />

                            <Route
                              path="/route-plan-sheet"
                              element={
                                <RoutePlanSheet />
                              }
                            />

                            <Route
                              path="/replacements"
                              element={
                                <Replacements />
                              }
                            />
                          </Route>

                          <Route
                            path="/fleet"
                            element={<Fleet />}
                          />

                          <Route
                            path="/experience"
                            element={<Experience />}
                          />

                          <Route
                            path="/vacations"
                            element={<Vacations />}
                          />

                          <Route
                            path="/customer-intelligence"
                            element={
                              <CustomerIntelligence />
                            }
                          />

                          <Route
                            path="/route-intelligence"
                            element={
                              <RouteIntelligence />
                            }
                          />

                          <Route
                            path="/ai-settings"
                            element={<AiSettings />}
                          />

                          <Route
                            path="/data-sync"
                            element={<DataSync />}
                          />

                          <Route
                            path="/backup"
                            element={<Backup />}
                          />

                          <Route
                            path="/audit-log"
                            element={<AuditLog />}
                          />

                          <Route
                            path="/imports"
                            element={<Imports />}
                          />

                          <Route
                            path="/location-knowledge"
                            element={
                              <LocationKnowledge />
                            }
                          />

                          <Route
                            path="/control-center"
                            element={
                              <ControlCenter />
                            }
                          />

                          <Route
                            path="/driver-mapping-review"
                            element={
                              <DriverMappingReviewPage />
                            }
                          />

                          <Route
                            path="/diagnostics"
                            element={
                              <DiagnosticsPage />
                            }
                          />

                          <Route
                            path="/dashboard-configuration"
                            element={
                              <DashboardConfigurationPage />
                            }
                          />

                          <Route
                            path="/price-change"
                            element={
                              <PriceChangeManager />
                            }
                          />
                        </Route>
                      </Routes>
                    </Suspense>
                  </AuthGate>
                </SetupGate>
              }
            />
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </HeroUIProvider>
  );
}
