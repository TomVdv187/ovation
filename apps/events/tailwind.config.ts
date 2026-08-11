import type { Config } from "tailwindcss";
import { ovationPreset } from "@ovation/core/tailwind-preset";

/**
 * The shared preset gives the ev-* palette (bg, surface, ink, accent, line).
 * What is added here is the layer this app derives on top of Event.theme —
 * contrast-guaranteed text colours and the structural rhythm — exposed as flat
 * utility names so components never inline a var() by hand.
 *
 * Every value is a variable. Nothing in this file knows which theme is on.
 */
export default {
  presets: [ovationPreset],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "ev-accent-text": "var(--ev-accent-text)",
        "ev-accent-soft-text": "var(--ev-accent-soft-text)",
        "ev-on-accent": "var(--ev-on-accent)",
        "ev-surface-2": "var(--ev-surface-2)",
        "ev-line-soft": "var(--ev-line-soft)",
        "ev-wash": "var(--ev-wash)",
        "ev-edge": "var(--ev-edge)",
        "ev-danger": "var(--ev-danger)",
      },
      borderRadius: {
        ev: "var(--ev-radius)",
        "ev-sm": "var(--ev-radius-sm)",
      },
      spacing: {
        section: "var(--ev-section-gap)",
        hero: "var(--ev-hero-pad)",
      },
      maxWidth: {
        prose: "62ch",
      },
      fontSize: {
        // Fluid, so a 320px phone and a 1600px desktop both read well without
        // a breakpoint in sight.
        hero: ["clamp(2.5rem, 8vw, 5rem)", { lineHeight: "var(--ev-display-leading)" }],
        section: ["clamp(1.75rem, 4vw, 2.5rem)", { lineHeight: "1.15" }],
        lede: ["clamp(1.0625rem, 2.2vw, 1.375rem)", { lineHeight: "1.55" }],
      },
    },
  },
} satisfies Config;
