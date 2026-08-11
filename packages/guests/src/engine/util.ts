/** Small pure helpers shared by the engine. No clock reads live here. */

export const DAY_MS = 86_400_000;

/** Whole days from `from` to `to`. Negative when `from` is after `to`. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Round to `places` decimals without float dust (0.1 + 0.2 style). */
export function round(value: number, places = 0): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function pct(probability: number): string {
  return `${Math.round(probability * 100)}%`;
}

/** "3 guests" / "1 guest" — plural forms in the sentences the console renders. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function firstNameOf(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0] ?? "there";
}

/** Lowercased top-level domain of an email address, or null when unparseable. */
export function emailTld(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase();
  const dot = domain.lastIndexOf(".");
  if (dot < 0 || dot === domain.length - 1) return null;
  return domain.slice(dot + 1);
}
