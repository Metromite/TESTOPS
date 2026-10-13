import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { ThemeName, applyThemeToDocument } from "./tokens";
import { getAppearanceConfig, getWallpaperUrl } from "../services/wallpaper";
import { supabase } from "../lib/supabase";

type Mode = ThemeName | "auto";

interface ThemeCtx {
  mode: Mode;
  resolvedTheme: ThemeName;
  setMode: (m: Mode) => void;
  refreshBackground: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

function resolveAuto(): ThemeName {
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

/** Wallpaper now comes from the shared `appearance_config` row + the
 * private `wallpaper` Storage bucket (src/services/wallpaper.ts) instead
 * of the old /api/appearance REST endpoint — this is genuinely wired to
 * Supabase, not a stub. Every open DispatchOPS window updates its
 * background automatically because appearance_config is a Realtime
 * table (see supabase/migrations/0004) and ProtectedLayout/wherever
 * wallpaper is changed calls refreshBackground() below. Fails silently
 * to the default gradient on any error (offline, no wallpaper set yet,
 * etc.) — matching the "app must always render" principle. */
async function applyBackground(theme: ThemeName) {
  const body = document.body;
  try {
    const config = await getAppearanceConfig();
    const path = theme === "dark" ? config?.dark_bg_path : config?.light_bg_path;
    const url = path ? await getWallpaperUrl(path) : null;
    if (url) {
      body.style.setProperty("--dispatchops-wallpaper", `url("${url}")`);
      body.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.15), rgba(0,0,0,0.15)), url("${url}")`;
      body.style.backgroundSize = "cover";
      body.style.backgroundPosition = "center";
      body.style.backgroundAttachment = "fixed";
      body.classList.add("custom-bg");
      return;
    }
  } catch {
    // no custom background configured / Supabase temporarily unreachable - fall through to default gradient
  }
  body.style.backgroundImage = "";
  body.style.removeProperty("--dispatchops-wallpaper");
  body.classList.remove("custom-bg");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Default to Light. Preserve an explicit saved Dark/High Contrast choice,
  // but do not let the system color scheme silently make a new session dark.
  const [mode, setModeState] = useState<Mode>(() => {
    const saved = localStorage.getItem("theme-mode") as Mode | null;
    return saved === "dark" || saved === "high_contrast" || saved === "light" ? saved : "light";
  });
  const [resolvedTheme, setResolvedTheme] = useState<ThemeName>(() => {
    const saved = localStorage.getItem("theme-mode") as Mode | null;
    return saved === "dark" || saved === "high_contrast" || saved === "light" ? saved : "light";
  });

  // Cache both wallpapers once. Theme switching itself must never wait for
  // Supabase/network work; the visual theme is applied synchronously and a
  // background URL is swapped only when its cached value is available.
  const wallpaperCache = useRef<Record<ThemeName, string | null>>({ dark: null, light: null, high_contrast: null });
  const wallpaperLoaded = useRef(false);

  const setWallpaper = (url: string | null) => {
    const img = document.querySelector<HTMLImageElement>(".dispatchops-initial-wallpaper");
    if (url) {
      document.body.style.setProperty("--dispatchops-wallpaper", `url("${url}")`);
      document.body.style.backgroundImage = "none";
      document.body.style.backgroundSize = "auto";
      document.body.style.backgroundPosition = "initial";
      document.body.style.backgroundAttachment = "initial";
      document.body.classList.add("custom-bg");
      if (img && img.src !== url) {
        const swap = new Image();
        swap.decoding = "async";
        swap.fetchPriority = "high";
        swap.onload = () => { img.src = url; };
        swap.src = url;
      } else if (!img) {
        const early = document.createElement("img");
        early.src = url;
        early.alt = "";
        early.setAttribute("aria-hidden", "true");
        early.decoding = "async";
        early.fetchPriority = "high";
        early.className = "dispatchops-initial-wallpaper";
        document.body.appendChild(early);
      }
    } else {
      document.body.style.backgroundImage = "";
      document.body.style.removeProperty("--dispatchops-wallpaper");
      document.body.classList.remove("custom-bg");
      if (img) img.remove();
    }
  };

  const setWallpaperPair = (darkUrl: string | null, lightUrl: string | null) => {
    const root = document.documentElement;
    root.style.setProperty("--dispatchops-wallpaper-dark", darkUrl ? `url("${darkUrl}")` : "none");
    root.style.setProperty("--dispatchops-wallpaper-light", lightUrl ? `url("${lightUrl}")` : "none");
    document.body.classList.toggle("custom-bg", Boolean(darkUrl || lightUrl));
  };

  const loadWallpapers = async () => {
    const cacheKey = "dispatchops-wallpaper-cache-v1";
    const now = Date.now();
    try {
      const saved = JSON.parse(localStorage.getItem(cacheKey) || "{}");
      for (const theme of ["dark", "light"] as ThemeName[]) {
        const hit = saved?.[theme];
        if (hit?.url) wallpaperCache.current[theme] = hit.url;
      }
      const current = resolvedTheme === "high_contrast" ? "light" : resolvedTheme;
      setWallpaperPair(wallpaperCache.current.dark, wallpaperCache.current.light);
      if (wallpaperCache.current[current]) setWallpaper(wallpaperCache.current[current]);
    } catch {}
    if (wallpaperLoaded.current) return;
    wallpaperLoaded.current = true;
    try {
      const config = await getAppearanceConfig();
      const themes = ["dark", "light"] as ThemeName[];
      const urls = await Promise.all(themes.map(async (theme) => {
        const path = theme === "dark" ? config?.dark_bg_path : config?.light_bg_path;
        return path ? await getWallpaperUrl(path) : null;
      }));
      const saved:any = {};
      themes.forEach((theme, i) => {
        const url = urls[i];
        wallpaperCache.current[theme] = url;
        if (url) saved[theme] = { url, expiresAt: Date.now() + 50 * 60_000 };
      });
      try { localStorage.setItem(cacheKey, JSON.stringify(saved)); } catch {}
      setWallpaperPair(wallpaperCache.current.dark, wallpaperCache.current.light);
      const current = resolvedTheme === "high_contrast" ? "light" : resolvedTheme;
      setWallpaper(wallpaperCache.current[current]);
    } catch {
      wallpaperLoaded.current = false;
    }
  };

  const applyResolvedTheme = (theme: ThemeName) => {
    // Do not transition layout/filter/backdrop properties. Only paint tokens
    // are transitioned, preventing theme-switch reflow and expensive blur
    // recalculation from blocking the interaction.
    document.documentElement.classList.add("theme-transition");
    applyThemeToDocument(theme);
    setResolvedTheme(theme);
    const wallpaperTheme = theme === "high_contrast" ? "light" : theme;
    document.body.style.setProperty("--dispatchops-wallpaper-overlay", theme === "dark" || theme === "high_contrast"
      ? "linear-gradient(180deg, rgba(4,12,22,.22), rgba(4,12,22,.34))"
      : "linear-gradient(180deg, rgba(255,255,255,.08), rgba(4,12,22,.16))");
    setWallpaperPair(wallpaperCache.current.dark, wallpaperCache.current.light);
    const cached = wallpaperCache.current[wallpaperTheme];
    if (cached !== null || wallpaperLoaded.current) setWallpaper(cached);
    window.setTimeout(() => document.documentElement.classList.remove("theme-transition"), 180);
  };

  useEffect(() => {
    applyResolvedTheme(mode === "auto" ? resolveAuto() : (mode as ThemeName));
    localStorage.setItem("theme-mode", mode);
    void loadWallpapers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    const channel = supabase.channel("dispatchops-appearance-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "appearance_config" }, () => {
        wallpaperLoaded.current = false;
        void loadWallpapers();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyResolvedTheme(resolveAuto());
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const setMode = (m: Mode) => setModeState(m);
  const refreshBackground = () => {
    wallpaperLoaded.current = false;
    void loadWallpapers();
  };

  return <Ctx.Provider value={{ mode, resolvedTheme, setMode, refreshBackground }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
