/**
 * Email-ready sponsor ROI report.
 *
 * Constraints, because this lands in Outlook and Gmail:
 *  - table layout, no flexbox/grid, no float;
 *  - every style inline, no <style> block, no external CSS;
 *  - no web fonts, no background images, no JavaScript;
 *  - fixed 600px content width with a full-width wrapper table;
 *  - every interpolated value HTML-escaped.
 *
 * The renderer is pure — it takes numbers and returns a string. Nothing here
 * sends anything; the router queues the result as an EmailMessage PROPOSED.
 */
import type { SponsorRoiStats } from "@ovation/core";
import { formatCount, formatMoney } from "../money";
import type { MatchedLead } from "./match";
import type { SponsorEntitlements } from "./packages";
import { formatList } from "./packages";
import type { RenewalSignal } from "./roi";

/** Leads listed in full before collapsing to a "+N more" line. */
const MAX_LISTED_LEADS = 25;

const INK = "#1c1917";
const MUTED = "#57534e";
const RULE = "#e7e5e4";
const PAPER = "#faf9f7";
const ACCENT = "#7c2d12";

const FONT =
  "font-family:Georgia,'Times New Roman',Times,serif;-webkit-font-smoothing:antialiased;";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const INTENT_COPY: Record<SponsorRoiStats["renewalIntent"], { label: string; colour: string }> =
  {
    HIGH: { label: "High — worth opening the renewal conversation now", colour: "#166534" },
    MEDIUM: { label: "Medium — engaged, needs a nudge", colour: "#854d0e" },
    LOW: { label: "Low — at risk, intervene before the event", colour: "#991b1b" },
    UNKNOWN: { label: "Not enough signal yet", colour: MUTED },
  };

export interface RoiEmailInput {
  sponsorName: string;
  sponsorPackage: string;
  amountCents: number;
  currency: string;
  eventTitle: string;
  eventDate: Date;
  periodLabel: string;
  stats: SponsorRoiStats;
  renewal: RenewalSignal;
  entitlements: SponsorEntitlements;
  matchedLeads: readonly MatchedLead[];
  unmatchedAccounts: readonly string[];
  pageVisits: number;
  impressionMultiplier: number;
  contactName: string | null;
}

export function sponsorRoiSubject(input: Pick<RoiEmailInput, "sponsorName" | "eventTitle" | "periodLabel">): string {
  return `${input.sponsorName} — sponsor report, ${input.eventTitle} (${input.periodLabel})`;
}

export function renderSponsorRoiEmail(input: RoiEmailInput): string {
  const intent = INTENT_COPY[input.stats.renewalIntent];
  const eventDate = input.eventDate.toISOString().slice(0, 10);

  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:${PAPER};margin:0;padding:0;">`,
    `<tr><td align="center" style="padding:24px 12px;">`,
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid ${RULE};border-radius:4px;">`,

    header(input, eventDate),
    statsGrid(input),
    impressionsNote(input),
    leadsSection(input),
    entitlementsSection(input),
    renewalSection(input, intent),
    footer(input),

    `</table>`,
    `</td></tr>`,
    `</table>`,
  ].join("");
}

function header(input: RoiEmailInput, eventDate: string): string {
  const greeting = input.contactName
    ? `Hello ${escapeHtml(input.contactName.split(" ")[0] ?? input.contactName)},`
    : "Hello,";
  return [
    `<tr><td style="padding:28px 32px 8px 32px;${FONT}">`,
    `<p style="margin:0 0 4px 0;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED};">Sponsor report · ${escapeHtml(input.periodLabel)}</p>`,
    `<h1 style="margin:0 0 2px 0;font-size:26px;line-height:32px;font-weight:normal;color:${INK};">${escapeHtml(input.sponsorName)}</h1>`,
    `<p style="margin:0 0 16px 0;font-size:14px;color:${MUTED};">${escapeHtml(input.eventTitle)} · ${escapeHtml(eventDate)} · ${escapeHtml(input.sponsorPackage)} package, ${escapeHtml(formatMoney(input.amountCents, input.currency))}</p>`,
    `<p style="margin:0;font-size:15px;line-height:23px;color:${INK};">${greeting} here is where your sponsorship stands this week.</p>`,
    `</td></tr>`,
  ].join("");
}

function statCell(label: string, value: string, sub: string): string {
  return [
    `<td width="33%" valign="top" style="width:33%;padding:14px 10px;border:1px solid ${RULE};${FONT}">`,
    `<p style="margin:0 0 4px 0;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${MUTED};">${escapeHtml(label)}</p>`,
    `<p style="margin:0 0 2px 0;font-size:24px;line-height:28px;color:${INK};">${escapeHtml(value)}</p>`,
    `<p style="margin:0;font-size:12px;line-height:16px;color:${MUTED};">${escapeHtml(sub)}</p>`,
    `</td>`,
  ].join("");
}

function statsGrid(input: RoiEmailInput): string {
  const s = input.stats;
  return [
    `<tr><td style="padding:12px 32px 4px 32px;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">`,
    `<tr>`,
    statCell("Logo impressions", formatCount(s.logoImpressions), "estimated, public event page"),
    statCell("Matched leads", formatCount(s.leads), "guests from your target accounts"),
    statCell("1:1 meetings", formatCount(s.meetings), "booked to date"),
    `</tr><tr>`,
    statCell("Report opens", formatCount(s.reportOpens), "your team, all reports"),
    statCell("Benefits clicks", formatCount(s.benefitsPageClicks), "through to your benefits page"),
    statCell("Renewal signal", s.renewalIntent, `score ${s.renewalIntent === "UNKNOWN" ? "0" : String(input.renewal.score)} of 6`),
    `</tr>`,
    `</table>`,
    `</td></tr>`,
  ].join("");
}

