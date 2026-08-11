import { timingSafeEqual } from "node:crypto";
import type { Context, SessionUser } from "@ovation/core";
import { db } from "@ovation/core/db";

/**
 * Who is holding the tablet.
 *
 * Three ways in, in priority order:
 *
 *  1. **Console session cookie.** The console (port 3000) and this app (3002)
 *     share a host, and cookies are not scoped by port, so an organiser who is
 *     signed in to the console is already signed in here. We read the Session
 *     row straight from the database rather than pulling next-auth into this
 *     bundle — the session strategy is "database", so the cookie is just a key.
 *
 *  2. **Door-device key.** A tablet wedged on a lectern cannot do a magic-link
 *     round trip, and a shared human login is worse. `LIVE_OPS_KEY` is a
 *     machine credential presented as `x-ovation-live-key`, compared in
 *     constant time, resolving to the organisation's owner. Unset by default;
 *     no key, no bypass.
 *
 *  3. **Development fallback.** With no session and no key, a non-production
 *     build resolves the seed organisation's owner so `pnpm dev` works on a
 *     fresh clone. Refused outright in production.
 */

const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

export async function createContext(headers: Headers): Promise<Context> {
  return { db, session: await resolveSession(headers), headers };
}

async function resolveSession(
  headers: Headers,
): Promise<{ user: SessionUser } | null> {
  const fromCookie = await sessionFromCookie(headers);
  if (fromCookie) return fromCookie;

  const fromKey = await sessionFromDeviceKey(headers);
  if (fromKey) return fromKey;

  if (process.env.NODE_ENV !== "production") {
    return devSession();
  }
  return null;
}

async function sessionFromCookie(
  headers: Headers,
): Promise<{ user: SessionUser } | null> {
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) return null;

  const jar = parseCookies(cookieHeader);
  const token = SESSION_COOKIE_NAMES.map((n) => jar.get(n)).find(Boolean);
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { sessionToken: token },
    select: {
      expires: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          organisationId: true,
          role: true,
        },
      },
    },
  });
  if (!session || session.expires.getTime() <= Date.now()) return null;

  return { user: session.user };
}

async function sessionFromDeviceKey(
  headers: Headers,
): Promise<{ user: SessionUser } | null> {
  const expected = process.env.LIVE_OPS_KEY;
  if (!expected) return null;

  const presented = headers.get("x-ovation-live-key");
  if (!presented || !constantTimeEquals(presented, expected)) return null;

  const user = await ownerUser();
  if (!user) {
    console.warn("[live] LIVE_OPS_KEY accepted but no organisation owner exists.");
    return null;
  }
  return { user };
}

async function devSession(): Promise<{ user: SessionUser } | null> {
  const user = await ownerUser();
  if (!user) return null;
  return { user };
}

async function ownerUser(): Promise<SessionUser | null> {
  const user = await db.user.findFirst({
    where: { organisationId: { not: null } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      organisationId: true,
      role: true,
    },
  });
  return user ?? null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function parseCookies(header: string): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    jar.set(
      part.slice(0, eq).trim(),
      decodeURIComponent(part.slice(eq + 1).trim()),
    );
  }
  return jar;
}
