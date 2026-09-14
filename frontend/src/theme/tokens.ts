/**
 * theme/tokens.ts
 * -----------------
 * Base color/spacing tokens are a DIRECT PORT of V1's design_tokens.py
 * THEMES dict (dark / light / high_contrast), values copied exactly so
 * picking "dark" here looks identical to V1's existing hardcoded palette.
 *
 * The `glass` block below is NEW: V1's dashboard_native_theme.py explicitly
 * said the glassmorphism-specific tokens (blur amount, glass background
 * alpha, elevation shadows) were still to-be-defined ("dark/light/auto/
 * high-contrast switching, and the exact color values, still [TBD]") - so
 * this isn't overwriting a V1 decision, it's finishing an acknowledged gap,
 * built on top of the real ported palette rather than replacing it.
 */

export type ThemeName = "dark" | "light" | "high_contrast";

export interface ThemeTokens {
  navy: string; navy2: string; navy3: string; navy4: string;
  blue: string; blue2: string; cyan: string; teal: string;
  purple: string; amber: string; red: string; green: string;
  text: string; muted: string; border: string;
  cardShadow: string; rowAlt: string; rowHover: string;
}

// Exact values from V1 design_tokens.py THEMES dict.
export const THEMES: Record<ThemeName, ThemeTokens> = {
  dark: {
    navy: "#07111f", navy2: "#0c1d30", navy3: "#112641", navy4: "#162e4d",
    blue: "#1a5fa8", blue2: "#2878d6", cyan: "#00c2e0", teal: "#00d4a8",
    purple: "#7c3aed", amber: "#f59e0b", red: "#ef4444", green: "#22c55e",
    text: "#e2ecf8", muted: "#7a9bbf",
    border: "rgba(40,120,214,0.22)",
    cardShadow: "0 4px 24px rgba(0,0,0,0.35)",
    rowAlt: "rgba(22,46,77,0.5)",
    rowHover: "rgba(40,120,214,0.15)",
  },
  light: {
    navy: "#F8F8FB", navy2: "#FFFFFF", navy3: "#ECE8F7", navy4: "#E1DBF0",
    blue: "#2C2C84", blue2: "#3D3D9C", cyan: "#4040A8", teal: "#2E8B8B",
    purple: "#6B3FA0", amber: "#B45309", red: "#DC2626", green: "#16A34A",
    text: "#1A1A3D", muted: "#5B5B8A",
    border: "rgba(44,44,132,0.16)",
    cardShadow: "0 4px 24px rgba(44,44,132,0.10)",
    rowAlt: "rgba(236,232,247,0.7)",
    rowHover: "rgba(44,44,132,0.08)",
  },
  high_contrast: {
    navy: "#000000", navy2: "#000000", navy3: "#0a0a0a", navy4: "#141414",
    blue: "#3b9dff", blue2: "#59b0ff", cyan: "#00e5ff", teal: "#00ffc8",
    purple: "#b48cff", amber: "#ffc400", red: "#ff5252", green: "#4dff88",
    text: "#ffffff", muted: "#d0d0d0",
    border: "rgba(255,255,255,0.55)",
    cardShadow: "0 0 0 1px rgba(255,255,255,0.4)",
    rowAlt: "rgba(255,255,255,0.08)",
    rowHover: "rgba(59,157,255,0.25)",
  },
};

export const RADIUS = { sm: "12px", md: "16px", lg: "22px", xl: "28px" };
export const FONT = "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif";
// Numeric/data type role (KPI values, IDs, timestamps) - set with tabular
// figures for a precise, instrument-panel feel appropriate to a dispatch
// control center, distinct from the humanist DM Sans used for UI copy.
export const FONT_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace";

