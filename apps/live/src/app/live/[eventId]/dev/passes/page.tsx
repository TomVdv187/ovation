import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { db } from "@ovation/core/db";
import { signQrToken } from "~/server/live/qr";

export const dynamic = "force-dynamic";

/**
 * A test sheet of scannable codes. **Development only.**
 *
 * Real issuance belongs to Agent 2 · MAISON at registration — this page exists
 * so the door can be exercised against something physical: valid codes, an
 * expired one, one minted for another event and one signed with the wrong
 * secret. The Critic will point a camera at the bottom four and expect four
 * different refusal screens.
 *
 * Refuses to render in production, because a page that mints door passes is
 * not a page you leave switched on.
 */
export default async function PassesPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { eventId } = await params;
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, title: true },
  });
  if (!event) notFound();

  const guests = await db.guest.findMany({
    where: { eventId, rsvpStatus: { in: ["CONFIRMED", "CHECKED_IN"] } },
    orderBy: [{ segment: "asc" }, { name: "asc" }],
    take: 12,
    select: {
      id: true,
      name: true,
      company: true,
      segment: true,
      checkIn: { select: { timestamp: true } },
    },
  });

  const valid = await Promise.all(
    guests.map(async (g) => ({
      key: g.id,
      caption: `${g.name}${g.checkIn ? " · already in" : ""}`,
      sub: [g.company, g.segment].filter(Boolean).join(" · "),
      svg: await qr(await signQrToken({ gid: g.id, eid: eventId })),
      tone: "ok" as const,
    })),
  );

  const someone = guests[0];
  const now = Math.floor(Date.now() / 1000);
  const wrongSecret = new TextEncoder().encode(
    "not-the-signing-secret-forged-by-a-scalper",
  );

  const rejects = someone
    ? await Promise.all([
        (async () => ({
          key: "expired",
          caption: "Expired",
          sub: "Valid signature, exp in the past → REJECTED_EXPIRED",
          svg: await qr(
            await signQrToken(
              { gid: someone.id, eid: eventId, ttlSeconds: 60 },
              { issuedAt: now - 7200 },
            ),
          ),
          tone: "bad" as const,
        }))(),
        (async () => ({
          key: "forged",
          caption: "Forged",
          sub: "Signed with the wrong secret → REJECTED_INVALID_TOKEN",
          svg: await qr(
            await signQrToken(
              { gid: someone.id, eid: eventId },
              { secret: wrongSecret },
            ),
          ),
          tone: "bad" as const,
        }))(),
        (async () => ({
          key: "wrong-event",
          caption: "Wrong event",
          sub: "Genuine signature, another event id → REJECTED_WRONG_EVENT",
          svg: await qr(
            await signQrToken({ gid: someone.id, eid: "some-other-event" }),
          ),
          tone: "bad" as const,
        }))(),
        (async () => ({
          key: "unknown",
          caption: "Unknown guest",
          sub: "Genuine signature, no such guest → REJECTED_UNKNOWN_GUEST",
          svg: await qr(
            await signQrToken({ gid: "guest-that-does-not-exist", eid: eventId }),
          ),
          tone: "bad" as const,
        }))(),
        (async () => ({
          key: "garbage",
          caption: "Not a token",
          sub: "Arbitrary QR content → REJECTED_INVALID_TOKEN",
          svg: await qr("https://example.com/not-a-jwt"),
          tone: "bad" as const,
        }))(),
      ])
    : [];

  return (
    <main className="min-h-screen bg-bg px-6 py-8 text-ink">
      <p className="text-xs uppercase tracking-[0.2em] text-gold">
        Development test sheet
      </p>
      <h1 className="ov-display mt-1 text-3xl">{event.title}</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        Point the door scanner at these. The top block are genuine passes; the
        bottom block are the four refusals plus a non-token, each of which must
        produce its own distinct screen.
      </p>

      <Section title="Genuine passes" cards={valid} />
      <Section title="Must be refused" cards={rejects} />
    </main>
  );
}

function Section({
  title,
  cards,
}: {
  title: string;
  cards: Array<{
    key: string;
    caption: string;
    sub: string;
    svg: string;
    tone: "ok" | "bad";
  }>;
}) {
  if (cards.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="text-xs uppercase tracking-[0.16em] text-ink-subtle">
        {title}
      </h2>
      <ul className="mt-3 grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => (
          <li
            key={c.key}
            className={`rounded border p-3 ${c.tone === "bad" ? "border-critical/50" : "border-line"} bg-surface`}
          >
            <div
              className="mx-auto w-full max-w-[180px] [&>svg]:h-auto [&>svg]:w-full"
              // qrcode emits a self-contained SVG string; nothing user-supplied
              // reaches it — the payload is a JWT we just minted.
              dangerouslySetInnerHTML={{ __html: c.svg }}
            />
            <p className="mt-2 truncate text-sm text-ink">{c.caption}</p>
            <p className="text-xs text-ink-subtle">{c.sub}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function qr(payload: string): Promise<string> {
  return QRCode.toString(payload, {
    type: "svg",
    margin: 1,
    color: { dark: "#0d0d0d", light: "#f5f3ee" },
    errorCorrectionLevel: "M",
  });
}
