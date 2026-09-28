import type { Config } from "tailwindcss";
import { heroui } from "@heroui/react";
import animate from "tailwindcss-animate";

/**
 * Tailwind is layered ON TOP of the app's existing CSS-custom-property theme
 * system (src/theme/tokens.ts + ThemeProvider). We do NOT introduce a second,
 * competing color system: every Tailwind color below just points at the same
 * `--navy`, `--blue`, `--glass-bg`, etc. variables that legacy components
 * (`.glass-card`, `.btn`, `.data-table`...) already use. That means old,
 * not-yet-migrated pages and new Glass* / HeroUI / shadcn components always
 * render from one source of truth and re-theme together (dark/light/auto/
 * high-contrast, custom background) with zero duplication.
 */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "var(--navy)",
          2: "var(--navy2)",
          3: "var(--navy3)",
          4: "var(--navy4)",
        },
        accent: {
          DEFAULT: "var(--blue)",
          strong: "var(--blue2)",
        },
        cyan: "var(--cyan)",
        teal: "var(--teal)",
        violet: "var(--purple)",
        amber: "var(--amber)",
        danger: "var(--red)",
        success: "var(--green)",
        ink: "var(--text)",
        muted: "var(--muted)",
        edge: "var(--border)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "calc(var(--radius-xl) + 6px)",
      },
      fontFamily: {
        sans: ["'DM Sans'", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      backdropBlur: {
        glass: "var(--glass-blur)",
      },
      boxShadow: {
        elevation1: "var(--elevation-1)",
        elevation2: "var(--elevation-2)",
        "inner-glass": "inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(255,255,255,0.02)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          from: { backgroundPosition: "0 0" },
          to: { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
        shimmer: "shimmer 2.5s linear infinite",
      },
    },
  },
  plugins: [
    animate,
    heroui({
      defaultTheme: "dark",
      layout: {
        radius: { small: "10px", medium: "14px", large: "20px" },
      },
      themes: {
        dark: {
          colors: {
            background: "#07111f",
            primary: { DEFAULT: "#2878d6", foreground: "#ffffff" },
            secondary: { DEFAULT: "#00d4a8", foreground: "#07111f" },
          },
        },
        light: {
          colors: {
            background: "#F8F8FB",
            primary: { DEFAULT: "#2C2C84", foreground: "#ffffff" },
            secondary: { DEFAULT: "#2E8B8B", foreground: "#ffffff" },
          },
        },
      },
    }),
  ],
} satisfies Config;
