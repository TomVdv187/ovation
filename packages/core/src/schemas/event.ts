import { z } from "zod";
import {
  centsSchema,
  currencySchema,
  eventStatusSchema,
  idSchema,
  jsonValueSchema,
} from "./common";

/**
 * The Event and its three JSON columns. `theme` is the important one: the whole
 * point is that flipping Event.theme restyles the public page with zero code
 * change, so every visual decision the page makes must be expressible here.
 */

export const themePresetSchema = z.enum(["classic", "blacktie"]);
export type ThemePreset = z.infer<typeof themePresetSchema>;

export const themePaletteSchema = z.object({
  bg: z.string(),
  surface: z.string(),
  ink: z.string(),
  inkMuted: z.string(),
  accent: z.string(),
  accentSoft: z.string(),
  line: z.string(),
});

export const themeTypographySchema = z.object({
  display: z.string().describe("CSS font stack for headings"),
  body: z.string().describe("CSS font stack for body copy"),
  displayWeight: z.number().int().min(100).max(900).default(400),
  tracking: z.enum(["tight", "normal", "wide"]).default("normal"),
});

export const eventThemeSchema = z.object({
  preset: themePresetSchema.default("classic"),
  palette: themePaletteSchema.partial().default({}),
  typography: themeTypographySchema.partial().default({}),
  dressCode: z.string().nullish(),
  heroImage: z.string().url().nullish(),
  /** Free-form direction the agent recorded when it proposed the theme. */
  notes: z.string().nullish(),
});
export type EventTheme = z.infer<typeof eventThemeSchema>;

export const agendaItemKindSchema = z.enum([
  "DOORS",
  "TALK",
  "PANEL",
  "BREAK",
  "DINNER",
  "NETWORKING",
  "CLOSE",
]);

export const agendaItemSchema = z.object({
  id: idSchema,
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullish(),
  title: z.string().min(1),
  description: z.string().nullish(),
  speaker: z.string().nullish(),
  room: z.string().nullish(),
  kind: agendaItemKindSchema.default("TALK"),
});
export type AgendaItem = z.infer<typeof agendaItemSchema>;

export const eventAgendaSchema = z.object({
  items: z.array(agendaItemSchema).default([]),
});
export type EventAgenda = z.infer<typeof eventAgendaSchema>;

export const registrationFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "email", "select", "checkbox", "textarea"]),
  required: z.boolean().default(false),
  options: z.array(z.string()).default([]),
});

export const registrationConfigSchema = z.object({
  fields: z.array(registrationFieldSchema).default([]),
  collectDietary: z.boolean().default(true),
  allowPlusOnes: z.boolean().default(true),
  maxPlusOnes: z.number().int().min(0).max(10).default(1),
  consentText: z.string().default(""),
  waitlistWhenFull: z.boolean().default(true),
});
export type RegistrationConfig = z.infer<typeof registrationConfigSchema>;

