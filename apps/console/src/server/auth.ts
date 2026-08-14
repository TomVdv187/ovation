import NextAuth, { type DefaultSession } from "next-auth";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@ovation/core/db";
import type { UserRoleT } from "@ovation/core";

/**
 * Email magic-link auth. With no RESEND_API_KEY the link is printed to the
 * server console instead of sent — that is what makes `pnpm dev` usable on a
 * fresh clone with nothing but a DATABASE_URL.
 */

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      organisationId: string | null;
      role: UserRoleT;
    } & DefaultSession["user"];
  }
}

const hasResend = Boolean(process.env.RESEND_API_KEY);

/** Only used when nothing sends — the link goes to the console instead. */
const DEV_FROM = "OVATION <hello@ovation.local>";

/**
 * The sender address, or a refusal.
 *
 * In production, refuse — do not fall back. `ovation.local` is not a domain
 * anybody owns, so Resend answers every send with
 *
 *   403 The ovation.local domain is not verified
 *
 * and the magic link is never delivered. That is not a degraded sign-in, it is
 * no sign-in at all, and it looked like a working deploy from the outside: the
 * page rendered, the form posted, and the failure lived in a server log. This
 * is the same rule qr-token.ts applies to QR_SIGNING_SECRET, for the same
 * reason — a development placeholder must not survive into production.
 *
 * Scoped to the path that actually sends: with no RESEND_API_KEY the link is
 * printed to the console and `from` is never read, which is what keeps a fresh
 * clone working with nothing but a DATABASE_URL.
 */
function sender(): string {
  const configured = process.env.EMAIL_FROM;
  if (configured && configured.length > 0) return configured;

  if (hasResend && process.env.NODE_ENV === "production") {
    throw new Error(
      "EMAIL_FROM is required in production — refusing to send sign-in links " +
        `from ${DEV_FROM}, which no verified domain backs.`,
    );
  }

  return DEV_FROM;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "database" },
  // `error` matters as much as the other two: without it Auth.js sends failures
  // to its built-in /api/auth/error, which this route handler answers with
  // `UnknownAction: Cannot handle action: error` and a 500. A guest who cannot
  // sign in should see the sign-in page saying why, not a server error.
  pages: { signIn: "/signin", verifyRequest: "/signin?sent=1", error: "/signin" },
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY ?? "re_dev_placeholder",
      from: sender(),
      ...(hasResend
        ? {}
        : {
            async sendVerificationRequest({
              identifier,
              url,
            }: {
              identifier: string;
              url: string;
            }) {
              console.log("\n─────────────────────────────────────────────");
              console.log(`  OVATION sign-in link for ${identifier}`);
              console.log(`  ${url}`);
              console.log("─────────────────────────────────────────────\n");
            },
          }),
    }),
  ],
  callbacks: {
    session({ session, user }) {
      // The adapter's user row carries our tenancy columns.
      const u = user as typeof user & {
        organisationId: string | null;
        role: UserRoleT;
      };
      session.user.id = user.id;
      session.user.organisationId = u.organisationId ?? null;
      session.user.role = u.role ?? "MEMBER";
      return session;
    },
  },
});
