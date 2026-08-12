/**
 * Mints a database session for the seeded owner and prints the cookie, so the
 * console can be exercised without waiting on a magic-link email.
 *
 *   pnpm --filter @ovation/console dev:session
 *
 * Development only. It creates nothing a normal sign-in would not.
 */
import { randomUUID } from "node:crypto";
import { db } from "@ovation/core/db";

async function main() {
  const user = await db.user.findFirst({
    where: { organisationId: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  if (!user) throw new Error("No user with an organisation. Run pnpm db:seed.");

  const sessionToken = randomUUID();
  await db.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  console.log(`user: ${user.email}`);
  console.log(`cookie: authjs.session-token=${sessionToken}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
