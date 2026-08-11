import { z } from "zod";
import { guestSegmentSchema, idSchema } from "./common";

/**
 * Event-day operations (implemented in apps/live).
 *
 * The check-in path is the one place in the product with a hard latency budget
 * (<2.5s per scan) and an offline requirement, so the contract carries the
 * client's idempotency key and an explicit "already checked in" outcome rather
 * than an error — a replayed offline queue must be safe to apply twice.
 */

export const qrTokenPayloadSchema = z.object({
  gid: idSchema.describe("guestId"),
  eid: idSchema.describe("eventId"),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type QrTokenPayload = z.infer<typeof qrTokenPayloadSchema>;

export const checkinInput = z.object({
  eventId: idSchema,
  /** Signed JWT from the registration QR. Preferred path. */
  token: z.string().optional(),
  /** Manual door-list fallback when a guest lost their code. */
  guestId: idSchema.optional(),
  lane: z.string().default("main"),
  deviceId: z.string().optional(),
  /** Client-generated, stable across retries — makes replay idempotent. */
  idempotencyKey: z.string().min(1),
  /** True when replayed from the IndexedDB queue after a dead-zone. */
  offlineSynced: z.boolean().default(false),
  /** When the scan actually happened, not when it reached us. */
  scannedAt: z.coerce.date().optional(),
});

export const checkinOutcomeSchema = z.enum([
  "CHECKED_IN",
  "ALREADY_CHECKED_IN",
  "REJECTED_INVALID_TOKEN",
  "REJECTED_EXPIRED",
  "REJECTED_WRONG_EVENT",
  "REJECTED_UNKNOWN_GUEST",
]);
export type CheckinOutcome = z.infer<typeof checkinOutcomeSchema>;

export const checkinOutput = z.object({
  outcome: checkinOutcomeSchema,
  guest: z
    .object({
      id: idSchema,
      name: z.string(),
      company: z.string().nullable(),
      segment: guestSegmentSchema,
      plusOnes: z.number().int().nonnegative(),
      dietary: z.string().nullable(),
      /** Shown to the greeter for VIPs. */
      whiteGloveNotes: z.array(z.string()).default([]),
      conversationOpener: z.string().nullable(),
    })
    .nullable(),
  checkedInAt: z.coerce.date().nullable(),
  lane: z.string().nullable(),
});

// ── live.ops ──────────────────────────────────────────────────

export const opsSnapshotInput = z.object({ eventId: idSchema });

export const opsSnapshotOutput = z.object({
  eventId: idSchema,
  capacity: z.number().int(),
  expected: z.number().int(),
  checkedIn: z.number().int(),
  capacityPercent: z.number().min(0),
  vipsExpected: z.number().int(),
  vipsArrived: z.number().int(),
  arrivalsPer15Min: z.array(
    z.object({ bucketStart: z.coerce.date(), count: z.number().int() }),
  ),
  byLane: z.array(z.object({ lane: z.string(), count: z.number().int() })),
});
export type OpsSnapshot = z.infer<typeof opsSnapshotOutput>;

// ── live.feed (subscription) ──────────────────────────────────

export const liveEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("CHECKIN"),
    at: z.coerce.date(),
    guestId: idSchema,
    name: z.string(),
    company: z.string().nullable(),
    segment: guestSegmentSchema,
    lane: z.string(),
  }),
  z.object({
    kind: z.literal("VIP_ARRIVAL"),
    at: z.coerce.date(),
    guestId: idSchema,
    name: z.string(),
    company: z.string().nullable(),
    notes: z.array(z.string()),
    conversationOpener: z.string().nullable(),
    hostAssigned: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("ANNOUNCEMENT"),
    at: z.coerce.date(),
    announcementId: idSchema,
    title: z.string().nullable(),
    body: z.string(),
  }),
  z.object({
    kind: z.literal("COUNTER"),
    at: z.coerce.date(),
    checkedIn: z.number().int(),
    capacityPercent: z.number(),
  }),
  z.object({
    kind: z.literal("CUE"),
    at: z.coerce.date(),
    agentActionId: idSchema,
    summary: z.string(),
    auto: z.boolean(),
  }),
]);
export type LiveEvent = z.infer<typeof liveEventSchema>;

export const liveFeedInput = z.object({
  eventId: idSchema,
  /** Resume point so a reconnect does not lose events. */
  since: z.coerce.date().optional(),
});

// ── live.announce ─────────────────────────────────────────────

export const announceInput = z.object({
  eventId: idSchema,
  title: z.string().max(120).optional(),
  body: z.string().min(1).max(2000),
  channels: z.array(z.enum(["guest-app", "host", "screens"])).min(1),
});

export const announceOutput = z.object({
  announcementId: idSchema,
  deliveredCount: z.number().int().nonnegative(),
  sentAt: z.coerce.date(),
});

// ── live.matchmaking (host companion) ─────────────────────────

export const matchmakingInput = z.object({
  eventId: idSchema,
  guestId: idSchema.optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export const matchmakingOutput = z.object({
  matches: z.array(
    z.object({
      guestId: idSchema,
      name: z.string(),
      company: z.string().nullable(),
      segment: guestSegmentSchema,
      score: z.number().min(0).max(1),
      reasons: z.array(z.string()),
      /** Set when the match exists because a sponsor wants this account. */
      sponsorId: idSchema.nullable(),
      introduced: z.boolean(),
    }),
  ),
});

export const markIntroducedInput = z.object({
  eventId: idSchema,
  guestId: idSchema,
  withGuestId: idSchema,
});

// ── cue engine ────────────────────────────────────────────────

export const cueTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CAPACITY_PERCENT"), percent: z.number() }),
  z.object({
    type: z.literal("VIP_LATE"),
    minutesAfterDoors: z.number().int(),
  }),
  z.object({ type: z.literal("AGENDA_ITEM_DUE"), itemId: idSchema }),
  z.object({ type: z.literal("ARRIVAL_RATE_DROP"), percent: z.number() }),
]);

export const cueSchema = z.object({
  id: idSchema,
  eventId: idSchema,
  label: z.string(),
  trigger: cueTriggerSchema,
  /** Proposes an AgentAction unless explicitly whitelisted as auto. */
  auto: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type Cue = z.infer<typeof cueSchema>;
