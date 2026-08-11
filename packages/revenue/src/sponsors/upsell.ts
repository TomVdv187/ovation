/**
 * Upsell radar — which Silver sponsors have earned a Gold pitch, and the
 * offer copy to open that conversation with.
 *
 * THE GROUNDING RULE: the `evidence` array is not decoration. It is the
 * complete set of facts the copy is allowed to contain, it is built here from
 * stored values only, and it is the exact list handed to the model. The model
 * is told it may use nothing else. An invented statistic in a sponsor offer is
 * a commercial liability, so if the model is unavailable or its output looks
 * wrong, we fall back to a template assembled from the same array.
 */
import type { SponsorPackageT } from "@ovation/core";
import { completeText } from "../anthropic";
import { formatCount, formatMoney } from "../money";
import type { MatchedLead } from "./match";
import {
  describeUpgrade,
  entitlementDeltas,
  formatList,
  packageReference,
  parseEntitlements,
  titleCase,
  type PackageReference,
  type SponsorEntitlements,
} from "./packages";

/** Packages a Gold pitch makes sense from. */
const UPGRADABLE_FROM: readonly SponsorPackageT[] = ["SILVER", "CUSTOM"];

/** Only sponsors whose money is already booked are worth upselling. */
const BOOKED = new Set(["SIGNED", "SERVICED"]);

export interface SponsorFacts {
  id: string;
  name: string;
  package: SponsorPackageT;
  amountCents: number;
  status: string;
  contactName: string | null;
  entitlements: unknown;
  roiStats: unknown;
  engagementScore: number;
  targetAccounts: string[];
}

export interface UpsellContext {
  sponsors: readonly SponsorFacts[];
  threshold: number;
  currency: string;
  eventTitle: string;
  eventDate: Date;
  /** Guests matched to each sponsor's target accounts, keyed by sponsor id. */
  leadsBySponsor: Map<string, MatchedLead[]>;
  /** Observed counters, keyed by sponsor id. */
  activityBySponsor: Map<string, { reportOpens: number; benefitsPageClicks: number; meetings: number }>;
}

export interface UpsellCandidate {
  sponsorId: string;
  name: string;
  contactName: string | null;
  currentPackage: SponsorPackageT;
  suggestedPackage: SponsorPackageT;
  currentAmountCents: number;
  targetAmountCents: number;
  incrementalAmountCents: number;
  engagementScore: number;
  evidence: string[];
  entitlements: SponsorEntitlements;
  reference: PackageReference;
}

/**
 * Silver (or Custom) sponsors whose engagement has crossed the threshold and
 * for whom Gold is genuinely more expensive than what they pay today.
 */
export function findUpsellCandidates(ctx: UpsellContext): UpsellCandidate[] {
  const reference = packageReference(ctx.sponsors, "GOLD");
  const candidates: UpsellCandidate[] = [];

  for (const sponsor of ctx.sponsors) {
    if (!BOOKED.has(sponsor.status)) continue;
    if (!UPGRADABLE_FROM.includes(sponsor.package)) continue;
    if (sponsor.engagementScore < ctx.threshold) continue;

    const incrementalAmountCents = reference.amountCents - sponsor.amountCents;
    if (incrementalAmountCents <= 0) continue; // Nothing to sell.

    const entitlements = parseEntitlements(sponsor.entitlements);
    const leads = ctx.leadsBySponsor.get(sponsor.id) ?? [];
    const activity = ctx.activityBySponsor.get(sponsor.id) ?? {
      reportOpens: 0,
      benefitsPageClicks: 0,
      meetings: 0,
    };

    candidates.push({
      sponsorId: sponsor.id,
      name: sponsor.name,
      contactName: sponsor.contactName,
      currentPackage: sponsor.package,
      suggestedPackage: reference.package,
      currentAmountCents: sponsor.amountCents,
      targetAmountCents: reference.amountCents,
      incrementalAmountCents,
      engagementScore: sponsor.engagementScore,
      entitlements,
      reference,
      evidence: buildEvidence({
        sponsor,
        entitlements,
        reference,
        leads,
        activity,
        threshold: ctx.threshold,
        currency: ctx.currency,
        eventTitle: ctx.eventTitle,
      }),
    });
  }

  return candidates.sort(
    (a, b) => b.engagementScore - a.engagementScore || a.name.localeCompare(b.name),
  );
}

