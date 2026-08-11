import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "~/components/layout";
import { RegisterForm } from "~/components/register-form";
import { formatDateLong, formatTimeRange, timezoneLabel } from "~/lib/format";
import { buildFormFields } from "~/lib/registration-form";
import { parseRegistrationConfig, seatsTaken } from "~/server/event";
import { getPage } from "~/server/page-data";
import { DEFAULT_CONSENT_TEXT } from "~/server/sections";
import { registerAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Register",
  description: "Confirm your place.",
  robots: { index: false, follow: true },
};

/**
 * Registration.
 *
 * The form is built from Event.registrationConfig on the server — a different
 * event with a different field list gets a different form here with no code
 * change, the same way a different theme gets a different design.
 */
export default async function RegisterPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) notFound();

  const { event } = page;
  const config = parseRegistrationConfig(event.registrationConfig);
  const fields = buildFormFields(config);

  const taken = await seatsTaken(event.id);
  const free = Math.max(0, event.capacity - taken);
  const full = free <= 0;

  return (
    <Container className="py-16 sm:py-24">
      <div className="max-w-2xl">
        <p className="ev-kicker text-ev-accent-text">
          {full && config.waitlistWhenFull ? "Waiting list" : "Registration"}
        </p>
        <h1 className="ev-display mt-4 text-section">
          {full && config.waitlistWhenFull
            ? "The room is full"
            : "Confirm your place"}
        </h1>

        <p className="mt-6 text-lede text-ev-ink-muted">
          {event.title} · {formatDateLong(event.date, event.timezone)} ·{" "}
          {formatTimeRange(event.date, event.endsAt, event.timezone)}{" "}
          {timezoneLabel(event.date, event.timezone)} · {event.venue}
        </p>

        {full ? (
          <p className="mt-6 rounded-ev border border-ev-edge bg-ev-wash p-5 text-base leading-relaxed">
            {config.waitlistWhenFull
              ? "Every seat is taken. Leave your details and we will write the moment one frees up — people do drop out, and we work down the list in order."
              : "Every seat is taken and the organiser has closed the waiting list."}
          </p>
        ) : free <= 20 ? (
          <p className="mt-6 text-base text-ev-ink-muted">
            {free === 1 ? "One seat left." : `${free} seats left.`}
          </p>
        ) : null}

        {full && !config.waitlistWhenFull ? (
          <p className="mt-8">
            <a href={`/e/${slug}`} className="ev-button ev-button-quiet">
              Back to the event
            </a>
          </p>
        ) : (
          <RegisterForm
            action={registerAction}
            slug={slug}
            fields={fields}
            allowPlusOnes={config.allowPlusOnes}
            maxPlusOnes={config.maxPlusOnes}
            consentText={config.consentText.trim() || DEFAULT_CONSENT_TEXT}
            waitlisting={full}
          />
        )}
      </div>
    </Container>
  );
}
