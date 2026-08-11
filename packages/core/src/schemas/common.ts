import { z } from "zod";

/**
 * Primitives shared by every contract. Feature agents import from here rather
 * than re-declaring — that is what keeps five parallel worktrees compatible.
 */

export const idSchema = z.string().min(1);
export const eventIdSchema = idSchema.describe("Event id");
export const orgIdSchema = idSchema.describe("Organisation id");

/** JSON columns. Recursive, so nested theme/agenda blobs type-check. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

/** Money is always minor units (cents) on the wire. Never floats. */
export const centsSchema = z.number().int();
export const currencySchema = z.string().length(3).default("EUR");

export const moneySchema = z.object({
  amountCents: centsSchema,
  currency: currencySchema,
});
export type Money = z.infer<typeof moneySchema>;

export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().nullish(),
});
export type Pagination = z.infer<typeof paginationSchema>;

export function pageOf<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative(),
  });
}

export const sortDirectionSchema = z.enum(["asc", "desc"]).default("desc");

export const dateRangeSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});

/** Standard mutation acknowledgement when there is nothing better to return. */
export const okSchema = z.object({
  ok: z.literal(true),
  id: idSchema.optional(),
});
export type Ok = z.infer<typeof okSchema>;

// ── Enum mirrors ──────────────────────────────────────────────
// Kept in lockstep with prisma/schema.prisma by hand, on purpose: importing
// @prisma/client into a client bundle drags the engine along with it.

export const userRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER"]);
export const eventStatusSchema = z.enum([
  "DRAFT",
  "PUBLISHED",
  "LIVE",
  "COMPLETED",
  "CANCELLED",
]);
export const guestSegmentSchema = z.enum([
  "VIP",
  "CLIENT",
  "PARTNER",
  "PRESS",
  "PROSPECT",
]);
export const noShowRiskSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const rsvpStatusSchema = z.enum([
  "INVITED",
  "CONFIRMED",
  "DECLINED",
  "WAITLISTED",
  "CHECKED_IN",
  "NO_SHOW",
]);
export const ticketTierStatusSchema = z.enum([
  "DRAFT",
  "ON_SALE",
  "SOLD_OUT",
  "CLOSED",
]);
export const orderStatusSchema = z.enum([
  "PENDING",
  "PAID",
  "REFUNDED",
  "FAILED",
  "CANCELLED",
]);
export const sponsorPackageSchema = z.enum(["GOLD", "SILVER", "CUSTOM"]);
export const sponsorStatusSchema = z.enum([
  "PROSPECT",
  "OFFERED",
  "SIGNED",
  "SERVICED",
]);
export const emailStatusSchema = z.enum([
  "PROPOSED",
  "APPROVED",
  "QUEUED",
  "SENT",
  "FAILED",
  "REJECTED",
]);
export const emailKindSchema = z.enum([
  "INVITE",
  "REMINDER",
  "CONFIRMATION",
  "RECOVERY",
  "SPONSOR_REPORT",
  "SPONSOR_OFFER",
  "ANNOUNCEMENT",
  "OTHER",
]);
export const agentActionStatusSchema = z.enum([
  "PROPOSED",
  "APPROVED",
  "EXECUTED",
  "REJECTED",
  "FAILED",
]);
export const actorKindSchema = z.enum(["AGENT", "USER", "SYSTEM"]);
export const actionRiskSchema = z.enum([
  "COSMETIC",
  "OPERATIONAL",
  "OUTBOUND",
  "DESTRUCTIVE",
]);
export const costCategorySchema = z.enum([
  "VENUE",
  "CATERING",
  "PRODUCTION",
  "STAFF",
  "MARKETING",
  "TRAVEL",
  "OTHER",
]);
export const chatRoleSchema = z.enum(["USER", "ASSISTANT", "TOOL"]);

export type UserRoleT = z.infer<typeof userRoleSchema>;
export type EventStatusT = z.infer<typeof eventStatusSchema>;
export type GuestSegmentT = z.infer<typeof guestSegmentSchema>;
export type NoShowRiskT = z.infer<typeof noShowRiskSchema>;
export type RsvpStatusT = z.infer<typeof rsvpStatusSchema>;
export type TicketTierStatusT = z.infer<typeof ticketTierStatusSchema>;
export type OrderStatusT = z.infer<typeof orderStatusSchema>;
export type SponsorPackageT = z.infer<typeof sponsorPackageSchema>;
export type SponsorStatusT = z.infer<typeof sponsorStatusSchema>;
export type EmailStatusT = z.infer<typeof emailStatusSchema>;
export type EmailKindT = z.infer<typeof emailKindSchema>;
export type AgentActionStatusT = z.infer<typeof agentActionStatusSchema>;
export type ActorKindT = z.infer<typeof actorKindSchema>;
export type ActionRiskT = z.infer<typeof actionRiskSchema>;
export type CostCategoryT = z.infer<typeof costCategorySchema>;
export type ChatRoleT = z.infer<typeof chatRoleSchema>;
