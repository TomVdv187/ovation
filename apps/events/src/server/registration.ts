import { db, type Prisma } from "@ovation/core/db";
import { validateRegistration } from "../lib/registration-form";
import { parseTheme } from "../lib/theme";
import { sendEmail, type EmailAttachment } from "./email";
import { renderConfirmationEmail } from "./emails/confirmation";
import {
  eventsBaseUrl,
  findPublicEvent,
  parseRegistrationConfig,
  seatsTaken,
} from "./event";
import { buildIcs } from "./ics";
import { qrPng } from "./qr-image";
import { signQrToken, ticketExpiry } from "./qr-token";

/**
 * Registration.
 *
 * Three things this path has to get right, in order of how much they hurt when
 * they go wrong:
 *
 *   1. Never seat more people than the room holds. The seat count is taken
 *      under a row lock on the Event, so two people racing for the last chair
 *      see each other rather than both winning.
 *   2. Never explode on a returning guest. Guest is unique on (eventId, email),
 *      so re-registering updates the existing row — people do come back to
 *      change a dietary requirement or add a partner.
 *   3. Never silently swallow the confirmation. With no RESEND_API_KEY the mail
 *      is printed to the console instead of sent, which is what makes a fresh
 *      clone able to complete a registration offline.
 */

export type RegisterOutcome =
  | {
      ok: true;
      status: "CONFIRMED" | "WAITLISTED" | "CHECKED_IN";
      guestId: string;
      /** Null on the waiting list — there is nothing to check in with yet. */
      token: string | null;
      returning: boolean;
      emailDelivered: boolean;
    }
  | { ok: false; errors: Record<string, string>; formError: string | null };

/** rsvpStatuses that occupy a chair. */
const SEATED = ["CONFIRMED", "CHECKED_IN"] as const;

