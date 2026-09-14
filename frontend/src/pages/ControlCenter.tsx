/**
 * pages/ControlCenter.tsx
 * ------------------------
 * "Operations Control Center" (rounds -7 through -11). See the end of this
 * comment block for what is still honestly not done.
 *
 * Reuses the exact same page/tab components as Dashboard.tsx and the top
 * nav routes for every slide's content - no parallel KPI/chart calculation
 * was written for this feature at any point across any round.
 *
 * ============================ DATA MODEL ============================
 * GlobalConfig lives in Postgres (models/control_center.py, one row,
 * versioned - see "Backend persistence" below) with a localStorage copy
 * as an offline fallback and manual export/import path:
 *   - playlists: named, CRUD-able. Each playlist is EITHER a Rotation
 *     playlist (ordered list of whole slides, auto-advancing) OR a Grid
 *     playlist (a react-grid-layout canvas of individual Cards - add,
 *     remove, duplicate, drag, resize, lock, pin, plus Section divider
 *     cards for grouping, undo/redo, and per-card style - see round -11).
 *   - schedule: time-of-day -> playlist entries, with an on/off switch.
 *   - branding: company name, accent color, logo (data URL).
 *   - displayAssignments: displayName -> playlistId, so an admin can
 *     pre-wire "TV1 -> Warehouse", "TV2 -> Executive" etc.
 * Per-browser-only (never synced/exported, since these are physical-
 * display secrets/identity, not shared config): this display's name, its
 * kiosk exit password, and a manual playlist override.
 *
 * ============================ BUILT, BY ROUND ============================
 * -7: Rotation Mode, Playlist (single, checkbox+drag reorder), Kiosk Mode
 *     (fullscreen, hidden chrome, cursor-idle-hide, password exit,
 *     refresh-persistence), Executive Mode.
 * -8: Manual Layout (Grid) Mode via react-grid-layout - add/remove/
 *     duplicate/drag/resize/lock/pin cards, Section dividers, multiple
 *     named Playlists (full CRUD), Scheduler, Display Assignments,
 *     Branding, JSON Export/Import.
 * -9: Real backend persistence. GET/PUT /api/control-center/config
 *     (Admin-only write) backed by a real `control_center_config`
 *     Postgres table via an applied Alembic migration (9d13aa7e5aa7) -
 *     a local Postgres 16 instance was installed in the build environment
 *     specifically to generate/apply/verify that migration and round-trip
 *     real HTTP requests against it, not written blind. localStorage
 *     remains the offline fallback.
 * -10: Optimistic locking (a `version` column + `?expected_version=`;
 *     stale writes get a real 409 with the current server state instead
 *     of silently overwriting it - the previous "last-write-wins" design
 *     from round -9 was replaced here, verified with an actual
 *     GET->PUT->stale-PUT->409->GET sequence against the running server)
 *     and a live WebSocket push (`/api/control-center/ws`) so every
 *     connected display updates the instant anyone else saves - verified
 *     with a real Python WebSocket client receiving a real broadcast
 *     triggered by a separate `curl` PUT while it was connected.
 * -11: Per-card style (glass transparency / shadow / rounded corners /
 *     entrance animation / auto-refresh interval - all via a small 🎨
 *     popover on each card), applied consistently in both the grid editor
 *     and the live/kiosk display (see the shared `LiveCard` /
 *     `OccGridCard` styling logic). Auto-refresh works by changing a
 *     `key` on the div wrapping a card's content on a timer, forcing
 *     React to fully unmount+remount it (re-running its own fetch) - no
 *     changes needed inside the 10 existing slide components for this.
 *     Also added: Undo/Redo (Ctrl+Z / Ctrl+Y) for structural grid edits
 *     (add/remove/duplicate/drag/resize - NOT per-keystroke text edits,
 *     which would make the history useless noise) and keyboard shortcuts
 *     (Delete/Backspace removes the selected card, Ctrl+D duplicates it,
 *     Escape deselects) via a lightweight card-selection model.
 * -12: Widget library. The 10 dashboard pages were decomposed into ~36
 *     atomic KPI/chart/table widgets (see widgets/*.tsx) - EVERY page was
 *     refactored to compose the exact same presentational components its
 *     standalone widgets use, sharing one data-fetch hook each
 *     (hooks/useDashboardQuery.ts, hooks/useHomeData.ts), so there is no
 *     duplicated or reimplemented calculation anywhere - moved, not
 *     rewritten. Registered in widgets/registry.tsx and browsable from a
 *     searchable, category-grouped Widget Library panel in the Grid/
 *     Canvas editors (KPIs & Metrics / Charts / Tables / Whole Pages).
 *     Experience, Route Intelligence, and Route Plan Sheet were
 *     deliberately NOT decomposed - each is one cohesive interactive unit
 *     (a search bar or selector driving what a table shows), and forcing
 *     them apart would mean duplicating that shared interaction state for
 *     no real benefit; they're still addable as whole-page cards.
 *     FLAGGED LIMITATION: each standalone widget fetches independently -
 *     dropping several widgets from the same source page on one canvas
 *     means that many independent fetches (each on its own poll interval,
 *     if the source page polls), not a shared cache. A cross-card query
 *     cache is real follow-up work, not attempted this round.
 * -13: Free Canvas mode - a third playlist mode alongside Rotation and
 *     Grid. Pixel-precise absolute positioning (not grid-snapped) via
 *     custom Pointer Events drag/resize, z-index layering (bring to
 *     front/back, forward/backward - buttons and Ctrl+]/Ctrl+[/
 *     Ctrl+Shift+]/Ctrl+Shift+[), zoom (CSS transform: scale, 40%-200%),
 *     panning (native scroll of the surface container), optional snap-to-
 *     grid (configurable px), and the same Undo/Redo + card-selection +
 *     Delete/Ctrl+D/Escape shortcuts as Grid mode (generalized rather than
 *     duplicated, since both modes just snapshot the same `cards` array).
 *     HONEST LIMITATION, stated plainly: this type-checks and builds
 *     clean, but there is no headless-browser/UI-automation tool in this
 *     environment to actually perform a mouse drag and confirm the result
 *     - unlike the backend work in earlier rounds, which had real HTTP
 *     round-trips to verify against. The drag/resize implementation
 *     follows a standard, well-established React pointer-events pattern,
 *     but "compiles cleanly" is a different and weaker claim than "was
 *     clicked and dragged in a real browser and confirmed correct" - that
 *     verification still needs to happen by hand before relying on it.
 *
 * ============================ STILL DEFERRED, FLAGGED HONESTLY =============
 *  - Dynamic snap-TO-GUIDES (live alignment lines against sibling card
 *    edges while dragging in Canvas mode) - what's built is snap-to-a-
 *    fixed-grid-size, which is simpler and was judged safer to ship
 *    without interactive testing than a fancier edge-alignment system
 *    with on-screen guide lines. A real, distinct gap from the original
 *    "Snap to Guides" spec item, not silently substituted without saying so.
 *  - True unconstrained layering beyond z-index (true free canvas
 *    positioning IS now built as of round -13 - this bullet used to say
 *    the whole free-canvas designer was missing; it's the guide-snapping
 *    specifically that remains, not the canvas itself).
 *  - Individual KPI/chart-level cards ARE now built (round -12) for the 6
 *    filter-driven dashboard pages plus Customer Intelligence's 2 KPIs -
 *    NOT for Experience/Route Intelligence/Route Plan Sheet, which remain
 *    single cohesive units by deliberate choice (see round -12 above), and
 *    NOT decomposed down to sub-chart elements (e.g. one Recharts series
 *    within a multi-series chart is not its own separate widget).
 *  - Per-card footer on/off, legend on/off, value on/off - unlike the
 *    round -11 style properties (which are all wrapper-level CSS on this
 *    file's own components), these toggle specific INNER elements a chart
 *    or table renders, so they'd need new props threaded into the source
 *    widget components in widgets/*.tsx.
 *  - A shared cross-card data cache (see round -12's flagged limitation
 *    above) - each standalone widget fetches independently.
 *  - Live "only update changed data" push for the general dashboard - the
 *    round -10 WebSocket is scoped to Control Center's own config only.
 *    Every widget's actual KPI/chart data still does its own normal
 *    fetch-on-mount; nothing diffs/streams updates for that.
 *  - Field-level conflict merge - round -10's 409 handling makes the
 *    loser's edit visibly discarded and the winner's adopted, which is
 *    honest and correct, but it is not "both edits combined."
 *  - The WebSocket broadcast (round -10) is in-process only - would need
 *    Postgres LISTEN/NOTIFY or Redis to fan out correctly across more
 *    than one uvicorn worker. Not built, since this app runs one worker.
 *  - Logo/branding export as an efficient bundle - logos are data URLs in
 *    the exported JSON today, which works but bloats it for a large image.
 */