// New: glassmorphism-specific tokens, per your "Apple-inspired minimal,
// glassmorphism" spec. Same for every base theme by design - blur/opacity
// read consistently across dark/light rather than needing per-theme tuning.
export const GLASS = {
  // ITEM PASS 3 (Glass UI, round 2): pushed further per explicit feedback
  // that it still read as "transparent/white panels" even after the
  // previous round's bump (40px/0.74/0.80 -> 48px/0.86/0.90). This round:
  // blur 48px -> 56px (background shapes read as pure soft blur, not
  // legible text/edges bleeding through), alpha 0.86/0.90 -> 0.92/0.94
  // (background text specifically cannot interfere with foreground text
  // any more - this was the explicit, named complaint). Saturation stays
  // at the existing 180% multiplier applied in index.css/.glass-card -
  // not raised further, since more saturation without more opacity was
  // never the actual gap; the gap was surface opacity.
  blur: "56px",
  bgAlphaDark: "rgba(13, 30, 52, 0.92)",
  bgAlphaLight: "rgba(246, 243, 253, 0.94)",
  borderAlpha: "rgba(255, 255, 255, 0.20)",
  // ITEM PASS 6 (Part 5/6, "Use multiple glass levels... Avoid making
  // some surfaces look like white plastic while others look like
  // glass"): every glass surface app-wide - cards, top nav, MODALS, and
  // DROPDOWNS alike - was reading `--glass-bg`/`--glass-blur`, one single
  // opacity/blur pair for everything. That's part of why it read as flat
  // "white transparent panels" rather than a layered glass system: real
  // depth comes from surfaces at DIFFERENT frost levels stacking on each
  // other, not one uniform translucency repeated everywhere regardless
  // of what's behind it or how much it needs to obscure.
  //
  // Three explicit levels now, each with its own alpha AND blur (deeper
  // levels get both more opaque AND more blurred - a dropdown sitting
  // on top of a card sitting on top of the page background needs to
  // diffuse two layers of content behind it, not one):
  //   Level 1 (cards/panels) - the existing `bgAlphaDark/Light` values
  //     above, unchanged, still the default `--glass-bg`/`--glass-blur`
  //     so every existing `.glass-card` consumer keeps working exactly
  //     as before with zero migration needed.
  //   Level 2 (navigation/persistent chrome) - slightly more opaque/
  //     blurred than cards, since nav sits above scrolling page content
  //     and needs to stay legible against anything scrolling under it.
  //   Level 3 (modals/dropdowns) - the most opaque/blurred tier,
  //     specifically because this is exactly where the spec says
  //     "background text cannot show through" matters most: a dropdown
  //     or modal sits ON TOP of cards that are themselves already
  //     translucent, so it needs the strongest frost of the three to
  //     stay fully readable over that stacked-up background.
  bgAlphaDark2: "rgba(11, 26, 46, 0.95)",
  bgAlphaLight2: "rgba(248, 246, 253, 0.96)",
  blur2: "48px",
  bgAlphaDark3: "rgba(9, 22, 40, 0.97)",
  bgAlphaLight3: "rgba(250, 248, 254, 0.98)",
  blur3: "64px",
  elevation1: "0 10px 40px rgba(0,0,0,0.26)",
  elevation2: "0 24px 72px rgba(0,0,0,0.4)",
  // Liquid Glass polish: light catches BOTH the top rim (bright inset) and
  // just barely the bottom edge (a much fainter inset), the way real
  // glass/acrylic picks up ambient light on both edges, not just one.
  // Kept subtle - this is a highlight, not a border, so surface content
  // stays fully readable.
  highlight:
    "inset 0 1px 0 rgba(255,255,255,0.18), inset 0 0 0 1px rgba(255,255,255,0.03), inset 0 -1px 0 rgba(255,255,255,0.05)",
  // NEW (ITEM PASS 3): a soft top-left specular sheen - the actual visual
  // trait that separates "Apple Liquid Glass" from a generic frosted
  // rectangle. Applied via a ::before pseudo-element in index.css
  // (.glass-card::before) rather than as a background-image here, so it
  // composites over the blur/tint without needing an image asset and
  // without affecting hit-testing (pointer-events: none on the pseudo).
  specularSheen:
    "radial-gradient(120% 120% at 18% -10%, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.05) 32%, rgba(255,255,255,0) 60%)",
};

export function applyThemeToDocument(theme: ThemeName) {
  const t = THEMES[theme];
  const root = document.documentElement.style;
  root.setProperty("--navy", t.navy);
  root.setProperty("--navy2", t.navy2);
  root.setProperty("--navy3", t.navy3);
  root.setProperty("--navy4", t.navy4);
  root.setProperty("--blue", t.blue);
  root.setProperty("--blue2", t.blue2);
  root.setProperty("--cyan", t.cyan);
  root.setProperty("--teal", t.teal);
  root.setProperty("--purple", t.purple);
  root.setProperty("--amber", t.amber);
  root.setProperty("--red", t.red);
  root.setProperty("--green", t.green);
  root.setProperty("--text", t.text);
  root.setProperty("--muted", t.muted);
  root.setProperty("--border", t.border);
  root.setProperty("--card-shadow", t.cardShadow);
  root.setProperty("--row-alt", t.rowAlt);
  root.setProperty("--row-hover", t.rowHover);
  root.setProperty("--radius-sm", RADIUS.sm);
  root.setProperty("--radius-md", RADIUS.md);
  root.setProperty("--radius-lg", RADIUS.lg);
  root.setProperty("--radius-xl", RADIUS.xl);
  root.setProperty("--font", FONT);
  root.setProperty("--font-mono", FONT_MONO);
  root.setProperty("--glass-blur", GLASS.blur);
  root.setProperty("--glass-bg", theme === "light" ? GLASS.bgAlphaLight : GLASS.bgAlphaDark);
  root.setProperty("--glass-border", GLASS.borderAlpha);
  root.setProperty("--elevation-1", GLASS.elevation1);
  root.setProperty("--elevation-2", GLASS.elevation2);
  root.setProperty("--glass-highlight", GLASS.highlight);
  root.setProperty("--glass-sheen", GLASS.specularSheen);
  // ITEM PASS 6: Level 2 (nav) and Level 3 (modals/dropdowns) tokens -
  // see the GLASS block comment above for why each is progressively
  // more opaque/blurred than Level 1 (`--glass-bg`/`--glass-blur`).
  root.setProperty("--glass-bg-2", theme === "light" ? GLASS.bgAlphaLight2 : GLASS.bgAlphaDark2);
  root.setProperty("--glass-blur-2", GLASS.blur2);
  root.setProperty("--glass-bg-3", theme === "light" ? GLASS.bgAlphaLight3 : GLASS.bgAlphaDark3);
  root.setProperty("--glass-blur-3", GLASS.blur3);

  // Drives Tailwind's `dark:` variant (darkMode: "class") for any
  // Tailwind-authored component, while high_contrast keeps light-mode
  // Tailwind variants (it's a light background) but reads its own colors
  // entirely from the CSS variables above.
  document.documentElement.classList.toggle("dark", theme !== "light");
  document.documentElement.setAttribute("data-theme", theme);
}
