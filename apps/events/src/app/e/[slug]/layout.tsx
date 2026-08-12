import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Container, SkipLink } from "~/components/layout";
import { formatDateShort } from "~/lib/format";
import { themeCss, themeGround } from "~/lib/theme";
import { eventsBaseUrl } from "~/server/event";
import { getPage } from "~/server/page-data";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

/**
 * The themed shell.
 *
 * The theme is written into the document as a :root rule rather than an inline
 * style on a wrapper, so <body> and the browser's overscroll area are painted
 * too — a page that shows the console's black past the last section is not
 * themed. It is server-rendered, so there is no unstyled flash to cover up.
 */
export default async function EventLayout({
  children,
  params,
}: RouteParams & { children: ReactNode }) {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) notFound();

  const cta = page.ticketTiersAvailable
    ? { href: `/e/${slug}/tickets`, label: "Tickets" }
    : { href: `/e/${slug}/register`, label: "Register" };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeCss(page.theme) }} />
      <SkipLink />

      <header
        className="sticky top-0 z-30 border-b border-ev-line"
        style={{
          background: "var(--ev-scrim)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <Container className="flex min-h-16 items-center justify-between gap-4 py-3">
          {/* min-w-0 is load-bearing: without it the nowrap from `truncate`
              becomes the flex item's minimum width and a long event title
              pushes the whole document wider than a phone. */}
          <a
            href={`/e/${slug}`}
            className="ev-display min-w-0 truncate text-base sm:text-lg"
          >
            {page.event.title}
          </a>
          <a
            href={cta.href}
            className="ev-button min-h-11 shrink-0 px-5 py-2 text-sm"
          >
            {cta.label}
          </a>
        </Container>
      </header>

      <main id="main">{children}</main>

      <footer className="border-t border-ev-line">
        <Container className="flex flex-col gap-4 py-12 text-sm text-ev-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            {page.event.title} · {page.event.venue} ·{" "}
            {formatDateShort(page.event.date, page.event.timezone)}
          </p>
          <p>
            <a
              href={`/e/${slug}#data`}
              className="underline decoration-ev-edge underline-offset-4"
            >
              How we use your details
            </a>
          </p>
        </Container>
      </footer>
    </>
  );
}

export async function generateViewport({
  params,
}: RouteParams): Promise<Viewport> {
  const { slug } = await params;
  const page = await getPage(slug);
  return {
    themeColor: page ? themeGround(page.theme) : "#0d0d0d",
    colorScheme: "dark",
  };
}

export async function generateMetadata({
  params,
}: RouteParams): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) return { title: "Event not found" };

  const { event, theme } = page;
  const url = `${eventsBaseUrl()}/e/${slug}`;
  const description =
    event.description ??
    `${event.title} — ${event.venue}, ${formatDateShort(event.date, event.timezone)}.`;

  return {
    metadataBase: new URL(eventsBaseUrl()),
    title: { default: event.title, template: `%s — ${event.title}` },
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      title: event.title,
      description,
      siteName: event.title,
      locale: "en_GB",
      ...(theme.heroImage ? { images: [{ url: theme.heroImage }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: event.title,
      description,
    },
    // A draft or cancelled event should never be indexed.
    robots:
      event.status === "PUBLISHED" || event.status === "LIVE"
        ? { index: true, follow: true }
        : { index: false, follow: false },
  };
}
