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
  const [mode, setModeState] = useState<Mode>(() => (localStorage.getItem("theme-mode") as Mode) || "auto");
  const [resolvedTheme, setResolvedTheme] = useState<ThemeName>(() => {
    const initialMode = (localStorage.getItem("theme-mode") as Mode) || "auto";
    return initialMode === "auto" ? resolveAuto() : (initialMode as ThemeName);
  });

  // Cache both wallpapers once. Theme switching itself must never wait for
  // Supabase/network work; the visual theme is applied synchronously and a
  // background URL is swapped only when its cached value is available.
  const wallpaperCache = useRef<Record<ThemeName, string | null>>({ dark: null, light: null, high_contrast: null });
  const wallpaperLoaded = useRef(false);

  const setWallpaper = (url: string | null) => {
    if (url) {
      document.body.style.setProperty("--dispatchops-wallpaper", `url("${url}")`);
      document.body.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.15), rgba(0,0,0,0.15)), url("${url}")`;
      document.body.style.backgroundSize = "cover";
      document.body.style.backgroundPosition = "center";
      document.body.style.backgroundAttachment = "fixed";
      document.body.classList.add("custom-bg");
    } else {
      document.body.style.backgroundImage = "";
      document.body.style.removeProperty("--dispatchops-wallpaper");
      document.body.classList.remove("custom-bg");
    }
  };

  const loadWallpapers = async () => {
    if (wallpaperLoaded.current) return;
    wallpaperLoaded.current = true;
    try {
      const config = await getAppearanceConfig();
      for (const theme of ["dark", "light"] as ThemeName[]) {
        const path = theme === "dark" ? config?.dark_bg_path : config?.light_bg_path;
        wallpaperCache.current[theme] = path ? await getWallpaperUrl(path) : null;
      }
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
