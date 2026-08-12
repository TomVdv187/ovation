import type { GuestSegmentT } from "@ovation/core";

/**
 * Segment inference from company and title.
 *
 * Rules run in priority order and the first match wins, so every assignment has
 * exactly one reason behind it. An organiser override short-circuits the whole
 * ladder and is reported honestly through `overridden` — inference never
 * silently "corrects" a human.
 */

const MEDIA_TITLE =
  /\b(editor|editor[- ]in[- ]chief|correspondent|reporter|journalist|columnist|anchor|producer)\b/i;

const MEDIA_COMPANY =
  /\b(media|magazine|news|press|times|tijd|echo|bloomberg|trends|sprout|gazette|herald|journal|daily|post|broadcasting|radio|tv)\b/i;

const EXEC_TITLE =
  /\b(ceo|cfo|coo|cto|cmo|cio|chief executive|chief \w+ officer|managing director|managing partner|board member|chair|chairman|chairwoman|chairperson|founder|co[- ]founder|owner|president|general manager)\b/i;

const PARTNER_TITLE =
  /\b(partnership|partnerships|alliance|alliances|channel|ecosystem|business development)\b/i;

export interface SegmentationContext {
  /** Normalised names of every sponsor of this event. */
  sponsorCompanies: Set<string>;
  /** Lowercased contact emails on this event's sponsor records. */
  sponsorContacts: Set<string>;
}

export interface SegmentationSubject {
  id: string;
  email: string;
  company: string | null;
  title: string | null;
  /** Money this guest has actually spent on this event, in cents. */
  paidCents: number;
  /** They bought a top-tier ticket (a table, a VIP seat). */
  hasPremiumTicket: boolean;
  /** An organiser has already opened a white-glove checklist for them. */
  hasWhiteGlove: boolean;
}

export interface SegmentAssignment {
  guestId: string;
  segment: GuestSegmentT;
  reason: string;
  overridden: boolean;
}

export function normaliseCompany(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function emptySegmentationContext(): SegmentationContext {
  return { sponsorCompanies: new Set(), sponsorContacts: new Set() };
}

export function inferSegment(
  subject: SegmentationSubject,
  ctx: SegmentationContext,
): { segment: GuestSegmentT; reason: string } {
  const title = subject.title ?? "";
  const company = subject.company;
  const companyLabel = company ?? "their company";
  const isExec = EXEC_TITLE.test(title);

  if (MEDIA_TITLE.test(title)) {
    return {
      segment: "PRESS",
      reason: `"${title}" is a newsroom job title, so they are here to cover the event rather than attend it.`,
    };
  }

  if (company && MEDIA_COMPANY.test(company) && !isExec) {
    return {
      segment: "PRESS",
      reason: `${company} is a media outlet and their role is not an executive one, so treat them as press.`,
    };
  }

  // VIP outranks the commercial rules below it: segment drives who gets a
  // white-glove checklist, and somebody who bought the top table needs one
  // whether or not their employer also sponsors the night.
  if (isExec && (subject.hasPremiumTicket || subject.hasWhiteGlove)) {
    const marker = subject.hasPremiumTicket
      ? "they hold a top-tier ticket"
      : "an organiser has already opened a white-glove checklist for them";
    return {
      segment: "VIP",
      reason: `"${title}" at ${companyLabel}, and ${marker}. Seniority alone is not enough; seniority plus that is.`,
    };
  }

  if (ctx.sponsorContacts.has(subject.email.toLowerCase())) {
    return {
      segment: "PARTNER",
      reason: "They are the named contact on one of this event's sponsor records.",
    };
  }

  if (company && ctx.sponsorCompanies.has(normaliseCompany(company))) {
    return {
      segment: "PARTNER",
      reason: `${company} sponsors this event, so anyone attending from there is a commercial partner.`,
    };
  }

  if (PARTNER_TITLE.test(title)) {
    return {
      segment: "PARTNER",
      reason: `"${title}" owns partnerships at ${companyLabel} — the relationship is a commercial one.`,
    };
  }

  if (subject.paidCents > 0) {
    return {
      segment: "CLIENT",
      reason: `They have paid €${(subject.paidCents / 100).toFixed(0)} for a seat, which makes them a customer rather than a lead.`,
    };
  }

  if (isExec) {
    return {
      segment: "PROSPECT",
      reason: `"${title}" at ${companyLabel} is senior, but there is no purchase or sponsorship behind the name yet.`,
    };
  }

  return {
    segment: "PROSPECT",
    reason: company
      ? `Nothing in ${company} or "${title || "their untitled role"}" places them in a closer relationship yet.`
      : "No company or title on file, so there is nothing to classify them on beyond the invitation itself.",
  };
}

export function assignSegments(
  subjects: SegmentationSubject[],
  ctx: SegmentationContext,
  overrides: Array<{ guestId: string; segment: GuestSegmentT }> = [],
): SegmentAssignment[] {
  // Last override wins if an organiser sends the same guest twice.
  const overrideBy = new Map(overrides.map((o) => [o.guestId, o.segment]));

  return subjects.map((subject) => {
    const override = overrideBy.get(subject.id);
    if (override) {
      const inferred = inferSegment(subject, ctx);
      return {
        guestId: subject.id,
        segment: override,
        overridden: true,
        reason:
          override === inferred.segment
            ? `Set to ${override} by the organiser, which is what inference would have chosen anyway.`
            : `Set to ${override} by the organiser. Inference would have said ${inferred.segment}: ${inferred.reason}`,
      };
    }
    const inferred = inferSegment(subject, ctx);
    return {
      guestId: subject.id,
      segment: inferred.segment,
      reason: inferred.reason,
      overridden: false,
    };
  });
}