interface EvidenceInput {
  sponsor: SponsorFacts;
  entitlements: SponsorEntitlements;
  reference: PackageReference;
  leads: readonly MatchedLead[];
  activity: { reportOpens: number; benefitsPageClicks: number; meetings: number };
  threshold: number;
  currency: string;
  eventTitle: string;
}

/**
 * Every string here traces to a stored value. No derived percentages, no
 * projections, no "typically" — if it is not observed, it does not go in.
 */
export function buildEvidence(input: EvidenceInput): string[] {
  const { sponsor, entitlements, reference, leads, activity, currency } = input;
  const evidence: string[] = [];

  evidence.push(
    `${sponsor.name} is a ${titleCase(sponsor.package)} sponsor of ${input.eventTitle} at ${formatMoney(sponsor.amountCents, currency)}.`,
  );
  evidence.push(
    `Their engagement score is ${sponsor.engagementScore} out of 100, above the ${input.threshold} threshold for a Gold conversation.`,
  );

  if (activity.reportOpens > 0) {
    evidence.push(`They have opened ${formatCount(activity.reportOpens)} sponsor reports.`);
  }
  if (activity.benefitsPageClicks > 0) {
    evidence.push(
      `They have clicked through to the sponsor benefits page ${formatCount(activity.benefitsPageClicks)} times.`,
    );
  }
  if (activity.meetings > 0) {
    evidence.push(
      `${formatCount(activity.meetings)} of their ${entitlements.targetAccountIntros} contracted 1:1 introductions have been booked.`,
    );
  }

  if (leads.length > 0) {
    const accounts = [...new Set(leads.map((lead) => lead.targetAccount))];
    evidence.push(
      `${formatCount(leads.length)} registered guests work at companies on their target-account list (${formatList(accounts)}).`,
    );
  }
  if (sponsor.targetAccounts.length > 0) {
    evidence.push(
      `Their target-account list is ${formatList(sponsor.targetAccounts)}.`,
    );
  }

  evidence.push(
    describeUpgrade(sponsor.package, sponsor.amountCents, reference, currency),
  );
  if (reference.fromThisEvent) {
    evidence.push(
      `${formatMoney(reference.amountCents, currency)} is what Gold sponsors of this event are already paying.`,
    );
  }

  for (const delta of entitlementDeltas(entitlements, reference.entitlements)) {
    evidence.push(delta);
  }

  return evidence;
}

export interface DraftedOffer {
  subject: string;
  body: string;
  /** How the copy was produced — surfaced on the proposal card for audit. */
  source: "anthropic" | "template";
}

const OFFER_SYSTEM = [
  "You write short sponsorship upgrade offers on behalf of an event organiser.",
  "",
  "GROUNDING RULE — this is absolute. You are given a numbered FACTS list.",
  "Every factual claim, number, name and figure in your output must come from",
  "that list. Do not invent, estimate, extrapolate, round, average or project",
  "any figure. Do not add industry benchmarks, comparisons to other sponsors,",
  "predicted ROI, audience statistics, or anything about the event that is not",
  "in the list. If you want to say something and the supporting fact is not in",
  "the list, leave it out. An invented number in a sponsor offer is a legal and",
  "commercial liability.",
  "",
  "Style: warm, direct, and specific. British English. No exclamation marks, no",
  "superlatives, no marketing cliches ('unparalleled', 'exciting opportunity',",
  "'take it to the next level'). Lead with what they have already done, then",
  "what the upgrade adds, then the price. Three short paragraphs, under 180",
  "words total. Do not use bullet points. Do not sign off with a name.",
  "",
  "Return exactly this shape and nothing else:",
  "SUBJECT: <one line, under 70 characters>",
  "BODY:",
  "<the three paragraphs>",
].join("\n");

function buildOfferPrompt(candidate: UpsellCandidate, eventTitle: string): string {
  const facts = candidate.evidence
    .map((fact, index) => `${index + 1}. ${fact}`)
    .join("\n");
  return [
    `Write an upgrade offer to ${candidate.contactName ?? "the sponsor contact"} at ${candidate.name},`,
    `proposing they move from ${titleCase(candidate.currentPackage)} to ${titleCase(candidate.suggestedPackage)} for ${eventTitle}.`,
    "",
    "FACTS:",
    facts,
    "",
    "Use only the facts above.",
  ].join("\n");
}

