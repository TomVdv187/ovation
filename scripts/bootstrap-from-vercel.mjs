/**
 * Rebuilds the gitignored environment files on a fresh clone.
 *
 *   npm i -g vercel
 *   vercel link --yes --scope <team> --project ovation
 *   node scripts/bootstrap-from-vercel.mjs
 *
 * `git clone` gives you every line of code and none of the secrets, which is
 * the point — but it means a second machine cannot run anything until `.env`
 * and `.env.production` exist. Vercel already holds most of what goes in them,
 * and its CLI is the only thing that can read the values back (the REST API
 * returns an encrypted envelope). So this pulls both environments and writes
 * the two files.
 *
 * It will not overwrite an existing `.env` — on a machine that already works,
 * silently replacing the file you are using is a bad trade for saving a
 * command. It reports what differs instead, and `pull-db-credentials.mjs`
 * updates the database keys in place.
 *
 * Whatever Vercel does not have is listed at the end rather than defaulted to
 * something plausible. A wrong secret that looks right is worse than a missing
 * one that stops you.
 */
import { execSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV = path.join(root, ".env");
const ENV_PROD = path.join(root, ".env.production");
const EXAMPLE = path.join(root, ".env.example");

const hash = (v) => createHash("sha256").update(v).digest("hex").slice(0, 12);

function parse(text) {
  return Object.fromEntries(
    [...text.matchAll(/^([A-Z0-9_]+)="?([^"\n\r]*)/gm)].map(([, k, v]) => [
      k,
      v.replace(/^﻿/, "").trim(),
    ]),
  );
}

function pull(environment) {
  const file = path.join(tmpdir(), `ovation-${environment}-${randomUUID()}`);
  try {
    execSync(`vercel env pull "${file}" --environment=${environment} --yes`, {
      cwd: root,
      stdio: ["ignore", "ignore", "inherit"],
    });
    return parse(readFileSync(file, "utf8"));
  } finally {
    rmSync(file, { force: true });
  }
}

console.log("\n  pulling from Vercel…");
const dev = pull("development");
const prod = pull("production");

// ── .env ──────────────────────────────────────────────────────────────
if (existsSync(ENV)) {
  const local = parse(readFileSync(ENV, "utf8"));
  const differing = Object.keys(dev).filter(
    (k) => k !== "VERCEL_OIDC_TOKEN" && local[k] !== undefined && local[k] !== dev[k],
  );
  console.log(
    `\n  .env already exists — left alone.` +
      (differing.length
        ? `\n  Differs from Vercel on: ${differing.join(", ")}` +
          `\n  For the database keys, run: node scripts/pull-db-credentials.mjs`
        : "\n  Every key it shares with Vercel matches."),
  );
} else {
  // Start from the documented template so the comments and the keys Vercel
  // does not carry are present, then overlay what Vercel does have.
  let text = existsSync(EXAMPLE) ? readFileSync(EXAMPLE, "utf8") : "";
  const wrote = [];
  for (const [key, value] of Object.entries(dev)) {
    if (key === "VERCEL_OIDC_TOKEN" || value === "") continue;
    const line = `${key}="${value}"`;
    text = new RegExp(`^${key}=.*$`, "m").test(text)
      ? text.replace(new RegExp(`^${key}=.*$`, "m"), line)
      : `${text.trimEnd()}\n${line}\n`;
    wrote.push(key);
  }
  // Production-only in Vercel, but needed locally to exercise the agent.
  if (!dev.ANTHROPIC_API_KEY && prod.ANTHROPIC_API_KEY) {
    text = new RegExp("^ANTHROPIC_API_KEY=.*$", "m").test(text)
      ? text.replace(/^ANTHROPIC_API_KEY=.*$/m, `ANTHROPIC_API_KEY="${prod.ANTHROPIC_API_KEY}"`)
      : `${text.trimEnd()}\nANTHROPIC_API_KEY="${prod.ANTHROPIC_API_KEY}"\n`;
    wrote.push("ANTHROPIC_API_KEY");
  }
  writeFileSync(ENV, text, "utf8");
  console.log(`\n  wrote .env — ${wrote.length} keys from Vercel`);
}

// ── .env.production ───────────────────────────────────────────────────
if (existsSync(ENV_PROD)) {
  console.log("  .env.production already exists — left alone.");
} else if (prod.DATABASE_URL && prod.DIRECT_URL) {
  writeFileSync(
    ENV_PROD,
    [
      "# OVATION — PRODUCTION database credentials, pulled from Vercel.",
      "# Only the :prod scripts read this file. db:seed and db:reset read .env.",
      "",
      `DATABASE_URL="${prod.DATABASE_URL}"`,
      `DIRECT_URL="${prod.DIRECT_URL}"`,
      "",
    ].join("\n"),
    "utf8",
  );
  console.log(`  wrote .env.production (${hash(prod.DATABASE_URL)})`);
} else {
  console.log("  .env.production NOT written — Vercel has no production DATABASE_URL.");
}

// ── what Vercel cannot give you ───────────────────────────────────────
const local = parse(readFileSync(ENV, "utf8"));
const missing = Object.entries(local)
  .filter(([key, value]) => value === "" && !["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"].includes(key))
  .map(([key]) => key);

console.log("\n  Still needs a human:");
console.log(
  missing.length
    ? missing.map((k) => `    ${k} — empty`).join("\n")
    : "    nothing — every key has a value",
);
console.log(
  "\n  If this machine intercepts TLS (corporate proxy, some antivirus):" +
    "\n    node scripts/trust-local-tls.mjs" +
    "\n  Then: pnpm install && pnpm db:generate && pnpm dev\n",
);