function impressionsNote(input: RoiEmailInput): string {
  const placements = input.entitlements.logoPlacements;
  const detail = placements.length
    ? `${formatCount(input.pageVisits)} visits to the public event page, weighted across your placements (${escapeHtml(formatList(placements))}).`
    : `${formatCount(input.pageVisits)} visits to the public event page.`;
  return [
    `<tr><td style="padding:10px 32px 0 32px;${FONT}">`,
    `<p style="margin:0;font-size:12px;line-height:18px;color:${MUTED};">Impressions are an estimate, not a counter: ${detail} Placement weighting factor ${escapeHtml(String(input.impressionMultiplier))}.</p>`,
    `</td></tr>`,
  ].join("");
}

function sectionHeading(text: string): string {
  return `<p style="margin:0 0 10px 0;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${ACCENT};">${escapeHtml(text)}</p>`;
}

function leadsSection(input: RoiEmailInput): string {
  const leads = input.matchedLeads;
  const rows =
    leads.length === 0
      ? `<tr><td style="padding:8px 0;font-size:14px;color:${MUTED};${FONT}">No guests from your target-account list have registered yet.</td></tr>`
      : leads
          .slice(0, MAX_LISTED_LEADS)
          .map(
            (lead, index) =>
              `<tr style="background-color:${index % 2 === 0 ? "#ffffff" : PAPER};">` +
              `<td style="padding:7px 10px;font-size:14px;line-height:20px;color:${INK};border-bottom:1px solid ${RULE};${FONT}">${escapeHtml(lead.name)}</td>` +
              `<td style="padding:7px 10px;font-size:14px;line-height:20px;color:${MUTED};border-bottom:1px solid ${RULE};${FONT}">${escapeHtml(lead.company ?? lead.targetAccount)}</td>` +
              `</tr>`,
          )
          .join("");

  const overflow =
    leads.length > MAX_LISTED_LEADS
      ? `<p style="margin:8px 0 0 0;font-size:13px;color:${MUTED};${FONT}">+ ${formatCount(leads.length - MAX_LISTED_LEADS)} more attending from your target accounts.</p>`
      : "";

  const gap = input.unmatchedAccounts.length
    ? `<p style="margin:10px 0 0 0;font-size:13px;line-height:19px;color:${MUTED};${FONT}">No registrations yet from ${escapeHtml(formatList([...input.unmatchedAccounts]))}. We can target them in the next invitation wave — say the word.</p>`
    : "";

  return [
    `<tr><td style="padding:22px 32px 0 32px;${FONT}">`,
    sectionHeading("Your target accounts in the room"),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${rows}</table>`,
    overflow,
    gap,
    `</td></tr>`,
  ].join("");
}

function entitlementsSection(input: RoiEmailInput): string {
  const e = input.entitlements;
  const items: string[] = [];
  if (e.logoPlacements.length) items.push(`Logo on ${formatList(e.logoPlacements)}`);
  if (e.vipDinnerSeats > 0) items.push(`${e.vipDinnerSeats} VIP dinner seats`);
  if (e.targetAccountIntros > 0)
    items.push(
      `${e.targetAccountIntros} target-account introductions (${input.stats.meetings} delivered)`,
    );
  if (e.standSize) items.push(`${e.standSize} stand`);
  if (e.speakingSlot) items.push("Speaking slot on the main stage");
  if (items.length === 0) return "";

  const rows = items
    .map(
      (item) =>
        `<tr><td width="16" valign="top" style="width:16px;padding:4px 0;font-size:14px;color:${ACCENT};${FONT}">&bull;</td>` +
        `<td style="padding:4px 0;font-size:14px;line-height:21px;color:${INK};${FONT}">${escapeHtml(item)}</td></tr>`,
    )
    .join("");

  return [
    `<tr><td style="padding:22px 32px 0 32px;${FONT}">`,
    sectionHeading("What your package includes"),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">${rows}</table>`,
    `</td></tr>`,
  ].join("");
}

function renewalSection(
  input: RoiEmailInput,
  intent: { label: string; colour: string },
): string {
  const drivers = input.renewal.drivers
    .map(
      (driver) =>
        `<li style="margin:0 0 4px 0;font-size:13px;line-height:19px;color:${MUTED};">${escapeHtml(driver)}</li>`,
    )
    .join("");

  return [
    `<tr><td style="padding:22px 32px 0 32px;${FONT}">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:${PAPER};border:1px solid ${RULE};border-radius:4px;">`,
    `<tr><td style="padding:16px 18px;${FONT}">`,
    sectionHeading("Renewal signal"),
    `<p style="margin:0 0 8px 0;font-size:15px;line-height:22px;color:${intent.colour};">${escapeHtml(intent.label)}</p>`,
    `<ul style="margin:0;padding-left:18px;">${drivers}</ul>`,
    `</td></tr>`,
    `</table>`,
    `</td></tr>`,
  ].join("");
}

function footer(input: RoiEmailInput): string {
  return [
    `<tr><td style="padding:22px 32px 28px 32px;${FONT}">`,
    `<p style="margin:0 0 14px 0;font-size:15px;line-height:23px;color:${INK};">Happy to walk through any of this before ${escapeHtml(input.eventTitle)} — just reply to this note.</p>`,
    `<hr style="border:0;border-top:1px solid ${RULE};margin:0 0 12px 0;" />`,
    `<p style="margin:0;font-size:11px;line-height:17px;color:${MUTED};">Figures cover ${escapeHtml(input.periodLabel)}. Impressions are modelled from public-page traffic; leads are guests whose company matches your target-account list. Sent by the ${escapeHtml(input.eventTitle)} team.</p>`,
    `</td></tr>`,
  ].join("");
}
