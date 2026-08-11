import type { PageSection } from "@ovation/core";
import { formatTime, machineDate } from "~/lib/format";
import { Container, Section, SectionTitle } from "./layout";

/**
 * The page body.
 *
 * One component per section kind from pageSectionSchema. The switch below
 * branches on what a section IS, never on what theme it is wearing — there is
 * no `preset === "blacktie"` anywhere in this file, because the difference
 * between the two launch themes lives entirely in the custom properties these
 * components read.
 */

export function SectionRenderer({
  section,
  timezone,
  hasProgramme,
}: {
  section: PageSection;
  timezone: string;
  /** The hero only offers a jump link to a section that exists. */
  hasProgramme: boolean;
}) {
  switch (section.kind) {
    case "hero":
      return <Hero section={section} hasProgramme={hasProgramme} />;
    case "keyFacts":
      return <KeyFacts section={section} />;
    case "programme":
      return <Programme section={section} timezone={timezone} />;
    case "sponsors":
      return <Sponsors section={section} />;
    case "practical":
      return <Practical section={section} />;
    case "consent":
      return <Consent section={section} />;
  }
}

type Of<K extends PageSection["kind"]> = Extract<PageSection, { kind: K }>;

function Hero({
  section,
  hasProgramme,
}: {
  section: Of<"hero">;
  hasProgramme: boolean;
}) {
  return (
    <section id="top" className="relative overflow-hidden border-b border-ev-line">
      {/* The hero image is optional and decorative; the words carry the page. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-30"
        style={{ backgroundImage: "var(--ev-hero-image)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, var(--ev-scrim), var(--ev-bg) 92%)",
        }}
      />
      <Container className="relative py-hero">
        {section.kicker ? (
          <p className="ev-kicker text-ev-accent-text">{section.kicker}</p>
        ) : null}
        <h1 className="ev-display mt-6 text-hero">{section.title}</h1>
        {section.subtitle ? (
          <p className="mt-8 max-w-prose text-lede text-ev-ink-muted">
            {section.subtitle}
          </p>
        ) : null}
        <div className="mt-10 flex flex-wrap items-center gap-3">
          {section.ctaHref && section.ctaLabel ? (
            <a className="ev-button" href={section.ctaHref}>
              {section.ctaLabel}
            </a>
          ) : null}
          {hasProgramme ? (
            <a className="ev-button ev-button-quiet" href="#programme">
              See the programme
            </a>
          ) : null}
        </div>
      </Container>
    </section>
  );
}

function KeyFacts({ section }: { section: Of<"keyFacts"> }) {
  return (
    <Section id="facts" className="border-b border-ev-line">
      <Container className="py-12">
        <h2 id="facts-title" className="sr-only">
          Key facts
        </h2>
        <dl className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {section.facts.map((fact) => (
            <div key={fact.label}>
              <dt className="ev-kicker text-ev-ink-muted">{fact.label}</dt>
              <dd className="mt-3 text-base leading-relaxed text-ev-ink">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </Container>
    </Section>
  );
}

function Programme({
  section,
  timezone,
}: {
  section: Of<"programme">;
  timezone: string;
}) {
  return (
    <Section id="programme">
      <Container className="py-section">
        <SectionTitle id="programme" kicker="The evening">
          Programme
        </SectionTitle>
        <ol className="space-y-px">
          {section.items.map((item) => (
            <li
              key={item.id}
              className="grid gap-2 border-t border-ev-line py-7 sm:grid-cols-[10rem_1fr] sm:gap-8"
            >
              <p className="text-sm tabular-nums text-ev-accent-text">
                <time dateTime={machineDate(item.startsAt)}>
                  {formatTime(item.startsAt, timezone)}
                </time>
                {item.endsAt ? (
                  <>
                    <span aria-hidden="true">–</span>
                    <span className="sr-only"> to </span>
                    <time dateTime={machineDate(item.endsAt)}>
                      {formatTime(item.endsAt, timezone)}
                    </time>
                  </>
                ) : null}
              </p>
              <div>
                <h3 className="text-xl leading-snug">{item.title}</h3>
                {item.speaker ? (
                  <p className="mt-2 text-base text-ev-ink-muted">
                    {item.speaker}
                  </p>
                ) : null}
                {item.description ? (
                  <p className="mt-3 max-w-prose text-base leading-relaxed text-ev-ink-muted">
                    {item.description}
                  </p>
                ) : null}
                {item.room ? (
                  <p className="mt-3 text-sm text-ev-ink-muted">{item.room}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  );
}

function Sponsors({ section }: { section: Of<"sponsors"> }) {
  return (
    <Section id="partners" className="border-t border-ev-line bg-ev-surface">
      <Container className="py-section">
        <SectionTitle id="partners" kicker="With the support of">
          Partners
        </SectionTitle>
        <div className="space-y-12">
          {section.tiers.map((tier) => (
            <div key={tier.label}>
              <h3 className="ev-kicker text-ev-ink-muted">{tier.label}</h3>
              <ul className="mt-5 flex flex-wrap gap-4">
                {tier.sponsors.map((sponsor) => (
                  <li
                    key={sponsor.name}
                    className="flex min-h-[5rem] min-w-[12rem] flex-1 items-center justify-center rounded-ev border border-ev-line-soft bg-ev-surface-2 px-7 py-5"
                  >
                    {sponsor.logoUrl ? (
                      <img
                        src={sponsor.logoUrl}
                        alt={sponsor.name}
                        loading="lazy"
                        decoding="async"
                        className="max-h-10 w-auto"
                      />
                    ) : (
                      /* No logo on file: set the name instead of showing a
                         broken image. It is a wordmark, and it is legible. */
                      <span className="ev-display text-lg">{sponsor.name}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Container>
    </Section>
  );
}

function Practical({ section }: { section: Of<"practical"> }) {
  return (
    <Section id="practical" className="border-t border-ev-line">
      <Container className="py-section">
        <SectionTitle id="practical" kicker="Before you come">
          Practical information
        </SectionTitle>
        <div className="grid gap-10 sm:grid-cols-2">
          {section.blocks.map((block) => (
            <div key={block.title}>
              <h3 className="text-xl">{block.title}</h3>
              <p className="mt-3 max-w-prose text-base leading-relaxed text-ev-ink-muted">
                {block.body}
              </p>
            </div>
          ))}
        </div>
      </Container>
    </Section>
  );
}

function Consent({ section }: { section: Of<"consent"> }) {
  return (
    <Section id="data" className="border-t border-ev-line">
      <Container className="py-16">
        <div className="rounded-ev border border-ev-line bg-ev-surface p-7 sm:p-9">
          <h2 id="data-title" className="ev-kicker text-ev-accent-text">
            Your data
          </h2>
          <p className="mt-4 max-w-prose text-base leading-relaxed text-ev-ink-muted">
            {section.text}
          </p>
        </div>
      </Container>
    </Section>
  );
}
