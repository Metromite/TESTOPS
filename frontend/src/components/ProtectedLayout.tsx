import { Outlet, useLocation } from "react-router-dom";
import TopNav from "./TopNav";
import FloatingAiWidget from "./FloatingAiWidget";

/**
 * TEMPORARY: the isLoggedIn()-based redirect to /login is disabled while
 * auth is off app-wide (see core/config.py's AUTH_DISABLED). To re-enable:
 * restore the `if (!isLoggedIn()) return <Navigate to="/login" replace />;`
 * check here.
 */
export default function ProtectedLayout() {
  const location = useLocation();
  return (
    <>
      <TopNav />
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
      <div key={location.pathname} className="page-fade-in">
        <Outlet />
      </div>
      <FloatingAiWidget />
    </>
  );
}
