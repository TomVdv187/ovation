/**
 * Formatting for the public page.
 *
 * Every date on a guest-facing surface is rendered in the EVENT's timezone, not
 * the server's and not the browser's: doors at 18:30 in Antwerp must read 18:30
 * to someone opening the page in Lisbon. Server-rendered output would otherwise
 * disagree with the client and hydrate wrong.
 */

const LOCALE = "en-GB";

export function formatDateLong(date: Date, timezone: string): string {
  return format(date, timezone, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatDateShort(date: Date, timezone: string): string {
  return format(date, timezone, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatTime(date: Date, timezone: string): string {
  return format(date, timezone, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatTimeRange(
  start: Date,
  end: Date | null | undefined,
  timezone: string,
): string {
  const from = formatTime(start, timezone);
  return end ? `${from}–${formatTime(end, timezone)}` : from;
}

/** "CEST" / "GMT+2" — so a printed time is never ambiguous. */
export function timezoneLabel(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat(LOCALE, {
    timeZone: timezone,
    timeZoneName: "short",
  }).formatToParts(date);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timezone;
}

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** `datetime` attribute for <time> — always the real instant, in UTC. */
export function machineDate(date: Date): string {
  return date.toISOString();
}

function format(
  date: Date,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat(LOCALE, {
      ...options,
      timeZone: timezone,
    }).format(date);
  } catch {
    // An unknown IANA zone must not take the page down.
    return new Intl.DateTimeFormat(LOCALE, options).format(date);
  }
}