export async function register(
  slug: string,
  raw: Record<string, string>,
): Promise<RegisterOutcome> {
  const event = await findPublicEvent(slug);
  if (!event) {
    return {
      ok: false,
      errors: {},
      formError: "This event is not open for registration.",
    };
  }

  const config = parseRegistrationConfig(event.registrationConfig);
  const { values, errors } = validateRegistration(config, raw);
  if (!values) return { ok: false, errors, formError: null };

  const now = new Date();
  const notes =
    values.extra.length > 0
      ? values.extra.map((e) => `${e.label}: ${e.value}`).join("\n")
      : null;

  let outcome: {
    status: "CONFIRMED" | "WAITLISTED" | "CHECKED_IN";
    guestId: string;
    returning: boolean;
  };

  try {
    outcome = await db.$transaction(async (tx) => {
      // Serialises registrations for THIS event only. Without it the seat count
      // below is a read-then-write and the last chair can be sold twice.
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${event.id} FOR UPDATE`;

      const existing = await tx.guest.findUnique({
        where: { eventId_email: { eventId: event.id, email: values.email } },
        select: {
          id: true,
          rsvpStatus: true,
          plusOnes: true,
          registeredAt: true,
          notes: true,
        },
      });

      const taken = await seatsTaken(event.id, tx);
      const alreadySeated =
        existing && (SEATED as readonly string[]).includes(existing.rsvpStatus)
          ? 1 + existing.plusOnes
          : 0;
      const free = event.capacity - (taken - alreadySeated);
      const requested = 1 + values.plusOnes;

      let status: "CONFIRMED" | "WAITLISTED" | "CHECKED_IN";
      if (existing?.rsvpStatus === "CHECKED_IN") {
        // Already through the door. Nothing about a form resubmission undoes that.
        status = "CHECKED_IN";
      } else if (requested <= free) {
        status = "CONFIRMED";
      } else if (config.waitlistWhenFull) {
        status = "WAITLISTED";
      } else {
        throw new CapacityError();
      }

      const data = {
        name: values.name,
        company: values.company,
        title: values.title,
        dietary: values.dietary,
        plusOnes: values.plusOnes,
        rsvpStatus: status,
        source: "registration",
        lastSeenAt: now,
        ...(notes ? { notes } : {}),
      } satisfies Prisma.GuestUpdateInput;

      const guest = existing
        ? await tx.guest.update({
            where: { id: existing.id },
            data: {
              ...data,
              // The first registration is the one worth remembering.
              registeredAt: existing.registeredAt ?? now,
            },
            select: { id: true },
          })
        : await tx.guest.create({
            data: {
              ...data,
              eventId: event.id,
              email: values.email,
              registeredAt: now,
            },
            select: { id: true },
          });

      // A conversion is someone arriving at a registered state from outside
      // one. Re-submitting the form is not a second conversion.
      const wasRegistered =
        existing !== null &&
        ["CONFIRMED", "WAITLISTED", "CHECKED_IN"].includes(existing.rsvpStatus);
      if (!wasRegistered) {
        await tx.event.update({
          where: { id: event.id },
          data: { rsvpConversions: { increment: 1 } },
        });
      }

      return { status, guestId: guest.id, returning: existing !== null };
    });
  } catch (cause) {
    if (cause instanceof CapacityError) {
      return {
        ok: false,
        errors: {},
        formError:
          "The room is full and the organiser has closed the waiting list.",
      };
    }
    throw cause;
  }

  const seated = outcome.status !== "WAITLISTED";
  const token = seated
    ? signQrToken({
        guestId: outcome.guestId,
        eventId: event.id,
        expiresAt: ticketExpiry(event.date, event.endsAt),
        issuedAt: now,
      })
    : null;

  const emailDelivered = await sendConfirmation({
    event,
    guestId: outcome.guestId,
    guest: {
      name: values.name,
      email: values.email,
      plusOnes: values.plusOnes,
      dietary: values.dietary,
    },
    waitlisted: !seated,
    token,
  });

  return {
    ok: true,
    status: outcome.status,
    guestId: outcome.guestId,
    token,
    returning: outcome.returning,
    emailDelivered,
  };
}

class CapacityError extends Error {}

interface ConfirmationInput {
  event: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    date: Date;
    endsAt: Date | null;
    timezone: string;
    venue: string;
    venueAddress: string | null;
    theme: Prisma.JsonValue;
  };
  guestId: string;
  guest: {
    name: string;
    email: string;
    plusOnes: number;
    dietary: string | null;
  };
  waitlisted: boolean;
  token: string | null;
}

/**
 * Sends (or prints) the confirmation and records it as an EmailMessage, so the
 * console's communication log shows what the guest actually received.
 * Failures here never fail the registration — the seat is already theirs.
 */
export async function sendConfirmation(
  input: ConfirmationInput,
): Promise<boolean> {
  const { event, guest, token } = input;
  const base = eventsBaseUrl();
  const eventUrl = `${base}/e/${event.slug}`;
  const ticketUrl = token
    ? `${eventUrl}/ticket?t=${encodeURIComponent(token)}`
    : eventUrl;

  try {
    const { subject, html, text } = renderConfirmationEmail({
      event,
      theme: parseTheme(event.theme),
      guest: {
        name: guest.name,
        plusOnes: guest.plusOnes,
        dietary: guest.dietary,
      },
      waitlisted: input.waitlisted,
      ticketUrl,
      eventUrl,
      token: token ?? "",
    });

    const attachments: EmailAttachment[] = [
      {
        filename: `${event.slug}.ics`,
        content: Buffer.from(
          buildIcs({
            uid: `${event.id}.${input.guestId}@ovation`,
            title: event.title,
            description: event.description,
            location: event.venueAddress
              ? `${event.venue}, ${event.venueAddress}`
              : event.venue,
            start: event.date,
            end: event.endsAt,
            url: eventUrl,
          }),
          "utf8",
        ),
        contentType: "text/calendar; charset=utf-8; method=PUBLISH",
      },
    ];

    if (token) {
      attachments.push({
        filename: "check-in-code.png",
        content: await qrPng(token),
        contentType: "image/png",
      });
    }

    const result = await sendEmail({
      to: guest.email,
      subject,
      html,
      text,
      attachments,
    });

    await db.emailMessage.create({
      data: {
        eventId: event.id,
        guestId: input.guestId,
        kind: "CONFIRMATION",
        subject,
        body: text,
        personalised: false,
        status: result.delivered ? "SENT" : result.error ? "FAILED" : "QUEUED",
        providerMessageId: result.providerMessageId,
        sentAt: result.delivered ? new Date() : null,
        error: result.error,
      },
    });

    return result.delivered;
  } catch (cause) {
    console.error(
      "[registration] confirmation email failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return false;
  }
}