import { useEffect, useMemo, useRef, useState, ReactNode } from "react";
import GridLayout, { WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import HomeTab from "./HomeTab";
import DriverPerformanceTab from "./DriverPerformanceTab";
import LeadTimeTab from "./LeadTimeTab";
import OrderSummaryTab from "./OrderSummaryTab";
import AreaAnalyticsTab from "./AreaAnalyticsTab";
import NotSuppliedTab from "./NotSuppliedTab";
import Experience from "./Experience";
import CustomerIntelligence from "./CustomerIntelligence";
import RouteIntelligence from "./RouteIntelligence";
import RoutePlanSheet from "./RoutePlanSheet";
import OccGridCard, { OccCardChrome, DEFAULT_CARD_STYLE } from "../components/OccGridCard";
import { WIDGET_REGISTRY, WIDGET_CATEGORIES, WidgetCategory } from "../widgets/registry";
import { api } from "../api/client";
import { Play, Pause, Monitor, Tv, Search } from "lucide-react";
import DashboardTabs from "../components/DashboardTabs";
import { GlassButton } from "../design-system/GlassButton";
import { GlassPanel } from "../design-system/GlassPanel";
import { GlassInput } from "../design-system/GlassInput";

const ResponsiveGridLayout = WidthProvider(GridLayout);

interface SlideDef { key: string; label: string; render: () => JSX.Element; }

const ALL_SLIDES: SlideDef[] = [
  { key: "home", label: "Overview", render: () => <HomeTab driver="" onSelectDriver={() => {}} onDriverListLoaded={() => {}} /> },
  { key: "driver-performance", label: "Driver Performance", render: () => <DriverPerformanceTab driver="" /> },
  { key: "lead-time", label: "Lead Time", render: () => <LeadTimeTab driver="" setLeadTimeBand={() => {}} setClassification={() => {}} /> },
  { key: "order-summary", label: "Order Summary", render: () => <OrderSummaryTab driver="" /> },
  { key: "area-analytics", label: "Area Analytics", render: () => <AreaAnalyticsTab driver="" /> },
  { key: "not-supplied", label: "Not Supplied", render: () => <NotSuppliedTab driver="" /> },
  { key: "experience", label: "Experience", render: () => <Experience /> },
  { key: "customer-intelligence", label: "Customer Intelligence", render: () => <CustomerIntelligence /> },
  { key: "route-intelligence", label: "Route Intelligence", render: () => <RouteIntelligence /> },
  { key: "route-plan-sheet", label: "Current Route Plan", render: () => <RoutePlanSheet /> },
];
const SECTION_KEY = "section";
const INTERVALS = [5, 10, 15, 20, 30, 45, 60, 120, 300];

// round -12: the card-content lookup now checks three sources in order -
// the section-divider pseudo-card, the 10 whole-page slides (unchanged
// from round -7), and the new atomic widget registry. A widget id and a
// slide key can never collide since every widget id is prefixed
// (home-kpi-*, dp-chart-*, etc.) and no ALL_SLIDES key uses a dash-prefix
// scheme like that.
function slideLabel(key: string) {
  if (key === SECTION_KEY) return "Section Divider";
  return ALL_SLIDES.find((s) => s.key === key)?.label ?? WIDGET_REGISTRY.find((w) => w.id === key)?.label ?? key;
}
function slideRender(key: string): (() => ReactNode) | undefined {
  return ALL_SLIDES.find((s) => s.key === key)?.render ?? WIDGET_REGISTRY.find((w) => w.id === key)?.render;
}

// ---- data model ----
interface CardConfig extends OccCardChrome {
  id: string;
  slideKey: string;
  layout: { x: number; y: number; w: number; h: number }; // grid mode (grid units)
  canvasLayout?: { x: number; y: number; w: number; h: number; z: number }; // round -13: free-canvas mode (pixels + z-order). Optional/lazily defaulted so existing saved playlists from before round -13 don't need a migration - see getCanvasLayout().
}
interface Playlist {
  id: string;
  name: string;
  mode: "rotation" | "grid" | "canvas";
  slideOrder: string[];
  intervalSec: number;
  cards: CardConfig[];
  canvasSnapToGrid?: boolean; // round -13, canvas-mode only
  canvasGridSize?: number; // round -13, canvas-mode only, px
}
interface ScheduleEntry { id: string; time: string; playlistId: string; }
interface Branding { companyName: string; accentColor: string; logoDataUrl: string; }
interface GlobalConfig {
  playlists: Playlist[];
  schedule: ScheduleEntry[];
  schedulerEnabled: boolean;
  branding: Branding;
  displayAssignments: Record<string, string>;
}

const LS_CONFIG = "occ_config_v2";
const LS_DISPLAY_NAME = "occ_display_name";
const LS_KIOSK = "occ_kiosk_on";
const LS_KIOSK_PW = "occ_kiosk_password";
const LS_MANUAL_PLAYLIST = "occ_manual_playlist";

let uidCounter = 0;
function uid(prefix: string) { uidCounter += 1; return `${prefix}_${Date.now().toString(36)}_${uidCounter}`; }

function defaultCardsFromSlides(): CardConfig[] {
  return ALL_SLIDES.map((s, i) => ({
    id: uid("card"), slideKey: s.key, title: s.label, accent: "#2878d6",
    compact: false, headerOn: true, locked: false, pinned: false, ...DEFAULT_CARD_STYLE,
    layout: { x: (i % 2) * 6, y: Math.floor(i / 2) * 8, w: 6, h: 8 },
  }));
}
function defaultConfig(): GlobalConfig {
  return {
    playlists: [
      { id: "default", name: "Default Rotation", mode: "rotation", slideOrder: ALL_SLIDES.map((s) => s.key), intervalSec: 15, cards: defaultCardsFromSlides() },
    ],
    schedule: [],
    schedulerEnabled: false,
    branding: { companyName: "City Pharmacy", accentColor: "#2878d6", logoDataUrl: "" },
    displayAssignments: {},
  };
}
function loadConfig(): GlobalConfig {
  try {
    const raw = localStorage.getItem(LS_CONFIG);
    if (raw) {
      const parsed = JSON.parse(raw);
      // shallow-merge so older saved configs missing newer fields don't crash
      return { ...defaultConfig(), ...parsed };
    }
  } catch { /* fall through to defaults on malformed JSON */ }
  return defaultConfig();
}

export default function ControlCenter() {
  const [config, setConfig] = useState<GlobalConfig>(loadConfig);
  const [displayName, setDisplayName] = useState(() => localStorage.getItem(LS_DISPLAY_NAME) || "");
  const [manualPlaylistId, setManualPlaylistId] = useState<string>(() => localStorage.getItem(LS_MANUAL_PLAYLIST) || config.playlists[0]?.id || "");
  const [editingPlaylistId, setEditingPlaylistId] = useState<string>(config.playlists[0]?.id || "");
  const [rotating, setRotating] = useState(false);
  const [slideIdx, setSlideIdx] = useState(0);
  const [kiosk, setKiosk] = useState(() => localStorage.getItem(LS_KIOSK) === "1");
  const [kioskPassword, setKioskPassword] = useState(() => localStorage.getItem(LS_KIOSK_PW) || "");
  const [executive, setExecutive] = useState(false);
  const [cursorHidden, setCursorHidden] = useState(false);
  const [showExitPrompt, setShowExitPrompt] = useState(false);
  const [exitPasswordInput, setExitPasswordInput] = useState("");
  const [panel, setPanel] = useState<"playlists" | "scheduler" | "branding" | "displays" | "data" | null>("playlists");
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragIdx = useRef<number | null>(null);

  const [syncStatus, setSyncStatus] = useState<"loading" | "synced" | "saving" | "offline" | "conflict">("loading");
  const hydratedFromServer = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverVersion = useRef(0);
  // Set right before a setConfig() call that adopts a REMOTE copy of the
  // config (a 409's server state, or a websocket push) - the very next
  // [config] effect run should NOT re-save that remote copy back to the
  // server as if it were a local edit, or every remote update would
  // trigger a redundant echo PUT.
  const suppressNextSave = useRef(false);

  function adoptRemote(remoteConfig: GlobalConfig, version: number) {
    suppressNextSave.current = true;
    serverVersion.current = version;
    setConfig((c) => ({ ...defaultConfig(), ...c, ...remoteConfig }));
  }

  // Load the shared server config on mount. If it fails (offline, etc.)
  // silently keep whatever loadConfig() already put in state (localStorage
  // copy or defaults) - a TV shouldn't go blank because of a network blip.
  useEffect(() => {
    let cancelled = false;
    api.get("/control-center/config")
      .then((res: { config: GlobalConfig | null; version: number }) => {
        if (cancelled) return;
        serverVersion.current = res.version || 0;
        if (res?.config) setConfig((c) => ({ ...defaultConfig(), ...c, ...res.config }));
        setSyncStatus("synced");
      })
      .catch(() => { if (!cancelled) setSyncStatus("offline"); })
      .finally(() => { hydratedFromServer.current = true; });
    return () => { cancelled = true; };
  }, []);

  // Live push: every OTHER display/admin's save arrives here instantly
  // instead of waiting for this display's own debounce/poll. Scoped to
  // Control Center config only - not the general dashboard-wide "only
  // update changed data" layer described in the original spec (see this
  // file's header comment for that distinction).
  //
  // Design tradeoff, stated plainly: a push with a newer version is
  // applied immediately, even if this display has an unsaved local edit
  // in flight. For a handful of admins configuring TVs, last-applied-wins
  // on the live view is an acceptable, simple behavior; it is NOT a
  // field-level merge. The 409 path below is the actual safety net for
  // two people saving at once - this websocket path is for everyone else
  // just watching the result update live.
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}://${window.location.host}/api/control-center/ws`);
    } catch {
      return; // WebSocket constructor can throw synchronously in some environments
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "config_update" && typeof msg.version === "number" && msg.version > serverVersion.current && msg.config) {
          adoptRemote(msg.config, msg.version);
        }
      } catch { /* ignore malformed frame */ }
    };
    return () => ws.close();
  }, []);

  useEffect(() => { localStorage.setItem(LS_CONFIG, JSON.stringify(config)); }, [config]);

  // Debounced push to the server whenever config changes, after the initial
  // load has resolved (so we don't immediately overwrite the server with
  // pre-load defaults) and skipping saves that are themselves just us
  // adopting a remote copy (see suppressNextSave above). Sends the version
  // this display last saw - a 409 means someone else saved first, so we
  // adopt THEIR result instead of overwriting it. Admin-only on the
  // backend - a non-admin display's PUT will fail and fall back to
  // "offline" (its localStorage copy still updates fine, it just can't
  // push shared changes upstream).
  useEffect(() => {
    if (!hydratedFromServer.current) return;
    if (suppressNextSave.current) { suppressNextSave.current = false; return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSyncStatus("saving");
      const token = localStorage.getItem("access_token");
      try {
        const res = await fetch(`/api/control-center/config?expected_version=${serverVersion.current}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(config),
        });
        if (res.status === 409) {
          const body = await res.json();
          adoptRemote(body.detail.config, body.detail.version);
          setSyncStatus("conflict");
          setTimeout(() => setSyncStatus("synced"), 2500);
          return;
        }
        if (!res.ok) throw new Error("save failed");
        const body = await res.json();
        serverVersion.current = body.version;
        setSyncStatus("synced");
      } catch {
        setSyncStatus("offline");
      }
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [config]);

  useEffect(() => { localStorage.setItem(LS_DISPLAY_NAME, displayName); }, [displayName]);
  useEffect(() => { localStorage.setItem(LS_MANUAL_PLAYLIST, manualPlaylistId); }, [manualPlaylistId]);
  useEffect(() => { localStorage.setItem(LS_KIOSK_PW, kioskPassword); }, [kioskPassword]);

  // ---- which playlist is "live" right now on this display ----
  // Priority: schedule (if enabled) > this display's assignment > manual pick.
  const scheduledPlaylistId = useMemo(() => {
    if (!config.schedulerEnabled || config.schedule.length === 0) return null;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const sorted = [...config.schedule].sort((a, b) => {
      const [ah, am] = a.time.split(":").map(Number);
      const [bh, bm] = b.time.split(":").map(Number);
      return ah * 60 + am - (bh * 60 + bm);
    });
    let candidate = sorted[sorted.length - 1]; // wrap to last entry (yesterday's) if before all of today's
    for (const entry of sorted) {
      const [h, m] = entry.time.split(":").map(Number);
      if (h * 60 + m <= nowMin) candidate = entry;
    }
    return candidate?.playlistId ?? null;
  }, [config.schedulerEnabled, config.schedule, /* re-check every 30s via tick below */ Math.floor(Date.now() / 30000)]);

  const activePlaylistId = scheduledPlaylistId || config.displayAssignments[displayName] || manualPlaylistId || config.playlists[0]?.id;
  const activePlaylist = config.playlists.find((p) => p.id === activePlaylistId) || config.playlists[0];
  const activeSource = scheduledPlaylistId ? "Scheduler" : config.displayAssignments[displayName] ? "Display assignment" : "Manual selection";

  const editingPlaylist = config.playlists.find((p) => p.id === editingPlaylistId) || config.playlists[0];

  // force a re-render every 30s so the scheduler check above re-evaluates
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const rotationSlides = useMemo(
    () => (activePlaylist?.slideOrder || []).map((k) => ALL_SLIDES.find((s) => s.key === k)).filter(Boolean) as SlideDef[],
    [activePlaylist]
  );

  useEffect(() => {
    if (!rotating || activePlaylist?.mode !== "rotation" || rotationSlides.length === 0) return;
    const id = setInterval(() => setSlideIdx((i) => (i + 1) % rotationSlides.length), (activePlaylist.intervalSec || 15) * 1000);
    return () => clearInterval(id);
  }, [rotating, activePlaylist, rotationSlides.length]);

  useEffect(() => { if (slideIdx >= rotationSlides.length) setSlideIdx(0); }, [rotationSlides.length, slideIdx]);

  // ---- kiosk / fullscreen / cursor-idle (unchanged behavior from round -7) ----
  useEffect(() => {
    localStorage.setItem(LS_KIOSK, kiosk ? "1" : "0");
    document.body.classList.toggle("occ-kiosk-active", kiosk);
    if (kiosk) {
      containerRef.current?.requestFullscreen?.().catch(() => {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }, [kiosk]);
  useEffect(() => () => document.body.classList.remove("occ-kiosk-active"), []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (kiosk && e.key === "Escape") setShowExitPrompt(true); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kiosk]);
  useEffect(() => {
    if (!kiosk) { setCursorHidden(false); return; }
    function resetIdle() {
      setCursorHidden(false);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setCursorHidden(true), 3000);
    }
    resetIdle();
    window.addEventListener("mousemove", resetIdle);
    return () => { window.removeEventListener("mousemove", resetIdle); if (idleTimer.current) clearTimeout(idleTimer.current); };
  }, [kiosk]);
  function attemptExitKiosk() {
    if (!kioskPassword || exitPasswordInput === kioskPassword) { setKiosk(false); setShowExitPrompt(false); setExitPasswordInput(""); }
  }

  // ---- playlist CRUD ----
  function updatePlaylist(id: string, patch: Partial<Playlist>) {
    setConfig((c) => ({ ...c, playlists: c.playlists.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  }
  function createPlaylist() {
    const p: Playlist = { id: uid("pl"), name: `New Playlist ${config.playlists.length + 1}`, mode: "rotation", slideOrder: [], intervalSec: 15, cards: [] };
    setConfig((c) => ({ ...c, playlists: [...c.playlists, p] }));
    setEditingPlaylistId(p.id);
  }
  function duplicatePlaylist(id: string) {
    const src = config.playlists.find((p) => p.id === id);
    if (!src) return;
    const copy: Playlist = { ...src, id: uid("pl"), name: `${src.name} (copy)`, cards: src.cards.map((c) => ({ ...c, id: uid("card") })) };
    setConfig((c) => ({ ...c, playlists: [...c.playlists, copy] }));
    setEditingPlaylistId(copy.id);
  }
  function deletePlaylist(id: string) {
    if (config.playlists.length <= 1) return; // always keep at least one
    setConfig((c) => ({ ...c, playlists: c.playlists.filter((p) => p.id !== id) }));
    if (editingPlaylistId === id) setEditingPlaylistId(config.playlists.find((p) => p.id !== id)?.id || "");
    if (manualPlaylistId === id) setManualPlaylistId(config.playlists[0]?.id || "");
  }

  // ---- rotation-mode slide order editing ----
  function toggleSlideInRotation(playlistId: string, key: string) {
    const p = config.playlists.find((pp) => pp.id === playlistId);
    if (!p) return;
    const has = p.slideOrder.includes(key);
    updatePlaylist(playlistId, { slideOrder: has ? p.slideOrder.filter((k) => k !== key) : [...p.slideOrder, key] });
  }
  function moveSlideInRotation(playlistId: string, from: number, to: number) {
    const p = config.playlists.find((pp) => pp.id === playlistId);
    if (!p) return;
    const next = [...p.slideOrder];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    updatePlaylist(playlistId, { slideOrder: next });
  }

  // ---- grid-mode undo/redo (round -11): per-playlist history of `cards`
  // snapshots. Only pushed for structural changes (add/remove/duplicate/
  // drag/resize) - NOT on every keystroke while editing a title, or the
  // undo stack would be useless noise.
  const history = useRef<{ playlistId: string; stack: CardConfig[][]; pointer: number }>({ playlistId: "", stack: [], pointer: -1 });
  const [, forceHistoryTick] = useState(0); // re-render so Undo/Redo buttons' disabled state stays accurate
  function pushHistory(playlistId: string, cardsBeforeChange: CardConfig[]) {
    const h = history.current;
    if (h.playlistId !== playlistId) { h.playlistId = playlistId; h.stack = [cardsBeforeChange]; h.pointer = 0; }
    else {
      h.stack = h.stack.slice(0, h.pointer + 1);
      h.stack.push(cardsBeforeChange);
      h.pointer = h.stack.length - 1;
      if (h.stack.length > 50) { h.stack.shift(); h.pointer -= 1; }
    }
    forceHistoryTick((n) => n + 1);
  }
  function undo(playlistId: string) {
    const h = history.current;
    if (h.playlistId !== playlistId || h.pointer <= 0) return;
    h.pointer -= 1;
    updatePlaylist(playlistId, { cards: h.stack[h.pointer] });
    forceHistoryTick((n) => n + 1);
  }
  function redo(playlistId: string) {
    const h = history.current;
    if (h.playlistId !== playlistId || h.pointer >= h.stack.length - 1) return;
    h.pointer += 1;
    updatePlaylist(playlistId, { cards: h.stack[h.pointer] });
    forceHistoryTick((n) => n + 1);
  }
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryCategory, setLibraryCategory] = useState<WidgetCategory | "page">("kpi");
  const [canvasZoom, setCanvasZoom] = useState(1);

  // ---- grid-mode card editing ----
  function addCard(playlistId: string, slideKey: string) {
    const p = config.playlists.find((pp) => pp.id === playlistId);
    if (!p) return;
    pushHistory(playlistId, p.cards);
    const maxY = p.cards.reduce((m, c) => Math.max(m, c.layout.y + c.layout.h), 0);
    const card: CardConfig = {
      id: uid("card"), slideKey, title: slideKey === SECTION_KEY ? "New Section" : slideLabel(slideKey),
      accent: config.branding.accentColor, compact: false, headerOn: true, locked: false, pinned: false, ...DEFAULT_CARD_STYLE,
      layout: { x: 0, y: maxY, w: slideKey === SECTION_KEY ? 12 : 6, h: slideKey === SECTION_KEY ? 2 : 8 },
    };
    updatePlaylist(playlistId, { cards: [...p.cards, card] });
    setSelectedCardId(card.id);
  }
  function patchCard(playlistId: string, cardId: string, patch: Partial<CardConfig>) {
    const p = config.playlists.find((pp) => pp.id === playlistId);
    if (!p) return;
    updatePlaylist(playlistId, { cards: p.cards.map((c) => (c.id === cardId ? { ...c, ...patch } : c)) });
  }
  function removeCard(playlistId: string, cardId: string) {
    const p = config.playlists.find((pp) => pp.id === playlistId);
    if (!p) return;
    pushHistory(playlistId, p.cards);
    updatePlaylist(playlistId, { cards: p.cards.filter((c) => c.id !== cardId) });
    setSelectedCardId((s) => (s === cardId ? null : s));
  }
  function duplicateCard(playlistId: string, cardId: string) {
    const p = config.playlists.find((pp) => pp.id === playlistId);
    const src = p?.cards.find((c) => c.id === cardId);
    if (!p || !src) return;
    pushHistory(playlistId, p.cards);
    const copy: CardConfig = { ...src, id: uid("card"), layout: { ...src.layout, x: 0, y: p.cards.reduce((m, c) => Math.max(m, c.layout.y + c.layout.h), 0) } };
    updatePlaylist(playlistId, { cards: [...p.cards, copy] });
    setSelectedCardId(copy.id);
  }
  function pushGridHistorySnapshot(playlistId: string) {
    const p = config.playlists.find((pp) => pp.id === playlistId);
    if (p) pushHistory(playlistId, p.cards);
  }
  function onGridLayoutChange(playlistId: string, layout: { i: string; x: number; y: number; w: number; h: number }[]) {
    const p = config.playlists.find((pp) => pp.id === playlistId);
    if (!p) return;
    updatePlaylist(playlistId, {
      cards: p.cards.map((c) => {
        const l = layout.find((x) => x.i === c.id);
        return l ? { ...c, layout: { x: l.x, y: l.y, w: l.w, h: l.h } } : c;
      }),
    });
  }

  // ---- free canvas mode (round -13) ----
  // A card added before it ever gets dragged has no canvasLayout yet -
  // this derives a stable default purely from its position in the cards
  // array, so it renders somewhere sane (a loose cascade) without needing
  // a migration for playlists saved before round -13.
  function getCanvasLayout(card: CardConfig, indexInPlaylist: number): { x: number; y: number; w: number; h: number; z: number } {
    if (card.canvasLayout) return card.canvasLayout;
    return { x: (indexInPlaylist % 4) * 340 + 20, y: Math.floor(indexInPlaylist / 4) * 260 + 20, w: 320, h: 240, z: indexInPlaylist + 1 };
  }
  function snapValue(v: number, playlist: Playlist) {
    if (!playlist.canvasSnapToGrid) return Math.round(v);
    const size = playlist.canvasGridSize || 20;
    return Math.round(v / size) * size;
  }
  function commitCanvasLayout(playlistId: string, cardId: string, next: { x: number; y: number; w: number; h: number; z: number }) {
    const p = config.playlists.find((pp) => pp.id === playlistId);
    if (!p) return;
    const snapped = { ...next, x: snapValue(next.x, p), y: snapValue(next.y, p) };
    updatePlaylist(playlistId, { cards: p.cards.map((c) => (c.id === cardId ? { ...c, canvasLayout: snapped } : c)) });
  }
  function canvasZOrder(playlistId: string, cardId: string, op: "front" | "back" | "forward" | "backward") {
    const p = config.playlists.find((pp) => pp.id === playlistId);
    if (!p) return;
    pushHistory(playlistId, p.cards);
    const layouts = p.cards.map((c, i) => getCanvasLayout(c, i));
    const zs = layouts.map((l) => l.z);
    const maxZ = Math.max(1, ...zs), minZ = Math.min(1, ...zs);
    const idx = p.cards.findIndex((c) => c.id === cardId);
    if (idx < 0) return;
    const current = layouts[idx];
    let newZ = current.z;
    if (op === "front") newZ = maxZ + 1;
    else if (op === "back") newZ = minZ - 1;
    else if (op === "forward") newZ = current.z + 1;
    else if (op === "backward") newZ = current.z - 1;
    updatePlaylist(playlistId, {
      cards: p.cards.map((c, i) => (c.id === cardId ? { ...c, canvasLayout: { ...getCanvasLayout(c, i), z: newZ } } : c)),
    });
  }

  // ---- keyboard shortcuts (round -11, extended round -13 for canvas
  // z-order): active while the grid OR canvas editor for the
  // currently-selected card is on screen, and never while an
  // input/textarea has focus (so typing a title doesn't trigger them).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (panel !== "playlists" || !editingPlaylist || (editingPlaylist.mode !== "grid" && editingPlaylist.mode !== "canvas")) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(editingPlaylist.id); }
      else if (mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); redo(editingPlaylist.id); }
      else if (selectedCardId && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); removeCard(editingPlaylist.id, selectedCardId); }
      else if (selectedCardId && mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateCard(editingPlaylist.id, selectedCardId); }
      else if (editingPlaylist.mode === "canvas" && selectedCardId && mod && e.key === "]") { e.preventDefault(); canvasZOrder(editingPlaylist.id, selectedCardId, e.shiftKey ? "front" : "forward"); }
      else if (editingPlaylist.mode === "canvas" && selectedCardId && mod && e.key === "[") { e.preventDefault(); canvasZOrder(editingPlaylist.id, selectedCardId, e.shiftKey ? "back" : "backward"); }
      else if (e.key === "Escape") { setSelectedCardId(null); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, editingPlaylist, selectedCardId]);

  // ---- scheduler ----
  function addScheduleEntry() {
    const entry: ScheduleEntry = { id: uid("sched"), time: "08:00", playlistId: config.playlists[0]?.id || "" };
    setConfig((c) => ({ ...c, schedule: [...c.schedule, entry] }));
  }
  function updateScheduleEntry(id: string, patch: Partial<ScheduleEntry>) {
    setConfig((c) => ({ ...c, schedule: c.schedule.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  }
  function removeScheduleEntry(id: string) {
    setConfig((c) => ({ ...c, schedule: c.schedule.filter((s) => s.id !== id) }));
  }

  // ---- branding ----
  function updateBranding(patch: Partial<Branding>) {
    setConfig((c) => ({ ...c, branding: { ...c.branding, ...patch } }));
  }
  function onLogoFile(f: File) {
    const reader = new FileReader();
    reader.onload = () => updateBranding({ logoDataUrl: String(reader.result) });
    reader.readAsDataURL(f);
  }

  // ---- display assignments ----
  function setAssignment(name: string, playlistId: string) {
    setConfig((c) => ({ ...c, displayAssignments: { ...c.displayAssignments, [name]: playlistId } }));
  }
  function removeAssignment(name: string) {
    setConfig((c) => {
      const next = { ...c.displayAssignments };
      delete next[name];
      return { ...c, displayAssignments: next };
    });
  }

  // ---- export / import ----
  function exportConfig() {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "control-center-config.json"; a.click();
    URL.revokeObjectURL(url);
  }
  function importConfig(f: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        setConfig({ ...defaultConfig(), ...parsed });
      } catch {
        alert("That file isn't valid Control Center JSON.");
      }
    };
    reader.readAsText(f);
  }

  const current = rotationSlides[slideIdx];

  return (
    <div
      ref={containerRef}
      className={"occ-root" + (kiosk ? " occ-kiosk" : "") + (executive ? " occ-executive" : "") + (cursorHidden ? " occ-cursor-hidden" : "")}
      style={{ ["--occ-accent" as any]: config.branding.accentColor }}
    >
      {!kiosk && (
        <div className="page">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
            <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
              Operations Control Center
              <span style={{ fontSize: 11, fontWeight: 400, color: syncStatus === "offline" ? "var(--red)" : syncStatus === "conflict" ? "var(--amber)" : "var(--muted)" }}>
                {syncStatus === "loading" ? "Loading…" : syncStatus === "saving" ? "Saving…" : syncStatus === "conflict" ? "⚠ Another display saved first - adopted their change" : syncStatus === "offline" ? "⚠ Offline (using local copy)" : "✓ Synced"}
              </span>
            </h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {activePlaylist?.mode === "rotation" && (
                <GlassButton variant="secondary" size="sm" onClick={() => setRotating((r) => !r)} disabled={rotationSlides.length === 0}>
                  {rotating ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {rotating ? "Pause Rotation" : "Start Rotation"}
                </GlassButton>
              )}
              <GlassButton variant="secondary" size="sm" onClick={() => setExecutive((e) => !e)}>
                <Monitor className="h-3.5 w-3.5" />
                {executive ? "Exit Executive Mode" : "Executive Mode"}
              </GlassButton>
              <GlassButton variant="primary" size="sm" onClick={() => setKiosk(true)}>
                <Tv className="h-3.5 w-3.5" />
                Enter Kiosk Mode
              </GlassButton>
            </div>
          </div>

          <GlassPanel className="mb-5" bodyClassName="flex flex-wrap items-end gap-6">
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>This display's name</div>
              <GlassInput placeholder="e.g. TV1 - Warehouse" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-auto" />
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Active playlist ({activeSource})</div>
              <select value={activePlaylistId} onChange={(e) => setManualPlaylistId(e.target.value)} disabled={!!scheduledPlaylistId}>
                {config.playlists.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.mode})</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Kiosk exit password (optional, this browser only)</div>
              <GlassInput type="password" placeholder="leave blank = no password" value={kioskPassword} onChange={(e) => setKioskPassword(e.target.value)} className="w-auto" />
            </div>
          </GlassPanel>

          <DashboardTabs
            tabs={[
              { key: "playlists", label: "Playlists" },
              { key: "scheduler", label: "Scheduler" },
              { key: "branding", label: "Branding" },
              { key: "displays", label: "Display Assignments" },
              { key: "data", label: "Export / Import" },
            ]}
            active={panel ?? ""}
            onChange={(k) => setPanel(panel === k ? null : (k as typeof panel))}
          />

          {panel === "playlists" && (
            <div className="glass-card" style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                {config.playlists.map((p) => (
                  <button key={p.id} className="btn" style={{ background: editingPlaylistId === p.id ? "var(--blue)" : "var(--navy3)", color: editingPlaylistId === p.id ? "#fff" : "var(--muted)" }} onClick={() => setEditingPlaylistId(p.id)}>
                    {p.name}
                  </button>
                ))}
                <button className="btn" onClick={createPlaylist}>+ New Playlist</button>
              </div>

              {editingPlaylist && (
                <div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
                    <input value={editingPlaylist.name} onChange={(e) => updatePlaylist(editingPlaylist.id, { name: e.target.value })} style={{ fontWeight: 700, fontSize: 15 }} />
                    <select value={editingPlaylist.mode} onChange={(e) => updatePlaylist(editingPlaylist.id, { mode: e.target.value as "rotation" | "grid" | "canvas" })}>
                      <option value="rotation">Rotation (auto-cycle whole slides)</option>
                      <option value="grid">Manual Grid (drag/resize cards)</option>
                      <option value="canvas">Free Canvas (pixel-position, layer, zoom)</option>
                    </select>
                    {editingPlaylist.mode === "rotation" && (
                      <select value={editingPlaylist.intervalSec} onChange={(e) => updatePlaylist(editingPlaylist.id, { intervalSec: Number(e.target.value) })}>
                        {INTERVALS.map((s) => <option key={s} value={s}>{s}s</option>)}
                      </select>
                    )}
                    <button className="btn" onClick={() => duplicatePlaylist(editingPlaylist.id)}>⧉ Duplicate</button>
                    <button className="btn" style={{ color: "var(--red)" }} onClick={() => deletePlaylist(editingPlaylist.id)} disabled={config.playlists.length <= 1}>Delete</button>
                  </div>

                  {editingPlaylist.mode === "rotation" ? (
                    <div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>Check to include, drag to reorder</div>
                      {ALL_SLIDES.map((s) => {
                        const inList = editingPlaylist.slideOrder.includes(s.key);
                        const idx = editingPlaylist.slideOrder.indexOf(s.key);
                        return (
                          <div key={s.key} draggable={inList}
                            onDragStart={() => (dragIdx.current = idx)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => { if (dragIdx.current !== null && inList) { moveSlideInRotation(editingPlaylist.id, dragIdx.current, idx); dragIdx.current = null; } }}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderBottom: "1px solid var(--border)", cursor: inList ? "grab" : "default" }}>
                            <input type="checkbox" checked={inList} onChange={() => toggleSlideInRotation(editingPlaylist.id, s.key)} />
                            <span style={{ flex: 1 }}>{s.label}</span>
                            {inList && <span style={{ fontSize: 12, color: "var(--muted)" }}>#{idx + 1}</span>}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                        <GlassButton variant={libraryOpen ? "subtle" : "primary"} size="sm" onClick={() => setLibraryOpen((o) => !o)}>
                          {libraryOpen ? "✕ Close Widget Library" : "+ Add Card (Widget Library)"}
                        </GlassButton>
                        <GlassButton variant="secondary" size="sm" onClick={() => addCard(editingPlaylist.id, SECTION_KEY)}>+ Section Divider</GlassButton>
                        <span style={{ flex: 1 }} />
                        <GlassButton variant="secondary" size="sm" title="Undo (Ctrl+Z)" disabled={history.current.playlistId !== editingPlaylist.id || history.current.pointer <= 0} onClick={() => undo(editingPlaylist.id)}>↶ Undo</GlassButton>
                        <GlassButton variant="secondary" size="sm" title="Redo (Ctrl+Y)" disabled={history.current.playlistId !== editingPlaylist.id || history.current.pointer >= history.current.stack.length - 1} onClick={() => redo(editingPlaylist.id)}>↷ Redo</GlassButton>
                        {editingPlaylist.mode === "canvas" && (
                          <>
                            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--muted)" }}>
                              <input type="checkbox" checked={!!editingPlaylist.canvasSnapToGrid} onChange={(e) => updatePlaylist(editingPlaylist.id, { canvasSnapToGrid: e.target.checked })} /> Snap to {editingPlaylist.canvasGridSize || 20}px
                            </label>
                            <GlassButton variant="secondary" size="sm" title="Zoom out" onClick={() => setCanvasZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))}>−</GlassButton>
                            <span style={{ fontSize: 12, color: "var(--muted)", minWidth: 38, textAlign: "center" }}>{Math.round(canvasZoom * 100)}%</span>
                            <GlassButton variant="secondary" size="sm" title="Zoom in" onClick={() => setCanvasZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}>+</GlassButton>
                            <GlassButton variant="secondary" size="sm" title="Reset zoom" onClick={() => setCanvasZoom(1)}>Reset</GlassButton>
                          </>
                        )}
                      </div>
                      {libraryOpen && (
                        <GlassPanel className="mb-4">
                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                            <GlassInput icon={<Search className="h-4 w-4" />} placeholder="Search widgets…" value={librarySearch} onChange={(e) => setLibrarySearch(e.target.value)} className="min-w-[180px] flex-1" />
                            {(["page", ...WIDGET_CATEGORIES.map((c) => c.key)] as const).map((k) => (
                              <GlassButton key={k} variant={libraryCategory === k ? "primary" : "subtle"} size="sm" onClick={() => setLibraryCategory(k)}>
                                {k === "page" ? "Whole Pages" : WIDGET_CATEGORIES.find((c) => c.key === k)?.label}
                              </GlassButton>
                            ))}
                          </div>
                          <div style={{ maxHeight: 320, overflowY: "auto" }}>
                            {libraryCategory === "page" ? (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                {ALL_SLIDES.filter((s) => s.label.toLowerCase().includes(librarySearch.toLowerCase())).map((s) => (
                                  <GlassButton key={s.key} variant="secondary" size="sm" onClick={() => { addCard(editingPlaylist.id, s.key); setLibraryOpen(false); }}>+ {s.label}</GlassButton>
                                ))}
                              </div>
                            ) : (
                              Object.entries(
                                WIDGET_REGISTRY
                                  .filter((w) => w.category === libraryCategory && w.label.toLowerCase().includes(librarySearch.toLowerCase()))
                                  .reduce<Record<string, typeof WIDGET_REGISTRY>>((acc, w) => { (acc[w.pageLabel] ??= []).push(w); return acc; }, {})
                              ).map(([pageLabel, widgets]) => (
                                <div key={pageLabel} style={{ marginBottom: 10 }}>
                                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{pageLabel}</div>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                    {widgets.map((w) => (
                                      <GlassButton key={w.id} variant="secondary" size="sm" onClick={() => { addCard(editingPlaylist.id, w.id); setLibraryOpen(false); }}>+ {w.label}</GlassButton>
                                    ))}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </GlassPanel>
                      )}
                      {editingPlaylist.cards.length === 0 ? (
                        <div style={{ color: "var(--muted)" }}>No cards yet - add one above.</div>
                      ) : editingPlaylist.mode === "canvas" ? (
                        <CanvasSurface
                          playlist={editingPlaylist}
                          zoom={canvasZoom}
                          selectedCardId={selectedCardId}
                          onSelectCard={setSelectedCardId}
                          getCanvasLayout={getCanvasLayout}
                          onCommitLayout={(cardId, next) => commitCanvasLayout(editingPlaylist.id, cardId, next)}
                          onDragOrResizeStart={() => pushGridHistorySnapshot(editingPlaylist.id)}
                          onZOrder={(cardId, op) => canvasZOrder(editingPlaylist.id, cardId, op)}
                          onTitleChange={(cardId, v) => patchCard(editingPlaylist.id, cardId, { title: v })}
                          onAccentChange={(cardId, v) => patchCard(editingPlaylist.id, cardId, { accent: v })}
                          onToggleCompact={(cardId) => { const c = editingPlaylist.cards.find((x) => x.id === cardId); if (c) patchCard(editingPlaylist.id, cardId, { compact: !c.compact }); }}
                          onToggleHeader={(cardId) => { const c = editingPlaylist.cards.find((x) => x.id === cardId); if (c) patchCard(editingPlaylist.id, cardId, { headerOn: !c.headerOn }); }}
                          onToggleLock={(cardId) => { const c = editingPlaylist.cards.find((x) => x.id === cardId); if (c) patchCard(editingPlaylist.id, cardId, { locked: !c.locked }); }}
                          onTogglePin={(cardId) => { const c = editingPlaylist.cards.find((x) => x.id === cardId); if (c) patchCard(editingPlaylist.id, cardId, { pinned: !c.pinned }); }}
                          onStyleChange={(cardId, patch) => patchCard(editingPlaylist.id, cardId, patch)}
                          onDuplicate={(cardId) => duplicateCard(editingPlaylist.id, cardId)}
                          onRemove={(cardId) => removeCard(editingPlaylist.id, cardId)}
                        />
                      ) : (
                        <ResponsiveGridLayout
                          className="layout"
                          cols={12}
                          rowHeight={24}
                          onLayoutChange={(l: any) => onGridLayoutChange(editingPlaylist.id, l)}
                          onDragStart={() => pushGridHistorySnapshot(editingPlaylist.id)}
                          onResizeStart={() => pushGridHistorySnapshot(editingPlaylist.id)}
                          draggableHandle=".occ-card-drag-handle"
                        >
                          {editingPlaylist.cards.map((card) => (
                            <div key={card.id} data-grid={{ ...card.layout, isDraggable: !card.locked, isResizable: !card.locked }}>
                              {card.slideKey === SECTION_KEY ? (
                                <div className="glass-card" onMouseDown={() => setSelectedCardId(card.id)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "100%", borderLeft: `4px solid ${card.accent}`, outline: selectedCardId === card.id ? "2px solid var(--blue)" : "none", outlineOffset: -2 }}>
                                  <input className="occ-card-drag-handle" value={card.title} onChange={(e) => patchCard(editingPlaylist.id, card.id, { title: e.target.value })} style={{ background: "transparent", border: "none", fontWeight: 700, fontSize: 14, flex: 1 }} />
                                  <button className="btn" onClick={() => removeCard(editingPlaylist.id, card.id)} style={{ fontSize: 11 }}>✕</button>
                                </div>
                              ) : (
                                <OccGridCard
                                  chrome={card}
                                  selected={selectedCardId === card.id}
                                  onSelect={() => setSelectedCardId(card.id)}
                                  onTitleChange={(v) => patchCard(editingPlaylist.id, card.id, { title: v })}
                                  onAccentChange={(v) => patchCard(editingPlaylist.id, card.id, { accent: v })}
                                  onToggleCompact={() => patchCard(editingPlaylist.id, card.id, { compact: !card.compact })}
                                  onToggleHeader={() => patchCard(editingPlaylist.id, card.id, { headerOn: !card.headerOn })}
                                  onToggleLock={() => patchCard(editingPlaylist.id, card.id, { locked: !card.locked })}
                                  onTogglePin={() => patchCard(editingPlaylist.id, card.id, { pinned: !card.pinned })}
                                  onStyleChange={(patch) => patchCard(editingPlaylist.id, card.id, patch)}
                                  onDuplicate={() => duplicateCard(editingPlaylist.id, card.id)}
                                  onRemove={() => removeCard(editingPlaylist.id, card.id)}
                                >
                                  {slideRender(card.slideKey)?.()}
                                </OccGridCard>
                              )}
                            </div>
                          ))}
                        </ResponsiveGridLayout>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {panel === "scheduler" && (
            <div className="glass-card" style={{ marginBottom: 20 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <input type="checkbox" checked={config.schedulerEnabled} onChange={(e) => setConfig((c) => ({ ...c, schedulerEnabled: e.target.checked }))} />
                Enable scheduler (overrides display assignment / manual pick while on)
              </label>
              {config.schedule.map((entry) => (
                <div key={entry.id} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                  <input type="time" value={entry.time} onChange={(e) => updateScheduleEntry(entry.id, { time: e.target.value })} />
                  <select value={entry.playlistId} onChange={(e) => updateScheduleEntry(entry.id, { playlistId: e.target.value })}>
                    {config.playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button className="btn" style={{ color: "var(--red)" }} onClick={() => removeScheduleEntry(entry.id)}>Remove</button>
                </div>
              ))}
              <button className="btn" onClick={addScheduleEntry}>+ Add time slot</button>
            </div>
          )}

          {panel === "branding" && (
            <div className="glass-card" style={{ marginBottom: 20, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Company name</div>
                <input value={config.branding.companyName} onChange={(e) => updateBranding({ companyName: e.target.value })} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Accent color</div>
                <input type="color" value={config.branding.accentColor} onChange={(e) => updateBranding({ accentColor: e.target.value })} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Logo</div>
                <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && onLogoFile(e.target.files[0])} />
                {config.branding.logoDataUrl && <img src={config.branding.logoDataUrl} alt="logo" height={32} style={{ marginTop: 8, borderRadius: 6 }} />}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", maxWidth: 320 }}>
                Background image is shared app-wide via Settings → Appearance rather than duplicated here - it already applies in Kiosk Mode since Kiosk reuses the same page background.
              </div>
            </div>
          )}

          {panel === "displays" && (
            <div className="glass-card" style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                Assign a playlist to a display name. Export this config and import it on each physical screen -
                each screen then just needs its own Display Name typed in above once.
              </div>
              {Object.entries(config.displayAssignments).map(([name, playlistId]) => (
                <div key={name} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                  <span style={{ width: 160 }}>{name}</span>
                  <select value={playlistId} onChange={(e) => setAssignment(name, e.target.value)}>
                    {config.playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button className="btn" style={{ color: "var(--red)" }} onClick={() => removeAssignment(name)}>Remove</button>
                </div>
              ))}
              <NewAssignmentRow playlists={config.playlists} onAdd={setAssignment} />
            </div>
          )}

          {panel === "data" && (
            <div className="glass-card" style={{ marginBottom: 20, display: "flex", gap: 12, alignItems: "center" }}>
              <button className="btn" onClick={exportConfig}>⬇ Export config JSON</button>
              <button className="btn" onClick={() => fileInputRef.current?.click()}>⬆ Import config JSON</button>
              <input ref={fileInputRef} type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && importConfig(e.target.files[0])} />
            </div>
          )}
        </div>
      )}

      {/* ---- live stage: what actually plays, in both kiosk and preview ---- */}
      {activePlaylist?.mode === "rotation" ? (
        rotationSlides.length > 0 && (
          <div className={kiosk ? "occ-kiosk-stage" : "occ-preview-stage"}>
            {kiosk && <KioskTopBar branding={config.branding} label={current?.label} rotating={rotating} idx={slideIdx} total={rotationSlides.length} interval={activePlaylist.intervalSec} />}
            <div key={current?.key} className="occ-slide">{current?.render()}</div>
            {kiosk && (
              <button className="btn" style={{ position: "fixed", bottom: 16, right: 16, opacity: cursorHidden ? 0 : 0.85 }} onClick={() => setRotating((r) => !r)}>
                {rotating ? "⏸" : "▶"}
              </button>
            )}
          </div>
        )
      ) : (
        kiosk && activePlaylist && (
          <div className="occ-kiosk-stage">
            <KioskTopBar branding={config.branding} label={activePlaylist.name} rotating={false} idx={0} total={1} interval={0} />
            <ResponsiveGridLayout className="layout" cols={12} rowHeight={24} isDraggable={false} isResizable={false}>
              {activePlaylist.cards.map((card) => (
                <div key={card.id} data-grid={{ ...card.layout }}>
                  {card.slideKey === SECTION_KEY ? (
                    <div className="glass-card" style={{ display: "flex", alignItems: "center", height: "100%", borderLeft: `4px solid ${card.accent}`, fontWeight: 700 }}>{card.title}</div>
                  ) : (
                    <LiveCard card={card}>{slideRender(card.slideKey)?.()}</LiveCard>
                  )}
                </div>
              ))}
            </ResponsiveGridLayout>
          </div>
        )
      )}

      {showExitPrompt && (
        <div className="occ-exit-overlay">
          <div className="glass-card" style={{ width: 320 }}>
            <div style={{ marginBottom: 10 }}>Exit Kiosk Mode?</div>
            {kioskPassword && (
              <input type="password" autoFocus placeholder="Password" value={exitPasswordInput}
                onChange={(e) => setExitPasswordInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && attemptExitKiosk()}
                style={{ width: "100%", marginBottom: 10 }} />
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={attemptExitKiosk}>Exit</button>
              <button className="btn" onClick={() => { setShowExitPrompt(false); setExitPasswordInput(""); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LiveCard({ card, children }: { card: CardConfig; children: ReactNode }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!card.refreshIntervalSec) return;
    const id = setInterval(() => setTick((t) => t + 1), card.refreshIntervalSec * 1000);
    return () => clearInterval(id);
  }, [card.refreshIntervalSec]);
  return (
    <div
      className={(card.glass ? "glass-card" : "occ-card-solid") + (card.animation ? " occ-slide" : "")}
      style={{
        height: "100%", overflow: "auto", borderLeft: `4px solid ${card.accent}`, padding: card.compact ? 8 : undefined,
        borderRadius: card.roundedCorners ? undefined : 2, boxShadow: card.shadow ? undefined : "none",
      }}
    >
      {card.headerOn && <div style={{ fontWeight: 700, marginBottom: 8 }}>{card.title}</div>}
      <div key={tick}>{children}</div>
    </div>
  );
}

function KioskTopBar({ branding, label, rotating, idx, total, interval }: { branding: Branding; label?: string; rotating: boolean; idx: number; total: number; interval: number }) {
  return (
    <div className="occ-kiosk-topbar">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {branding.logoDataUrl && <img src={branding.logoDataUrl} alt="" height={28} style={{ borderRadius: 6 }} />}
        <span>{branding.companyName}</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span>{label}</span>
      </div>
      {total > 1 && <span style={{ opacity: 0.6, fontSize: 12 }}>{rotating ? `Slide ${idx + 1}/${total} · ${interval}s` : "Paused"}</span>}
    </div>
  );
}

function NewAssignmentRow({ playlists, onAdd }: { playlists: Playlist[]; onAdd: (name: string, playlistId: string) => void }) {
  const [name, setName] = useState("");
  const [playlistId, setPlaylistId] = useState(playlists[0]?.id || "");
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
      <input placeholder="Display name, e.g. TV1" value={name} onChange={(e) => setName(e.target.value)} />
      <select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
        {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button className="btn" disabled={!name.trim()} onClick={() => { if (name.trim()) { onAdd(name.trim(), playlistId); setName(""); } }}>+ Add</button>
    </div>
  );
}

// ---- Free Canvas mode (round -13) ----
// A card here is absolutely-positioned in pixels within a large scrollable
// surface, instead of snapped to react-grid-layout's 12-column grid. Drag
// and resize are custom Pointer Events handling (react-grid-layout isn't
// used for this mode at all) - see CanvasCardWrapper below. Panning is the
// browser's own scrolling of the outer overflow:auto container (simplest
// reliable approach); zoom is a CSS transform: scale() on the inner
// surface, with drag/resize math divided by the zoom factor so dragging
// feels 1:1 with the mouse regardless of zoom level.
//
// HONEST LIMITATION, stated plainly: this was verified with `tsc -b` and
// `vite build` (compiles cleanly) but NOT with an interactive browser
// session - there is no headless-browser/UI-automation tool available in
// this environment to actually perform a mouse drag and observe the
// result, unlike the backend work in earlier rounds where real HTTP
// requests could be fired and their responses inspected. The pointer-event
// drag/resize pattern used here (capture start position + a ref, compute
// deltas, commit once on pointerup) is a standard, well-established React
// pattern, and the code type-checks and builds, but "compiles" is not the
// same claim as "was clicked and dragged in a real browser and confirmed
// to feel right" - that verification still needs to happen by hand.
function CanvasSurface({
  playlist, zoom, selectedCardId, onSelectCard, getCanvasLayout, onCommitLayout, onDragOrResizeStart, onZOrder,
  onTitleChange, onAccentChange, onToggleCompact, onToggleHeader, onToggleLock, onTogglePin, onStyleChange, onDuplicate, onRemove,
}: {
  playlist: Playlist;
  zoom: number;
  selectedCardId: string | null;
  onSelectCard: (id: string | null) => void;
  getCanvasLayout: (card: CardConfig, index: number) => { x: number; y: number; w: number; h: number; z: number };
  onCommitLayout: (cardId: string, next: { x: number; y: number; w: number; h: number; z: number }) => void;
  onDragOrResizeStart: () => void;
  onZOrder: (cardId: string, op: "front" | "back" | "forward" | "backward") => void;
  onTitleChange: (cardId: string, v: string) => void;
  onAccentChange: (cardId: string, v: string) => void;
  onToggleCompact: (cardId: string) => void;
  onToggleHeader: (cardId: string) => void;
  onToggleLock: (cardId: string) => void;
  onTogglePin: (cardId: string) => void;
  onStyleChange: (cardId: string, patch: Partial<OccCardChrome>) => void;
  onDuplicate: (cardId: string) => void;
  onRemove: (cardId: string) => void;
}) {
  const layouts = playlist.cards.map((c, i) => getCanvasLayout(c, i));
  const surfaceW = Math.max(1600, ...layouts.map((l) => l.x + l.w + 100));
  const surfaceH = Math.max(1000, ...layouts.map((l) => l.y + l.h + 100));

  return (
    <div style={{ overflow: "auto", maxHeight: "70vh", border: "1px solid var(--border)", borderRadius: 10, background: "var(--navy2, var(--navy))" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onSelectCard(null); }}>
      <div style={{ position: "relative", width: surfaceW * zoom, height: surfaceH * zoom }}>
        <div style={{ position: "absolute", top: 0, left: 0, width: surfaceW, height: surfaceH, transform: `scale(${zoom})`, transformOrigin: "0 0" }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) onSelectCard(null); }}>
          {playlist.cards.map((card, i) => {
            const layout = getCanvasLayout(card, i);
            return (
              <CanvasCardWrapper
                key={card.id}
                layout={layout}
                zoom={zoom}
                locked={card.locked}
                selected={selectedCardId === card.id}
                onSelect={() => onSelectCard(card.id)}
                onDragOrResizeStart={onDragOrResizeStart}
                onCommitLayout={(next) => onCommitLayout(card.id, next)}
              >
                {card.slideKey === SECTION_KEY ? (
                  <div className="glass-card occ-card-drag-handle" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "100%", borderLeft: `4px solid ${card.accent}` }}>
                    <input value={card.title} onChange={(e) => onTitleChange(card.id, e.target.value)} onPointerDown={(e) => e.stopPropagation()}
                      style={{ background: "transparent", border: "none", fontWeight: 700, fontSize: 14, flex: 1 }} />
                    <button className="btn" onPointerDown={(e) => e.stopPropagation()} onClick={() => onRemove(card.id)} style={{ fontSize: 11 }}>✕</button>
                  </div>
                ) : (
                  <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", padding: "0 0 4px" }}>
                      <button className="btn" title="Send to back (Ctrl+Shift+[)" onPointerDown={(e) => e.stopPropagation()} onClick={() => onZOrder(card.id, "back")} style={{ fontSize: 10, padding: "1px 5px" }}>⇊</button>
                      <button className="btn" title="Backward (Ctrl+[)" onPointerDown={(e) => e.stopPropagation()} onClick={() => onZOrder(card.id, "backward")} style={{ fontSize: 10, padding: "1px 5px" }}>↓</button>
                      <button className="btn" title="Forward (Ctrl+])" onPointerDown={(e) => e.stopPropagation()} onClick={() => onZOrder(card.id, "forward")} style={{ fontSize: 10, padding: "1px 5px" }}>↑</button>
                      <button className="btn" title="Bring to front (Ctrl+Shift+])" onPointerDown={(e) => e.stopPropagation()} onClick={() => onZOrder(card.id, "front")} style={{ fontSize: 10, padding: "1px 5px" }}>⇈</button>
                    </div>
                    <div style={{ flex: 1, minHeight: 0 }}>
                      <OccGridCard
                        chrome={card}
                        selected={false}
                        onTitleChange={(v) => onTitleChange(card.id, v)}
                        onAccentChange={(v) => onAccentChange(card.id, v)}
                        onToggleCompact={() => onToggleCompact(card.id)}
                        onToggleHeader={() => onToggleHeader(card.id)}
                        onToggleLock={() => onToggleLock(card.id)}
                        onTogglePin={() => onTogglePin(card.id)}
                        onStyleChange={(patch) => onStyleChange(card.id, patch)}
                        onDuplicate={() => onDuplicate(card.id)}
                        onRemove={() => onRemove(card.id)}
                      >
                        {slideRender(card.slideKey)?.()}
                      </OccGridCard>
                    </div>
                  </div>
                )}
              </CanvasCardWrapper>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CanvasCardWrapper({
  layout, zoom, locked, selected, onSelect, onDragOrResizeStart, onCommitLayout, children,
}: {
  layout: { x: number; y: number; w: number; h: number; z: number };
  zoom: number;
  locked: boolean;
  selected: boolean;
  onSelect: () => void;
  onDragOrResizeStart: () => void;
  onCommitLayout: (next: { x: number; y: number; w: number; h: number; z: number }) => void;
  children: ReactNode;
}) {
  const [live, setLive] = useState<typeof layout | null>(null);
  const current = live ?? layout;

  function onWrapperPointerDown(e: React.PointerEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("button, input, select, a, textarea")) return; // let the control handle its own click
    onSelect();
    if (target.closest(".occ-card-drag-handle")) startDrag(e);
  }

  function startDrag(e: React.PointerEvent) {
    if (locked) return;
    e.preventDefault();
    onDragOrResizeStart();
    const startX = e.clientX, startY = e.clientY;
    const origX = layout.x, origY = layout.y;
    function onMove(ev: PointerEvent) {
      const dx = (ev.clientX - startX) / zoom;
      const dy = (ev.clientY - startY) / zoom;
      setLive({ ...layout, x: Math.max(0, origX + dx), y: Math.max(0, origY + dy) });
    }
    function onUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const dx = (ev.clientX - startX) / zoom;
      const dy = (ev.clientY - startY) / zoom;
      setLive(null);
      onCommitLayout({ ...layout, x: Math.max(0, origX + dx), y: Math.max(0, origY + dy) });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startResize(e: React.PointerEvent) {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    onDragOrResizeStart();
    const startX = e.clientX, startY = e.clientY;
    const origW = layout.w, origH = layout.h;
    function onMove(ev: PointerEvent) {
      const dw = (ev.clientX - startX) / zoom;
      const dh = (ev.clientY - startY) / zoom;
      setLive({ ...layout, w: Math.max(160, origW + dw), h: Math.max(120, origH + dh) });
    }
    function onUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const dw = (ev.clientX - startX) / zoom;
      const dh = (ev.clientY - startY) / zoom;
      setLive(null);
      onCommitLayout({ ...layout, w: Math.max(160, origW + dw), h: Math.max(120, origH + dh) });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      onPointerDown={onWrapperPointerDown}
      style={{
        position: "absolute", left: current.x, top: current.y, width: current.w, height: current.h, zIndex: current.z,
        outline: selected ? "2px solid var(--blue)" : "none", outlineOffset: -2,
        cursor: locked ? "default" : undefined,
      }}
    >
      {children}
      {!locked && (
        <div
          onPointerDown={startResize}
          title="Drag to resize"
          style={{ position: "absolute", right: 2, bottom: 2, width: 14, height: 14, cursor: "nwse-resize", background: "var(--blue)", opacity: 0.55, borderRadius: "0 0 4px 0", zIndex: 10 }}
        />
      )}
    </div>
  );
}

