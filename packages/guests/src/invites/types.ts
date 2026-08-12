import type { GuestSegmentT, RsvpStatusT } from "@ovation/core";

export type CampaignIntent =
  | "INVITE"
  | "REMINDER"
  | "RECOVERY"
  | "VIP_UPGRADE"
  | "WAITLIST_PROMOTION";

/**
 * The facts the writer is allowed to lean on. Anything not in here does not
 * exist as far as the copy is concerned — that is what the eval enforces.
 *
 * Every string field is attacker-controlled: a guest types their own name and
 * company into a public registration form. They are treated as data everywhere
 * downstream, never as instructions.
 */
export interface GuestFacts {
  id: string;
  name: string;
  email: string;
  company: string | null;
  title: string | null;
  segment: GuestSegmentT;
  rsvpStatus: RsvpStatusT;
  interests: string[];
  dietary: string | null;
  notes: string | null;
  plusOnes: number;
  emailOpens: number;
  emailClicks: number;
  pageVisits: number;
  lastSeenAt: Date | null;
  registeredAt: Date | null;
  /** Name of the ticket tier they bought, when they bought one. */
  ticketTier: string | null;
}

export interface AgendaHighlight {
  title: string;
  speaker?: string | null;
  room?: string | null;
}

export interface EventFacts {
  id: string;
  title: string;
  description: string | null;
  date: Date;
  endsAt: Date | null;
  timezone: string;
  venue: string;
  venueAddress: string | null;
  capacity: number;
  dressCode: string | null;
  /** The organisation the email is sent on behalf of, used for the sign-off. */
  organiser: string;
  agenda: AgendaHighlight[];
}

export interface WrittenEmail {
  subject: string;
  body: string;
  /** Short labels for the record facts the copy leans on, e.g. "interest: fintech". */
  groundedOn: string[];
}

export interface WriteRequest {
  guest: GuestFacts;
  event: EventFacts;
  intent: CampaignIntent;
  /** Organiser steer. May shape emphasis and tone; may not introduce new facts. */
  brief?: string;
  /** Populated on a retry with the reasons the previous attempt failed the checks. */
  retryHint?: string;
}

/**
 * The seam between "decide what to say" and "call a model".
 *
 * The eval and the unit tests drive the whole pipeline through a fake writer;
 * production passes the Anthropic-backed one. Nothing else in the package knows
 * a model exists.
 */
export interface InviteWriter {
  readonly model: string;
  write(request: WriteRequest): Promise<WrittenEmail>;
}
