import type { AgendaItem, EventTheme, PageSection } from "@ovation/core";
import {
  formatDateLong,
  formatTime,
  formatTimeRange,
  timezoneLabel,
} from "../lib/format";

/**
 * Turns an Event row into the ordered section list that page.render returns.
 *
 * The page body is data, not markup: every string a guest reads is assembled
 * here from columns that actually exist. Nothing is invented — if the event has
 * no dress code, there is no dress-code fact, rather than a plausible one.
 */

const SPONSOR_TIER_ORDER = ["GOLD", "SILVER", "CUSTOM"] as const;

const SPONSOR_TIER_LABELS: Record<
  (typeof SPONSOR_TIER_ORDER)[number],
  { one: string; many: string }
> = {
  GOLD: { one: "Gold partner", many: "Gold partners" },
  SILVER: { one: "Silver partner", many: "Silver partners" },
  CUSTOM: { one: "Partner", many: "Partners" },
};

/**
 * Used only when the organiser has not written their own. Says what we do with
 * the data and nothing more — a GDPR block has to be honest, and the honest
 * version of "we have not been told" is the minimum lawful statement.
 */
export const DEFAULT_CONSENT_TEXT =
  "We store the details you give us here to manage your attendance at this " +
  "event, and we email you about this event only. We do not sell them or pass " +
  "them to anyone who is not working on the evening. Ask us at any time and we " +
  "will delete them.";

export interface BuildSectionsInput {
  event: {
    title: string;
    slug: string;
    description: string | null;
    date: Date;
    endsAt: Date | null;
    timezone: string;
    venue: string;
    venueAddress: string | null;
  };
  organisationName: string | null;
  theme: EventTheme;
  agenda: AgendaItem[];
  sponsors: Array<{
    id: string;
    name: string;
    package: string;
    logoUrl: string | null;
  }>;
  consentText: string;
  ticketsAvailable: boolean;
}

export function buildSections(input: BuildSectionsInput): PageSection[] {
  const { event, theme, agenda } = input;
  const timezone = event.timezone;

  const sections: PageSection[] = [];

  sections.push({
    kind: "hero",
    kicker: input.organisationName,
    title: event.title,
    subtitle: event.description,
    ctaLabel: input.ticketsAvailable ? "Get tickets" : "Register to attend",
    ctaHref: input.ticketsAvailable
      ? `/e/${event.slug}/tickets`
      : `/e/${event.slug}/register`,
  });

  const facts: Array<{ label: string; value: string }> = [
    { label: "Date", value: formatDateLong(event.date, timezone) },
    {
      label: "Time",
      value: `${formatTimeRange(event.date, event.endsAt, timezone)} ${timezoneLabel(
        event.date,
        timezone,
      )}`,
    },
    {
      label: "Venue",
      value: event.venueAddress
        ? `${event.venue}, ${event.venueAddress}`
        : event.venue,
    },
  ];
  if (theme.dressCode) {
    facts.push({ label: "Dress code", value: theme.dressCode });
  }
  sections.push({ kind: "keyFacts", facts });

  if (agenda.length > 0) {
    sections.push({ kind: "programme", items: agenda });
  }

  const tiers = SPONSOR_TIER_ORDER.map((pkg) => {
    const sponsors = input.sponsors.filter((s) => s.package === pkg);
    const labels = SPONSOR_TIER_LABELS[pkg];
    return {
      label: sponsors.length === 1 ? labels.one : labels.many,
      sponsors: sponsors.map((s) => ({ name: s.name, logoUrl: s.logoUrl })),
    };
  }).filter((tier) => tier.sponsors.length > 0);

  if (tiers.length > 0) {
    sections.push({ kind: "sponsors", tiers });
  }

  sections.push({ kind: "practical", blocks: practicalBlocks(input) });

  sections.push({
    kind: "consent",
    text: input.consentText.trim() || DEFAULT_CONSENT_TEXT,
  });

  return sections;
}

function practicalBlocks(
  input: BuildSectionsInput,
): Array<{ title: string; body: string }> {
  const { event, agenda, theme } = input;
  const tz = event.timezone;
  const blocks: Array<{ title: string; body: string }> = [];

  const doors = agenda.find((item) => item.kind === "DOORS");
  const dinner = agenda.find((item) => item.kind === "DINNER");

  blocks.push({
    title: "Getting there",
    body: event.venueAddress
      ? `${event.venue}, ${event.venueAddress}.`
      : `${event.venue}.`,
  });

  const running: string[] = [];
  running.push(
    `Doors from ${formatTime(doors ? doors.startsAt : event.date, tz)}.`,
  );
  if (dinner) {
    running.push(`${dinner.title} at ${formatTime(dinner.startsAt, tz)}.`);
  }
  if (event.endsAt) {
    running.push(`The evening closes at ${formatTime(event.endsAt, tz)}.`);
  }
  if (theme.dressCode) {
    running.push(`Dress code: ${theme.dressCode.toLowerCase()}.`);
  }
  blocks.push({ title: "On the night", body: running.join(" ") });

  blocks.push({
    title: "Your ticket",
    body:
      "Registering emails you a QR code. Have it open on your phone at the " +
      "door — we scan it on arrival, and it works without signal. Bringing a " +
      "guest? Tell us when you register so their seat is set.",
  });

  return blocks;
}
