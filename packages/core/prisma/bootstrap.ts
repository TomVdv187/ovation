/**
 * Makes an empty database usable, without seeding a demo into it.
 *
 * `db:seed` builds Meridian Summit 2026 — 200 guests, €28,140 of tickets, a
 * fixture every test asserts against. That is exactly what a production
 * database must NOT contain. But an empty one is not usable either: nothing in
 * the app creates an Organisation. NextAuth's adapter writes a User row on
 * first sign-in with `organisationId` null, and `protectedProcedure` answers
 * FORBIDDEN to every query until that column points somewhere. You would sign
 * in successfully and find a console that refuses to do anything.
 *
 * So this writes the two rows that gap needs and nothing else:
 *
 *   pnpm db:bootstrap --org "Ovation" --email you@example.com --name "Your Name"
 *
 * It is idempotent and it is safe to run AFTER a first sign-in — the usual
 * order, in fact. An existing user is adopted rather than duplicated, which is
 * what you want when NextAuth has already created the row.
 *
 * To point it at a database other than the one in the root .env — which is the
 * whole reason it exists — give it a different env file:
 *
 *   pnpm --filter @ovation/core exec dotenv -e ../../.env.production -- \
 *     tsx prisma/bootstrap.ts --org "Ovation" --email you@example.com
 */
import { db } from "../src/db";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const force = process.argv.includes("--force");

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .slice(0, 60) || "org"
  );
}

/** The host, so you can see which database you are about to write to. */
function target(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return "(DATABASE_URL is not set)";
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function main(): Promise<void> {
  const orgName = arg("org");
  const email = arg("email")?.trim().toLowerCase();
  const userName = arg("name") ?? null;
  const slug = arg("slug") ?? (orgName ? slugify(orgName) : undefined);

  if (!orgName || !email) {
    console.error(
      'Usage: pnpm db:bootstrap --org "Organisation Name" --email you@example.com [--name "Your Name"] [--slug custom-slug]',
    );
    process.exit(1);
  }

  console.log(`\n  database  ${target()}`);
  console.log(`  org       ${orgName} (${slug})`);
  console.log(`  owner     ${email}\n`);

  // A production database has no events in it yet. If this one does, either it
  // is the seeded development database or somebody has already used it — both
  // are worth stopping for.
  const [events, guests] = await Promise.all([
    db.event.count(),
    db.guest.count(),
  ]);
  if ((events > 0 || guests > 0) && !force) {
    console.error(
      `Refusing: this database already has ${events} event(s) and ${guests} guest(s).\n` +
        "That is not an empty production database — it looks like the seeded\n" +
        "development one. Check DATABASE_URL. Re-run with --force if you are sure.",
    );
    process.exit(1);
  }

  const organisation = await db.organisation.upsert({
    where: { slug: slug! },
    update: { name: orgName },
    create: {
      name: orgName,
      slug: slug!,
      settings: { autoApproveCosmetic: false, defaultCurrency: "EUR", locale: "en-GB" },
    },
    select: { id: true, name: true, slug: true },
  });

  // Adopt an existing user rather than failing: after a first sign-in NextAuth
  // has already written this row, with organisationId still null.
  const user = await db.user.upsert({
    where: { email },
    update: { organisationId: organisation.id, role: "OWNER" },
    create: {
      email,
      name: userName,
      role: "OWNER",
      organisationId: organisation.id,
    },
    select: { id: true, email: true, role: true, emailVerified: true },
  });

  console.log(`  organisation  ${organisation.id}  ${organisation.name}`);
  console.log(`  user          ${user.id}  ${user.email}  ${user.role}`);
  console.log(
    user.emailVerified
      ? "\n  Ready. Sign in and the console is yours.\n"
      : "\n  Ready. Sign in with the magic link to verify this address.\n",
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void db.$disconnect();
  });
