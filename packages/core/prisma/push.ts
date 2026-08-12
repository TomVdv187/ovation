/**
 * Apply the Prisma schema to Neon over HTTPS.
 *
 * `prisma db push` needs raw TCP on :5432, which many corporate networks block.
 * This does the same job over :443:
 *
 *   1. `prisma migrate diff` generates the DDL locally — no connection needed;
 *   2. the statements are executed through Neon's HTTP SQL endpoint.
 *
 * On a network where 5432 is open, plain `prisma db push` still works and is
 * the better tool. This exists so the repo is not hostage to a firewall.
 *
 *   pnpm db:push            apply to an empty database
 *   pnpm db:push --force    DROP the public schema first, then apply
 */
import { execSync } from "node:child_process";
import { neon } from "@neondatabase/serverless";

const force = process.argv.includes("--force");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.");
  process.exit(1);
}
if (!/neon\.(tech|build)/.test(url)) {
  console.error(
    "This script targets Neon over HTTPS. For any other Postgres use:\n" +
      "  pnpm --filter @ovation/core exec prisma db push",
  );
  process.exit(1);
}

const sql = neon(url);

/**
 * Prisma emits statements separated by blank lines and `--` comments. Splitting
 * on semicolons is safe here because the generated DDL contains no function
 * bodies or dollar-quoted strings.
 */
function statements(ddl: string): string[] {
  return ddl
    .split(/;\s*$/m)
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((s) => s.length > 0);
}

async function main() {
  const existing = (await sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `) as Array<{ tablename: string }>;

  if (existing.length > 0 && !force) {
    console.error(
      `The public schema already has ${existing.length} table(s).\n` +
        "Re-run with --force to DROP and recreate it (this deletes all data):\n" +
        "  pnpm db:push -- --force",
    );
    process.exit(1);
  }

  if (force && existing.length > 0) {
    console.log(`→ dropping public schema (${existing.length} tables)`);
    await sql`DROP SCHEMA public CASCADE`;
    await sql`CREATE SCHEMA public`;
  }

  console.log("→ generating DDL from schema.prisma");
  // execSync runs through a shell, so this resolves the workspace's prisma
  // binary from node_modules/.bin on Windows (.cmd) and POSIX alike.
  const ddl = execSync(
    "prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script",
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );

  const stmts = statements(ddl);
  console.log(`→ applying ${stmts.length} statements over HTTPS`);

  for (const stmt of stmts) {
    try {
      await sql(stmt);
    } catch (error) {
      console.error(`\nFailed on:\n${stmt.slice(0, 300)}\n`);
      throw error;
    }
  }

  const after = (await sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `) as Array<{ tablename: string }>;

  console.log(`\n  Schema applied — ${after.length} tables:`);
  console.log(`  ${after.map((t) => t.tablename).join(", ")}\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
