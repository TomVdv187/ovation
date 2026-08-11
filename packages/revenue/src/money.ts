/**
 * Money helpers. Owned by Agent 4 · TREASURY.
 *
 * EVERY amount inside this package is minor units (cents), integer, no floats.
 * The only place a "€145" string is ever produced is here, for human-facing
 * copy (email HTML, proposal summaries, rationale strings). Nothing that
 * crosses the tRPC wire goes through a formatter.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€",
  GBP: "£",
  USD: "$",
};

/**
 * Format minor units for humans. Deliberately hand-rolled rather than
 * Intl.NumberFormat: the ICU data shipped with Node varies by build, and the
 * seed assertions / email snapshots want a byte-stable "€12,500".
 */
export function formatMoney(cents: number, currency = "EUR"): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const major = Math.floor(abs / 100);
  const minor = abs % 100;
  const grouped = major.toLocaleString("en-US");
  return minor === 0
    ? `${sign}${symbol}${grouped}`
    : `${sign}${symbol}${grouped}.${String(minor).padStart(2, "0")}`;
}

/** Thousands separator for plain counts — "18,400 impressions". */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** One decimal place, for percentages in rationale strings. */
export function formatPercent(value: number): string {
  return `${roundTo(value, 1)}%`;
}

/** Round to `places` decimals without accumulating binary float noise. */
export function roundTo(value: number, places: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Round a derived amount back to whole cents — centsSchema is `.int()`. */
export function toCents(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

/** Round up to the nearest whole `stepCents` (used for price suggestions). */
export function roundUpTo(cents: number, stepCents: number): number {
  if (stepCents <= 0) return toCents(cents);
  return Math.ceil(cents / stepCents) * stepCents;
}
