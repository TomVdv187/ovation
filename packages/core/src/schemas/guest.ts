import { z } from "zod";
import {
  guestSegmentSchema,
  idSchema,
  noShowRiskSchema,
  pageOf,
  paginationSchema,
  rsvpStatusSchema,
} from "./common";

/**
 * Guest intelligence contract (owned in implementation by packages/guests).
 *
 * Two design rules the Oracle must honour and consumers may rely on:
 *  - every score ships with its top-3 factors (explainable, deterministic);
 *  - risk ships with a recommended recovery action, so the UI never has to
 *    invent one. Swapping the rule engine for an ML model must not change
 *    these shapes.
 */

export const engagementFactorSchema = z.object({
  factor: z.string(),
  weight: z.number(),
  detail: z.string(),
});
export type EngagementFactor = z.infer<typeof engagementFactorSchema>;

export const recoveryActionKindSchema = z.enum([
  "RECONFIRMATION_EMAIL",
  "PERSONAL_CALL",
  "SEAT_SWAP_WAITLIST",
  "NONE",
]);

export const recoveryActionSchema = z.object({
  action: recoveryActionKindSchema,
  reason: z.string(),
  dueBy: z.coerce.date().nullish(),
});
export type RecoveryAction = z.infer<typeof recoveryActionSchema>;

export const whiteGloveSchema = z.object({
  transport: z.string().nullish(),
  seating: z.string().nullish(),
  dietary: z.string().nullish(),
  host: z.string().nullish(),
  done: z.array(z.string()).default([]),
});
export type WhiteGlove = z.infer<typeof whiteGloveSchema>;

export const guestSchema = z.object({
  id: idSchema,
  eventId: idSchema,
  name: z.string(),
  email: z.string().email(),
  company: z.string().nullable(),
  title: z.string().nullable(),
  segment: guestSegmentSchema,
  rsvpStatus: rsvpStatusSchema,
  engagementScore: z.number().int().min(0).max(100),
  engagementFactors: z.array(engagementFactorSchema).default([]),
  noShowRisk: noShowRiskSchema,
  noShowProbability: z.number().min(0).max(1).nullable(),
  recoveryAction: recoveryActionSchema.nullable(),
  dietary: z.string().nullable(),
  plusOnes: z.number().int().nonnegative(),
  interests: z.array(z.string()),
  notes: z.string().nullable(),
  whiteGlove: whiteGloveSchema.nullable(),
  source: z.string(),
  emailOpens: z.number().int().nonnegative(),
  emailClicks: z.number().int().nonnegative(),
  pageVisits: z.number().int().nonnegative(),
  lastSeenAt: z.coerce.date().nullable(),
  registeredAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Guest = z.infer<typeof guestSchema>;

// ── guests.list ───────────────────────────────────────────────

export const guestListInput = paginationSchema.extend({
  eventId: idSchema,
  segment: guestSegmentSchema.optional(),
  rsvpStatus: rsvpStatusSchema.optional(),
  noShowRisk: noShowRiskSchema.optional(),
  search: z.string().optional(),
  sortBy: z
    .enum(["name", "engagementScore", "noShowProbability", "createdAt"])
    .default("engagementScore"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export const guestListOutput = pageOf(guestSchema);

export const guestGetInput = z.object({ id: idSchema });

// ── guests.score ──────────────────────────────────────────────

export const guestScoreInput = z.object({
  eventId: idSchema,
  /** Omit to rescore the whole event. */
  guestIds: z.array(idSchema).optional(),
  persist: z.boolean().default(true),
});

export const guestScoreResultSchema = z.object({
  guestId: idSchema,
  engagementScore: z.number().int().min(0).max(100),
  factors: z.array(engagementFactorSchema).max(3),
  noShowRisk: noShowRiskSchema,
  noShowProbability: z.number().min(0).max(1),
  recoveryAction: recoveryActionSchema,
});
export type GuestScoreResult = z.infer<typeof guestScoreResultSchema>;

export const guestScoreOutput = z.object({
  results: z.array(guestScoreResultSchema),
  /** Which engine produced this — "rules-v1" today, a model id later. */
  engine: z.string(),
});

// ── guests.segment ────────────────────────────────────────────

export const guestSegmentInput = z.object({
  eventId: idSchema,
  guestIds: z.array(idSchema).optional(),
  /** Organiser overrides always win over inference. */
  overrides: z
    .array(z.object({ guestId: idSchema, segment: guestSegmentSchema }))
    .default([]),
});

export const guestSegmentOutput = z.object({
  assignments: z.array(
    z.object({
      guestId: idSchema,
      segment: guestSegmentSchema,
      reason: z.string(),
      overridden: z.boolean(),
    }),
  ),
});

// ── guests.personaliseInvite ──────────────────────────────────

export const campaignIntentSchema = z.enum([
  "INVITE",
  "REMINDER",
  "RECOVERY",
  "VIP_UPGRADE",
  "WAITLIST_PROMOTION",
]);

export const personaliseInviteInput = z.object({
  eventId: idSchema,
  guestIds: z.array(idSchema).min(1).max(500),
  intent: campaignIntentSchema,
  /** Organiser steer, e.g. "mention the rooftop dinner". Never invents facts. */
  brief: z.string().max(2000).optional(),
  campaignId: z.string().optional(),
});

export const personalisedEmailSchema = z.object({
  guestId: idSchema,
  emailMessageId: idSchema.nullable(),
  subject: z.string().max(120),
  body: z.string(),
  /** Facts from the guest record the copy leans on — used by the eval. */
  groundedOn: z.array(z.string()).default([]),
});
export type PersonalisedEmail = z.infer<typeof personalisedEmailSchema>;

export const personaliseInviteOutput = z.object({
  campaignId: z.string(),
  emails: z.array(personalisedEmailSchema),
  /** Every message lands as EmailMessage PROPOSED. The Conductor sends. */
  status: z.literal("PROPOSED"),
});

// ── guests.waitlistSuggestions ────────────────────────────────

export const waitlistSuggestionsInput = z.object({ eventId: idSchema });

export const waitlistSuggestionsOutput = z.object({
  capacity: z.number().int(),
  confirmed: z.number().int(),
  predictedAttending: z.number().int(),
  freeSeats: z.number().int(),
  promote: z.array(
    z.object({
      guestId: idSchema,
      name: z.string(),
      reason: z.string(),
      rank: z.number().int(),
    }),
  ),
});

// ── guests.vipChecklist ───────────────────────────────────────

export const vipChecklistInput = z.object({ eventId: idSchema });

export const vipChecklistOutput = z.object({
  guests: z.array(
    z.object({
      guestId: idSchema,
      name: z.string(),
      company: z.string().nullable(),
      whiteGlove: whiteGloveSchema,
      outstanding: z.array(z.string()),
    }),
  ),
});
