import { createContext, useContext, useEffect, useState, ReactNode } from "react";
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
      body.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.15), rgba(0,0,0,0.15)), url('${url}')`;
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
  body.classList.remove("custom-bg");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(() => (localStorage.getItem("theme-mode") as Mode) || "auto");
  const [resolvedTheme, setResolvedTheme] = useState<ThemeName>(mode === "auto" ? resolveAuto() : (mode as ThemeName));

  useEffect(() => {
    const theme = mode === "auto" ? resolveAuto() : (mode as ThemeName);
    setResolvedTheme(theme);
    applyThemeToDocument(theme);
    applyBackground(theme);
    localStorage.setItem("theme-mode", mode);
  }, [mode]);

  useEffect(() => {
    // Shared live wallpaper: when an Admin uploads a new light/dark image,
    // every open DispatchOPS window reloads the shared setting immediately.
    const channel = supabase.channel("dispatchops-appearance-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "appearance_config" }, () => {
        applyBackground(resolvedTheme);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [resolvedTheme]);

  useEffect(() => {
    if (mode !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => {
      const theme = resolveAuto();
      setResolvedTheme(theme);
      applyThemeToDocument(theme);
      applyBackground(theme);
    };
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, [mode]);

  const setMode = (m: Mode) => setModeState(m);
  const refreshBackground = () => applyBackground(resolvedTheme);

  return <Ctx.Provider value={{ mode, resolvedTheme, setMode, refreshBackground }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
