import Link from "next/link";

export const metadata = {
  title: "Not found",
  description: "That event page does not exist.",
};

/**
 * Unthemed on purpose: if we could not find the event, we do not have a theme
 * to render it in. Falls back to the OVATION chrome tokens.
 */
export default function NotFound() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-24"
    >
      <p className="ev-kicker text-gold">Ovation</p>
      <h1 className="mt-4 text-4xl">We cannot find that event</h1>
      <p className="mt-5 text-base leading-relaxed text-ink-muted">
        The link may have expired, or the organiser may not have published the
        page yet. If someone sent you here, ask them for a fresh link.
      </p>
      <p className="mt-8">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded border border-line px-5 text-sm"
        >
          See what is on
        </Link>
      </p>
    </main>
  );
}