export const eventSchema = z.object({
  id: idSchema,
  organisationId: idSchema,
  title: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().nullable(),
  date: z.coerce.date(),
  endsAt: z.coerce.date().nullable(),
  timezone: z.string(),
  venue: z.string(),
  venueAddress: z.string().nullable(),
  capacity: z.number().int().positive(),
  currency: currencySchema,
  status: eventStatusSchema,
  theme: jsonValueSchema,
  agenda: jsonValueSchema,
  registrationConfig: jsonValueSchema,
  pageVisits: z.number().int().nonnegative(),
  rsvpConversions: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Event = z.infer<typeof eventSchema>;

// ── router IO ─────────────────────────────────────────────────

export const eventGetInput = z.object({
  id: idSchema.optional(),
  slug: z.string().optional(),
});

export const eventListInput = z.object({
  organisationId: idSchema.optional(),
  status: eventStatusSchema.optional(),
});

export const eventCreateInput = z.object({
  organisationId: idSchema,
  title: z.string().min(1),
  date: z.coerce.date(),
  venue: z.string().min(1),
  capacity: z.number().int().positive(),
  slug: z.string().min(1).optional(),
  timezone: z.string().default("Europe/Brussels"),
  currency: currencySchema,
});

export const eventUpdateInput = z.object({
  id: idSchema,
  title: z.string().min(1).optional(),
  description: z.string().nullish(),
  date: z.coerce.date().optional(),
  endsAt: z.coerce.date().nullish(),
  venue: z.string().optional(),
  venueAddress: z.string().nullish(),
  capacity: z.number().int().positive().optional(),
  status: eventStatusSchema.optional(),
  theme: eventThemeSchema.partial().optional(),
  agenda: eventAgendaSchema.optional(),
  registrationConfig: registrationConfigSchema.partial().optional(),
});

/** Dashboard header numbers. Cheap enough to fetch on every view. */
export const eventStatsSchema = z.object({
  eventId: idSchema,
  registrations: z.number().int().nonnegative(),
  capacity: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  waitlisted: z.number().int().nonnegative(),
  predictedShowRate: z.number().min(0).max(1),
  revenueCents: centsSchema,
  agentActionsToday: z.number().int().nonnegative(),
  pendingApprovals: z.number().int().nonnegative(),
});
export type EventStats = z.infer<typeof eventStatsSchema>;

export const registrationsOverTimeSchema = z.object({
  points: z.array(
    z.object({
      date: z.coerce.date(),
      registrations: z.number().int().nonnegative(),
      cumulative: z.number().int().nonnegative(),
    }),
  ),
});

// ── page router IO ────────────────────────────────────────────

export const pageSectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("hero"),
    kicker: z.string().nullish(),
    title: z.string(),
    subtitle: z.string().nullish(),
    ctaLabel: z.string().nullish(),
    ctaHref: z.string().nullish(),
  }),
  z.object({
    kind: z.literal("keyFacts"),
    facts: z.array(z.object({ label: z.string(), value: z.string() })),
  }),
  z.object({
    kind: z.literal("programme"),
    items: z.array(agendaItemSchema),
  }),
  z.object({
    kind: z.literal("sponsors"),
    tiers: z.array(
      z.object({
        label: z.string(),
        sponsors: z.array(
          z.object({ name: z.string(), logoUrl: z.string().nullish() }),
        ),
      }),
    ),
  }),
  z.object({
    kind: z.literal("practical"),
    blocks: z.array(z.object({ title: z.string(), body: z.string() })),
  }),
  z.object({
    kind: z.literal("consent"),
    text: z.string(),
  }),
]);
export type PageSection = z.infer<typeof pageSectionSchema>;

export const pageRenderInput = z.object({
  slug: z.string().min(1),
  preview: z.boolean().default(false),
});

/**
 * CC-003, amended. What is on sale, as the public may see it.
 *
 * The request asked for `tiers: ticketTierSchema[]`. That was rejected as
 * written: `page.render` is a publicProcedure, and `ticketTierSchema` carries
 * `quota` and `sold`, so it would publish this event's sell-through to anyone
 * who can load the page. `remaining` is the fact a buyer needs; `sold` is a
 * fact a competitor wants. The availability rules that used to live in
 * apps/events (`tierAvailability`) move into the contract here instead, which
 * is what the request was actually asking for.
 */
export const publicTicketTierSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  priceCents: centsSchema,
  currency: currencySchema,
  /** Seats left in this tier. Never negative. */
  remaining: z.number().int().nonnegative(),
  /** On sale, inside its window, and with seats left. */
  purchasable: z.boolean(),
  soldOut: z.boolean(),
  opensAt: z.coerce.date().nullable(),
  closesAt: z.coerce.date().nullable(),
});
export type PublicTicketTier = z.infer<typeof publicTicketTierSchema>;

export const pageRenderOutput = z.object({
  event: eventSchema,
  theme: eventThemeSchema,
  sections: z.array(pageSectionSchema),
  ticketTiersAvailable: z.boolean(),
  /** CC-003. Every tier on the event, in sort order — not only the buyable ones. */
  tiers: z.array(publicTicketTierSchema),
});
export type PageRender = z.infer<typeof pageRenderOutput>;

export const pageUpdateFromThemeInput = z.object({
  eventId: idSchema,
  theme: eventThemeSchema.partial(),
});
