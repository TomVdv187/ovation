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

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "database" },
  pages: { signIn: "/signin", verifyRequest: "/signin?sent=1" },
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY ?? "re_dev_placeholder",
      from: process.env.EMAIL_FROM ?? "OVATION <hello@ovation.local>",
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