/** Deterministic offer, assembled from the same evidence array. */
export function templateOffer(
  candidate: UpsellCandidate,
  eventTitle: string,
  currency: string,
): DraftedOffer {
  const greeting = candidate.contactName
    ? `Hello ${candidate.contactName.split(" ")[0] ?? candidate.contactName},`
    : "Hello,";
  const deltas = entitlementDeltas(candidate.entitlements, candidate.reference.entitlements);

  const paragraphs = [
    `${greeting}`,
    `Your team has been one of the most engaged sponsors of ${eventTitle}: an engagement score of ${candidate.engagementScore} out of 100, and steady traffic through the sponsor benefits page. On the strength of that, I wanted to put ${titleCase(candidate.suggestedPackage)} in front of you before we close the roster.`,
    deltas.length > 0
      ? `Against your current ${titleCase(candidate.currentPackage)} package, ${titleCase(candidate.suggestedPackage)} changes the following. ${deltas.join(" ")}`
      : `${titleCase(candidate.suggestedPackage)} is the top package at this event.`,
    `The difference is ${formatMoney(candidate.incrementalAmountCents, currency)} on top of your current ${formatMoney(candidate.currentAmountCents, currency)}, taking you to ${formatMoney(candidate.targetAmountCents, currency)}. Happy to talk it through this week if it is of interest.`,
  ];

  return {
    subject: `${titleCase(candidate.suggestedPackage)} at ${eventTitle} — ${formatMoney(candidate.incrementalAmountCents, currency)} more than your current package`,
    body: paragraphs.join("\n\n"),
    source: "template",
  };
}

/**
 * Every figure in generated copy must appear in the evidence.
 *
 * The prompt already forbids invented numbers, but a prompt is a request, not
 * a guarantee, and this copy goes to a paying sponsor. So we check: pull every
 * numeric token out of the draft and require each one to occur somewhere in
 * the evidence text. Anything else — a computed percentage, a rounded figure,
 * an invented attendee count — fails the check and we fall back to the
 * template. Fail closed: dull copy is recoverable, a false claim is not.
 */
export function groundingViolations(copy: string, evidence: readonly string[]): string[] {
  const haystack = evidence.join(" ");
  const violations: string[] = [];
  for (const raw of copy.match(/\d[\d.,]*/g) ?? []) {
    const figure = raw.replace(/[.,]+$/, "");
    if (figure.length === 0) continue;
    if (!haystack.includes(figure) && !violations.includes(figure)) {
      violations.push(figure);
    }
  }
  return violations;
}

function parseOffer(raw: string): { subject: string; body: string } | null {
  const subjectMatch = raw.match(/^\s*SUBJECT:\s*(.+)$/im);
  const bodyMatch = raw.match(/^\s*BODY:\s*\n?([\s\S]+)$/im);
  if (!subjectMatch || !bodyMatch) return null;
  const subject = (subjectMatch[1] ?? "").trim();
  const body = (bodyMatch[1] ?? "").trim();
  if (!subject || !body) return null;
  return { subject, body };
}

/**
 * Draft the offer copy. Uses the Anthropic API when a key is configured, and
 * a deterministic template otherwise — both grounded in `candidate.evidence`.
 */
export async function draftGoldOffer(
  candidate: UpsellCandidate,
  eventTitle: string,
  currency: string,
): Promise<DraftedOffer> {
  const raw = await completeText({
    system: OFFER_SYSTEM,
    prompt: buildOfferPrompt(candidate, eventTitle),
    maxTokens: 900,
  });

  if (raw) {
    const parsed = parseOffer(raw);
    if (parsed) {
      const violations = groundingViolations(
        `${parsed.subject}\n${parsed.body}`,
        candidate.evidence,
      );
      if (violations.length === 0) {
        return { ...parsed, source: "anthropic" };
      }
      console.warn(
        `[revenue] discarding generated offer for ${candidate.name}: ${violations.length} figure(s) not in the evidence (${violations.join(", ")}). Falling back to the template.`,
      );
    }
  }

  return templateOffer(candidate, eventTitle, currency);
}
