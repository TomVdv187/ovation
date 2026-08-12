/**
 * Colour maths for the theme layer.
 *
 * The public page is themed entirely from Event.theme, which means a theme the
 * page has never seen can arrive at runtime. Rather than trust it, the token
 * layer derives contrast-safe variants here — so "Lighthouse accessibility ≥ 95
 * in both themes" holds for a third theme nobody has designed yet.
 *
 * Nothing in here knows what a preset is called. It only knows colours.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB_FN = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i;

export function parseColor(value: string): Rgb | null {
  const raw = value.trim();

  const hex = HEX.exec(raw);
  if (hex) {
    const digits = hex[1] as string;
    const full =
      digits.length === 3
        ? digits
            .split("")
            .map((c) => c + c)
            .join("")
        : digits;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    };
  }

  const fn = RGB_FN.exec(raw);
  if (fn) {
    return {
      r: clampByte(Number(fn[1])),
      g: clampByte(Number(fn[2])),
      b: clampByte(Number(fn[3])),
    };
  }

  return null;
}

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => clampByte(c).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(color: Rgb): number {
  const channel = (value: number): number => {
    const c = clampByte(value) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(color.r) +
    0.7152 * channel(color.g) +
    0.0722 * channel(color.b)
  );
}

/** WCAG contrast ratio, 1–21. Unparseable input scores 1 so guards kick in. */
export function contrast(a: string, b: string): number {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return 1;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function rgba(color: string, alpha: number): string {
  const c = parseColor(color);
  if (!c) return color;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${round(alpha, 3)})`;
}

/** Linear blend in sRGB. `t` = 0 returns `a`, 1 returns `b`. */
export function mix(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  const k = Math.min(1, Math.max(0, t));
  return toHex({
    r: Math.round(ca.r + (cb.r - ca.r) * k),
    g: Math.round(ca.g + (cb.g - ca.g) * k),
    b: Math.round(ca.b + (cb.b - ca.b) * k),
  });
}

/**
 * Nudges `foreground` until it clears `target` against every background it will
 * be painted on. Direction is chosen from the backgrounds themselves: light
 * grounds push the colour darker, dark grounds push it lighter, so the nudge
 * always keeps the hue and only spends lightness.
 *
 * Presets that already pass are returned untouched — this never repaints a
 * theme that was designed properly.
 */
export function ensureContrast(
  foreground: string,
  backgrounds: string[],
  target = 4.5,
): string {
  const grounds = backgrounds.filter((b) => parseColor(b) !== null);
  if (grounds.length === 0 || parseColor(foreground) === null) return foreground;

  const passes = (candidate: string): boolean =>
    grounds.every((ground) => contrast(candidate, ground) >= target);

  if (passes(foreground)) return foreground;

  const darkest = grounds.reduce((worst, ground) =>
    relativeLuminance(parseColor(ground) as Rgb) >
    relativeLuminance(parseColor(worst) as Rgb)
      ? ground
      : worst,
  );
  // Push away from the *lightest* ground: that is the one that fails first.
  const towards =
    relativeLuminance(parseColor(darkest) as Rgb) > 0.18 ? "#000000" : "#ffffff";

  for (let step = 1; step <= 50; step++) {
    const candidate = mix(foreground, towards, step / 50);
    if (passes(candidate)) return candidate;
  }
  return towards;
}

/** Picks whichever candidate reads best on `background` — for text on a fill. */
export function bestOn(background: string, candidates: string[]): string {
  let winner = candidates[0] ?? "#000000";
  let best = -1;
  for (const candidate of candidates) {
    const ratio = contrast(candidate, background);
    if (ratio > best) {
      best = ratio;
      winner = candidate;
    }
  }
  return winner;
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
