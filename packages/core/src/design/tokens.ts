import type { EventTheme, ThemePreset } from "../schemas/event";

/**
 * Token values in TS, for anything that cannot read CSS variables: SVG charts,
 * email HTML, canvas, and the public-page theme presets.
 *
 * Keep in lockstep with tokens.css.
 */
export const tokens = {
  bg: "#0d0d0d",
  surface: "#1a1a19",
  surfaceRaised: "#232321",
  line: "#2e2e2b",
  ink: "#f5f3ee",
  inkMuted: "#a8a49a",
  inkSubtle: "#6e6a62",
  gold: "#d9b36c",
  goldBright: "#e8c47e",
  chart: ["#3987e5", "#d95926", "#199e70", "#d9b36c", "#8b6ed9"],
  status: {
    good: "#0ca30c",
    warning: "#fab219",
    serious: "#ec835a",
    critical: "#d03b3b",
  },
  fontDisplay:
    '"Didot", "Playfair Display", "Bodoni MT", "Times New Roman", ui-serif, Georgia, serif',
  fontSans:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
} as const;

/** Risk colour for a no-show / status badge. */
export function statusColor(
  level: "LOW" | "MEDIUM" | "HIGH" | "GOOD" | "CRITICAL",
): string {
  switch (level) {
    case "LOW":
    case "GOOD":
      return tokens.status.good;
    case "MEDIUM":
      return tokens.status.warning;
    case "HIGH":
      return tokens.status.serious;
    case "CRITICAL":
      return tokens.status.critical;
  }
}

/**
 * The two launch themes for public event pages. apps/events must render
 * entirely from these values, so switching Event.theme.preset in the database
 * restyles the page with zero code change.
 */
export const themePresets: Record<ThemePreset, Required<
  Pick<EventTheme, "palette" | "typography">
>> = {
  classic: {
    palette: {
      bg: "#0a1a33",
      surface: "#0f2445",
      ink: "#f2f6fc",
      inkMuted: "#a9bcd8",
      accent: "#3987e5",
      accentSoft: "#6fa9ee",
      line: "#1c3a68",
    },
    typography: {
      display: tokens.fontSans,
      body: tokens.fontSans,
      displayWeight: 700,
      tracking: "tight",
    },
  },
  blacktie: {
    palette: {
      bg: "#0b0b0a",
      surface: "#161614",
      ink: "#f5f3ee",
      inkMuted: "#a8a49a",
      accent: "#d9b36c",
      accentSoft: "#e8c47e",
      line: "#2b2b27",
    },
    typography: {
      display: tokens.fontDisplay,
      body: tokens.fontSans,
      displayWeight: 400,
      tracking: "wide",
    },
  },
};

/** Merges a stored Event.theme over its preset and emits CSS custom properties. */
export function themeToCssVars(theme: Partial<EventTheme>): Record<string, string> {
  const preset = themePresets[theme.preset ?? "classic"];
  const palette = { ...preset.palette, ...(theme.palette ?? {}) };
  const typography = { ...preset.typography, ...(theme.typography ?? {}) };

  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(palette)) {
    if (typeof value === "string") {
      vars[`--ev-${kebab(key)}`] = value;
    }
  }
  if (typography.display) vars["--ev-font-display"] = typography.display;
  if (typography.body) vars["--ev-font-body"] = typography.body;
  if (typography.displayWeight) {
    vars["--ev-display-weight"] = String(typography.displayWeight);
  }
  if (typography.tracking) {
    vars["--ev-tracking"] =
      typography.tracking === "tight"
        ? "-0.02em"
        : typography.tracking === "wide"
          ? "0.06em"
          : "0";
  }
  return vars;
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
