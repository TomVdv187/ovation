/**
 * Calendar attachment for the confirmation email.
 *
 * RFC 5545, written by hand: the file is forty lines of text and every library
 * that produces it drags a date implementation along. Times go out as UTC
 * (`...Z`) so Outlook, Apple Mail and Google all agree without a VTIMEZONE
 * block to get wrong.
 */

export interface CalendarInvite {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  start: Date;
  end: Date | null;
  url?: string | null;
  organiser?: { name: string; email: string } | null;
}

export function buildIcs(invite: CalendarInvite): string {
  const end =
    invite.end ?? new Date(invite.start.getTime() + 3 * 60 * 60 * 1000);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OVATION//Event registration//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeText(invite.uid)}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(invite.start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escapeText(invite.title)}`,
  ];

  if (invite.description) {
    lines.push(`DESCRIPTION:${escapeText(invite.description)}`);
  }
  if (invite.location) {
    lines.push(`LOCATION:${escapeText(invite.location)}`);
  }
  if (invite.url) {
    lines.push(`URL:${escapeText(invite.url)}`);
  }
  if (invite.organiser) {
    lines.push(
      `ORGANIZER;CN=${escapeText(invite.organiser.name)}:mailto:${invite.organiser.email}`,
    );
  }

  lines.push("STATUS:CONFIRMED", "TRANSP:OPAQUE", "END:VEVENT", "END:VCALENDAR");

  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** UTC basic format: 20260924T163000Z. */
function stamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545 §3.1: no content line over 75 octets; continuations start with a space. */
function fold(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;

  const out: string[] = [];
  let current = "";
  let width = 0;

  for (const char of line) {
    const size = Buffer.byteLength(char, "utf8");
    if (width + size > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = "";
      width = 0;
    }
    current += char;
    width += size;
  }
  out.push(current);

  return out.join("\r\n ");
}
