import type { Config } from "tailwindcss";

/**
 * Shared Tailwind preset. Every app extends this, so `bg-surface` means the
 * same thing in the console, the public pages and the check-in PWA.
 *
 * Colours resolve to the CSS variables in tokens.css — never to literals — so
 * a theme swap at runtime restyles without a rebuild.
 */
export const ovationPreset = {
  darkMode: "class" as const,
  theme: {
    extend: {
      colors: {
        bg: "var(--ov-bg)",
        surface: {
          DEFAULT: "var(--ov-surface)",
          raised: "var(--ov-surface-raised)",
          sunken: "var(--ov-surface-sunken)",
        },
        line: {
          DEFAULT: "var(--ov-line)",
          strong: "var(--ov-line-strong)",
        },
        ink: {
          DEFAULT: "var(--ov-ink)",
          muted: "var(--ov-ink-muted)",
          subtle: "var(--ov-ink-subtle)",
          inverse: "var(--ov-ink-inverse)",
        },
        gold: {
          DEFAULT: "var(--ov-gold)",
          bright: "var(--ov-gold-bright)",
          dim: "var(--ov-gold-dim)",
          wash: "var(--ov-gold-wash)",
        },
        chart: {
          1: "var(--ov-chart-1)",
          2: "var(--ov-chart-2)",
          3: "var(--ov-chart-3)",
          4: "var(--ov-chart-4)",
          5: "var(--ov-chart-5)",
        },
        good: "var(--ov-good)",
        warning: "var(--ov-warning)",
        serious: "var(--ov-serious)",
        critical: "var(--ov-critical)",
        // Public event pages: themed per event from Event.theme.
        ev: {
          bg: "var(--ev-bg)",
          surface: "var(--ev-surface)",
          ink: "var(--ev-ink)",
          "ink-muted": "var(--ev-ink-muted)",
          accent: "var(--ev-accent)",
          "accent-soft": "var(--ev-accent-soft)",
          line: "var(--ev-line)",
        },
      },
      fontFamily: {
        display: "var(--ov-font-display)",
        sans: "var(--ov-font-sans)",
        mono: "var(--ov-font-mono)",
        "ev-display": "var(--ev-font-display)",
        "ev-body": "var(--ev-font-body)",
      },
      borderRadius: {
        sm: "var(--ov-radius-sm)",
        DEFAULT: "var(--ov-radius)",
        lg: "var(--ov-radius-lg)",
      },
      boxShadow: {
        card: "var(--ov-shadow-card)",
        pop: "var(--ov-shadow-pop)",
      },
      spacing: {
        rail: "var(--ov-rail)",
        chat: "var(--ov-chat)",
      },
      transitionTimingFunction: {
        ov: "var(--ov-ease)",
      },
    },
  },
} satisfies Omit<Config, "content">;

export default ovationPreset;
