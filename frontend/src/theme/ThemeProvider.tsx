import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { ThemeName, applyThemeToDocument } from "./tokens";

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

async function applyBackground(theme: ThemeName) {
  const body = document.body;
  try {
    const res = await fetch("/api/appearance");
    const data = await res.json();
    const url = theme === "dark" ? data.dark_bg_url : data.light_bg_url;
    if (url) {
      // Only ever set this on body, never on html too - see the header
      // comment on the html/body/#root rule in index.css for why an
      // explicit html background actively breaks full-viewport coverage
      // here rather than helping it.
      body.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.15), rgba(0,0,0,0.15)), url('${url}?t=${Date.now()}')`;
      body.style.backgroundSize = "cover";
      body.style.backgroundPosition = "center";
      body.style.backgroundAttachment = "fixed";
      body.classList.add("custom-bg");
      return;
    }
  } catch {
    // no custom background configured / appearance API unavailable - fall through to default gradient
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
