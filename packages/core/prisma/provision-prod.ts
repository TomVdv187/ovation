/**
 * Provisions the production database and writes .env.production.
 *
 * A SEPARATE DATABASE on the existing Neon endpoint, with its OWN ROLE — not
 * the Neon branch that was actually wanted. Branches are control-plane only:
 * there is no SQL for them, so they need the Neon console or a Neon API key,
 * and this machine has neither. What SQL can do is the part that matters most
 * today — Postgres cannot query across databases, so production data and the
 * seeded demo can no longer mix, and the two are owned by different roles with
 * different passwords.
 *
 * What it does NOT give you, and a branch would:
 *   · a separate compute endpoint — dev and production share one;
 *   · a separate point-in-time-restore history — PITR is per-branch, so
 *     restoring development to undo a mistake would roll production back too.
 *
 * That second one is the reason to still make the branch. It is cheap to move
 * to while production is empty, and expensive once real registrations land:
 * create the branch, point .env.production at it, re-run db:push:prod and
 * db:bootstrap:prod. See README, "Two databases".
 *
 *   pnpm --filter @ovation/core exec dotenv -e ../../.env -- \
 *     tsx prisma/provision-prod.ts
 *
 * Idempotent. The generated password is written straight to .env.production
 * and never printed, so it does not end up in a terminal scrollback, a CI log,
 * or a chat transcript.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const DB_NAME = "ovation_prod";
const ROLE_NAME = "ovation_prod_app";

const here = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(here, "../../../.env.production");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const admin = new URL(url);
/** Base64url: safe in a connection string without escaping. */
function password(): string {
  return randomBytes(24).toString("base64url");
}

/** Reuse the existing password on a re-run rather than locking ourselves out. */
function existingPassword(): string | null {
  if (!existsSync(ENV_PATH)) return null;
  const match = readFileSync(ENV_PATH, "utf8").match(
    /^DATABASE_URL="?postgresql:\/\/[^:]+:([^@]+)@/m,
  );
  return match?.[1] ?? null;
}

async function main(): Promise<void> {
  const sql = neon(url!);

  console.log(`\n  endpoint  ${admin.hostname}`);
  console.log(`  database  ${DB_NAME}`);
  console.log(`  role      ${ROLE_NAME}\n`);

  const secret = existingPassword() ?? password();

  // ── the role ──────────────────────────────────────────────────────
  // Its own credential, so the development password opens development and
  // nothing else. No CREATEDB, no CREATEROLE: it owns one database and has no
  // business anywhere else.
  const roleExists = await sql`SELECT 1 FROM pg_roles WHERE rolname = ${ROLE_NAME}`;
  if (roleExists.length === 0) {
    await sql(`CREATE ROLE ${ROLE_NAME} WITH LOGIN PASSWORD '${secret}'`);
    console.log(`  → created role ${ROLE_NAME}`);
  } else {
    await sql(`ALTER ROLE ${ROLE_NAME} WITH LOGIN PASSWORD '${secret}'`);
    console.log(`  → role ${ROLE_NAME} already existed; password re-synced`);
  }

  // Postgres will not let you hand a database to a role you are not a member
  // of, so the admin role has to join it before it can create the database on
  // its behalf. Membership only; the app role keeps its own credential.
  const admin_role = (await sql`SELECT current_user AS who`)[0]!.who as string;
  await sql(`GRANT ${ROLE_NAME} TO "${admin_role}"`);

  // ── the database ──────────────────────────────────────────────────
  const dbExists = await sql`SELECT 1 FROM pg_database WHERE datname = ${DB_NAME}`;
  if (dbExists.length === 0) {
    // CREATE DATABASE cannot run inside a transaction; the HTTP driver sends
    // each statement on its own, which is exactly what this needs.
    await sql(`CREATE DATABASE ${DB_NAME} OWNER ${ROLE_NAME}`);
    console.log(`  → created database ${DB_NAME}`);
  } else {
    console.log(`  → database ${DB_NAME} already existed`);
  }

  // ── the credentials file ──────────────────────────────────────────
  // Pooled for the app, direct for DDL — the same split as .env.
  const pooled = new URL(admin.toString());
  pooled.username = ROLE_NAME;
  pooled.password = secret;
  pooled.pathname = `/${DB_NAME}`;

  const direct = new URL(pooled.toString());
  direct.hostname = direct.hostname.replace("-pooler", "");
  direct.search = "?sslmode=require";

  writeFileSync(
    ENV_PATH,
    [
      "# OVATION — PRODUCTION database credentials.",
      "#",
      "# Written by prisma/provision-prod.ts. Gitignored, like .env.",
      "# Only the :prod scripts read this file: db:push:prod, db:bootstrap:prod.",
      "# db:seed and db:reset read .env and cannot reach production.",
      "",
      `DATABASE_URL="${pooled.toString()}"`,
      `DIRECT_URL="${direct.toString()}"`,
      "",
    ].join("\n"),
    "utf8",
  );

  console.log(`\n  wrote ${path.relative(process.cwd(), ENV_PATH)} (gitignored)`);
  console.log("\n  next:  pnpm db:push:prod");
  console.log('         pnpm db:bootstrap:prod --org "…" --email you@example.com\n');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
