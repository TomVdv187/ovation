import type { CSSProperties } from "react";
import {
  eventThemeSchema,
  themePresets,
  themeToCssVars,
  type EventTheme,
} from "@ovation/core";
import { bestOn, ensureContrast, mix, rgba } from "./color";

/**
 * The token layer for the public page.
 *
 * This is the ONLY module allowed to know that themes differ. It turns an
 * Event.theme row into a flat bag of --ev-* custom properties; every component
 * downstream reads those properties and never asks which theme it is in. Flip
 * Event.theme.preset in the database and the page restyles because this
 * function emits different numbers — not because any component branched.
 *
 * Palette and typography come from @ovation/core (themePresets +
 * themeToCssVars). What is added here is the layer core deliberately leaves to
 * the consumer: contrast-guaranteed text colours and the structural rhythm
 * (corner radius, letter-spacing, section spacing, whether display type is set
 * in capitals) that makes two palettes read as two designs rather than one
 * design recoloured.
 *
 * Structure is derived from the theme's own typography tokens — a wide-tracked,
 * light-weight display face gets the formal treatment — so a third theme that
 * nobody has designed yet still lands somewhere deliberate.
 */

const DEFAULT_THEME: EventTheme = eventThemeSchema.parse({});

/** The chrome's critical red, before the contrast guard gets to it. */
const DANGER = "#d03b3b";

/** Tolerant parse: a malformed theme column must never 500 the public page. */
export function parseTheme(raw: unknown): EventTheme {
  const parsed = eventThemeSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_THEME;
}

interface ResolvedTheme {
  bg: string;
  surface: string;
  ink: string;
  inkMuted: string;
  accent: string;
  accentSoft: string;
  line: string;
  tracking: "tight" | "normal" | "wide";
  displayWeight: number;
}

function resolve(theme: EventTheme): ResolvedTheme {
  const preset = themePresets[theme.preset ?? "classic"];
  const palette = { ...preset.palette, ...(theme.palette ?? {}) };
  const typography = { ...preset.typography, ...(theme.typography ?? {}) };

  return {
    bg: palette.bg ?? "#0b0b0a",
    surface: palette.surface ?? "#161614",
    ink: palette.ink ?? "#f5f3ee",
    inkMuted: palette.inkMuted ?? "#a8a49a",
    accent: palette.accent ?? "#d9b36c",
    accentSoft: palette.accentSoft ?? "#e8c47e",
    line: palette.line ?? "#2b2b27",
    tracking: typography.tracking ?? "normal",
    displayWeight: typography.displayWeight ?? 400,
  };
}

/**
 * Every --ev-* property the page reads: core's palette and typography, plus the
 * derived contrast and structure tokens.
 */
export function themeVars(theme: EventTheme): Record<string, string> {
  const t = resolve(theme);

  const surface2 = mix(t.surface, t.ink, 0.06);
  const washAlpha = 0.1;

  /*
   * Every ground text can land on, including the composites.
   *
   * Listing bg and surface is not enough: a selected ticket sits on the accent
   * wash, which is the accent at 10% over one of them, and that is a lighter
   * ground than either. Missing it costs about a tenth of a contrast point,
   * which is exactly the kind of miss that turns a 100 into a 96.
   */
  const grounds = [
    t.bg,
    t.surface,
    surface2,
    mix(t.bg, t.accent, washAlpha),
    mix(t.surface, t.accent, washAlpha),
  ];

  // A formal theme is one whose display face is set wide and light — that is
  // what "black tie" means in token terms, and it is true of any such theme,
  // not just the one we happen to ship.
  const formal = t.tracking === "wide" || t.displayWeight <= 400;

  return {
    ...themeToCssVars(theme),

    // ── contrast-guaranteed text ─────────────────────────────
    "--ev-ink": ensureContrast(t.ink, grounds, 7),
    "--ev-ink-muted": ensureContrast(t.inkMuted, grounds, 4.5),
    "--ev-accent-text": ensureContrast(t.accent, grounds, 4.5),
    "--ev-accent-soft-text": ensureContrast(t.accentSoft, grounds, 4.5),
    "--ev-on-accent": bestOn(t.accent, [t.bg, t.ink]),
    "--ev-focus": ensureContrast(t.accentSoft, grounds, 3),
    // Form errors. The chrome's red is too dark to read on either launch
    // palette, so it gets the same treatment as everything else.
    "--ev-danger": ensureContrast(DANGER, grounds, 4.5),

    // ── derived surfaces ─────────────────────────────────────
    "--ev-surface-2": surface2,
    "--ev-line-soft": rgba(t.line, 0.6),
    "--ev-wash": rgba(t.accent, washAlpha),
    "--ev-edge": rgba(t.accent, 0.42),
    "--ev-scrim": rgba(t.bg, 0.78),

    // ── structure ────────────────────────────────────────────
    "--ev-radius": formal ? "0px" : "14px",
    "--ev-radius-sm": formal ? "0px" : "9px",
    "--ev-rule": formal ? "1px" : "2px",
    "--ev-kicker-tracking": formal ? "0.38em" : "0.18em",
    "--ev-display-case": formal ? "uppercase" : "none",
    "--ev-display-leading": formal ? "1.14" : "1.02",
    "--ev-section-gap": formal ? "7rem" : "5.5rem",
    "--ev-hero-pad": formal ? "9rem" : "6.5rem",
    "--ev-hero-image": theme.heroImage ? `url("${cssUrl(theme.heroImage)}")` : "none",
  };
}

/** The same bag as a React `style` prop, for the element that scopes the theme. */
export function themeStyle(theme: EventTheme): CSSProperties {
  return themeVars(theme) as CSSProperties;
}

/**
 * The theme as a stylesheet, so the variables land on :root and the ground
 * colour reaches <body> and the browser's overscroll area — a themed page that
 * shows the console's default black past the last section is not themed.
 *
 * Server-rendered in the document, so there is no unstyled flash to guard.
 */
export function themeCss(theme: EventTheme, selector = ":root"): string {
  const body = Object.entries(themeVars(theme))
    .map(([name, value]) => `${name}:${sanitiseValue(value)}`)
    .join(";");
  return `${selector}{${body}}`;
}

/**
 * Theme values are organiser-controlled data being written into a stylesheet,
 * so anything that could close the rule or open a new one comes out.
 */
function sanitiseValue(value: string): string {
  return value.replace(/[<>{};\\]/g, "").trim();
}

/** The colour a mail client or a browser chrome should paint behind the page. */
export function themeGround(theme: EventTheme): string {
  return resolve(theme).bg;
}

/** Palette snapshot for surfaces that cannot read CSS variables — email, SVG. */
export function themeColors(theme: EventTheme): ResolvedTheme & {
  accentText: string;
  onAccent: string;
} {
  const t = resolve(theme);
  return {
    ...t,
    accentText: ensureContrast(t.accent, [t.bg, t.surface], 4.5),
    onAccent: bestOn(t.accent, [t.bg, t.ink]),
  };
}

function cssUrl(value: string): string {
  return value.replace(/["\\]/g, "");
}
