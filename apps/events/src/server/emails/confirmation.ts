import type { EventTheme } from "@ovation/core";
import { formatDateLong, formatTimeRange, timezoneLabel } from "../../lib/format";
import { themeColors } from "../../lib/theme";

/**
 * The confirmation email.
 *
 * Themed from the same Event.theme as the page, because the inbox is where the
 * guest next sees the brand — but with the colours resolved to literals and the
 * layout built out of tables, since mail clients have neither custom properties
 * nor flexbox.
 */

export interface ConfirmationEmailInput {
  event: {
    title: string;
    date: Date;
    endsAt: Date | null;
    timezone: string;
    venue: string;
    venueAddress: string | null;
  };
  theme: EventTheme;
  guest: { name: string; plusOnes: number; dietary: string | null };
  waitlisted: boolean;
  ticketUrl: string;
  eventUrl: string;
  /** The signed JWT itself, printed as a fallback if images are blocked. */
  token: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderConfirmationEmail(
  input: ConfirmationEmailInput,
): RenderedEmail {
  const { event, guest, waitlisted } = input;
  const c = themeColors(input.theme);
  const tz = event.timezone;

  const when = `${formatDateLong(event.date, tz)}, ${formatTimeRange(
    event.date,
    event.endsAt,
    tz,
  )} ${timezoneLabel(event.date, tz)}`;
  const where = event.venueAddress
    ? `${event.venue}, ${event.venueAddress}`
    : event.venue;

  const subject = waitlisted
    ? `You're on the waiting list — ${event.title}`
    : `You're in — ${event.title}`;

  const lede = waitlisted
    ? "The room is full, so we have put you on the waiting list. If a seat frees up we will email you straight away — no need to do anything."
    : "Your place is confirmed. Everything you need for the evening is below.";

  const details: Array<[string, string]> = [
    ["When", when],
    ["Where", where],
  ];
  if (guest.plusOnes > 0) {
    details.push([
      "Guests",
      `You plus ${guest.plusOnes} ${guest.plusOnes === 1 ? "guest" : "guests"}`,
    ]);
  }
  if (guest.dietary) {
    details.push(["Dietary", guest.dietary]);
  }

  const textLines = [
    `${guest.name},`,
    "",
    lede,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
  ];
  if (waitlisted) {
    textLines.push("We will send your check-in code the moment a seat opens.");
  } else {
    textLines.push(
      `Your check-in code: ${input.ticketUrl}`,
      "",
      "If the link will not open, the code itself is:",
      input.token,
    );
  }
  textLines.push(
    "",
    `Event page: ${input.eventUrl}`,
    "",
    "A calendar invitation is attached.",
  );
  const text = textLines.join("\n");

  const rows = details
    .map(
      ([label, value]) => `
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid ${c.line};color:${c.inkMuted};font-size:13px;letter-spacing:0.08em;text-transform:uppercase;vertical-align:top;width:110px;">${escapeHtml(label)}</td>
            <td style="padding:10px 0;border-bottom:1px solid ${c.line};color:${c.ink};font-size:15px;line-height:1.5;">${escapeHtml(value)}</td>
          </tr>`,
    )
    .join("");

  const ticketBlock = waitlisted
    ? `<p style="margin:28px 0 0;color:${c.inkMuted};font-size:15px;line-height:1.6;">
         We will send your check-in code the moment a seat opens.
       </p>`
    : `<p style="margin:28px 0 12px;color:${c.ink};font-size:15px;line-height:1.6;">
         Show this at the door. It works offline once the page has loaded.
       </p>
       <p style="margin:0 0 18px;">
         <a href="${escapeAttr(input.ticketUrl)}"
            style="display:inline-block;padding:14px 26px;background:${c.accent};color:${c.onAccent};font-size:15px;font-weight:600;text-decoration:none;border-radius:4px;">
           Open your check-in code
         </a>
       </p>
       <p style="margin:0;color:${c.inkMuted};font-size:12px;line-height:1.6;word-break:break-all;">
         Link not working? Your code is also attached as an image, and this is the
         token itself:<br /><span style="font-family:ui-monospace,Menlo,monospace;">${escapeHtml(input.token)}</span>
       </p>`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:${c.bg};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(lede)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.bg};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${c.surface};border:1px solid ${c.line};border-radius:6px;">
            <tr>
              <td style="padding:36px 32px 32px;">
                <p style="margin:0 0 6px;color:${c.accentText};font-size:11px;letter-spacing:0.28em;text-transform:uppercase;">
                  ${waitlisted ? "Waiting list" : "You're in"}
                </p>
                <h1 style="margin:0 0 18px;color:${c.ink};font-size:26px;line-height:1.25;font-weight:600;">
                  ${escapeHtml(event.title)}
                </h1>
                <p style="margin:0 0 26px;color:${c.inkMuted};font-size:15px;line-height:1.6;">
                  ${escapeHtml(guest.name)} — ${escapeHtml(lede)}
                </p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${rows}
                </table>

                ${ticketBlock}

                <p style="margin:28px 0 0;padding-top:20px;border-top:1px solid ${c.line};color:${c.inkMuted};font-size:13px;line-height:1.6;">
                  A calendar invitation is attached.
                  <a href="${escapeAttr(input.eventUrl)}" style="color:${c.accentText};">See the full programme</a>.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
