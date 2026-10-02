import { Suspense } from "react";
import { useLocation, Outlet, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import TopNav from "./TopNav";
import FloatingAiWidget from "./FloatingAiWidget";
import { getRole } from "../api/client";
import { featureFlagsService } from "../services/system";

/**
 * The application login is handled by App.tsx/AuthGate. This layout keeps
 * the authenticated navigation and LOGI shell persistent across pages.
 */
export default function ProtectedLayout() {
  const location = useLocation();
  const [hiddenPages, setHiddenPages] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const role = getRole();
  const isRoutePlanningPath = ["/route-planner", "/route-plan-driver", "/route-plan-helper", "/route-plan-sheet", "/replacements"].includes(location.pathname);
  const transitionKey = isRoutePlanningPath ? "route-planning-shell" : location.pathname;

  useEffect(() => {
    let alive = true;
    featureFlagsService.list().then((flags) => {
      if (!alive) return;
      setHiddenPages(flags.filter((f) => f.name.startsWith("page_visible:") && !f.enabled).map((f) => f.name.slice("page_visible:".length)));
      setLoaded(true);
    }).catch(() => alive && setLoaded(true));
    return () => { alive = false; };
  }, []);

  if (loaded && role !== "admin" && hiddenPages.includes(location.pathname)) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <TopNav />
      <div className="top-nav-spacer" aria-hidden="true" />
      {/*
        BUGFIX (invisible-but-clickable pages): this used to be a Framer
        Motion `<AnimatePresence><motion.div initial={{opacity:0}}
        animate={{opacity:1}} exit={{opacity:0}} /></AnimatePresence>`
        page-transition wrapper. In practice the exit/enter handshake
        between the outgoing and incoming motion.div never resolved - the
        outgoing page stayed pinned at opacity:1 and the incoming page
        stayed pinned at opacity:0 (confirmed by inspecting both
        elements' live inline styles mid-navigation). Since the incoming
        page was still fully mounted DOM, it was completely interactive
        (clickable/hoverable) while invisible - exactly the reported bug.
        A JS-driven animation can get stuck forever if its completion
        callback never fires; a plain CSS animation cannot - the browser
        always runs it to completion and `animation-fill-mode: forwards`
        leaves the element at its final (visible) state regardless. The
        `key={location.pathname}` still forces a fresh mount (and thus a
        fresh fade-in) on every navigation, same as before. See the
        `.page-fade-in` keyframes in index.css.
      */}
      <Suspense fallback={<div key="page-loading" className="page-fade-in" style={{ minHeight: "40vh" }} />} >
        <div
          key={transitionKey}
          className={isRoutePlanningPath ? "route-planning-transition" : "page-fade-in"}
        >
          <Outlet />
        </div>
      </Suspense>
      <FloatingAiWidget />
    </>
  );
}
