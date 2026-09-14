import { useLocation, Outlet } from "react-router-dom";
import TopNav from "./TopNav";
import FloatingAiWidget from "./FloatingAiWidget";

/**
 * PERMANENT ARCHITECTURE: this app has no login, so there is nothing for
 * this layout to gate - it exists purely to wrap every real page in the
 * persistent TopNav/FloatingAiWidget chrome. (Connectivity to the local
 * backend sidecar is handled one level up, by SetupGate.tsx - by the time
 * anything renders here, that's already confirmed working.)
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
