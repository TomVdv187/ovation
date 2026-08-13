/**
 * Pulls the development database credentials from Vercel into the root .env.
 *
 *   node scripts/pull-db-credentials.mjs
 *
 * Rotating a database password is not one step, it is five: reset it, wait for
 * the provider to sync it to Vercel, get the new value out of Vercel (the API
 * returns an encrypted envelope, so only the CLI can), write it into .env
 * without disturbing the twenty other keys in there, and confirm the OLD one
 * is actually dead. Doing that by hand is how you end up believing a rotation
 * happened when it did not.
 *
 * So this checks rather than assumes. It refuses to write anything unless the
 * value from Vercel actually differs from what is already in .env, and it
 * reports whether the old credential still authenticates — which is the only
 * evidence that a rotation took effect. A reset in the wrong Neon project
 * looks exactly like a successful one until you ask that question.
 *
 * Passwords are compared and reported as short hashes. Nothing prints a
 * credential, so this is safe to run with someone watching your screen.
 *
 * Requires the Vercel CLI, linked once:
 *   npm i -g vercel
 *   vercel link --yes --scope <team> --project ovation
 */
import { execSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const KEYS = ["DATABASE_URL", "DIRECT_URL"];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

const shortHash = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 12);

/** Vercel's CLI writes a BOM; a BOM inside a connection string is not a joke. */
const clean = (value) => value.replace(/^﻿/, "").trim();

function read(text, key) {
  const match = text.match(new RegExp(`^${key}="?([^"\\n\\r]+)`, "m"));
  return match ? clean(match[1]) : null;
}

/** Replaces one key's value, leaving every other line — and its comments — alone. */
function replace(text, key, value) {
  const line = `${key}="${value}"`;
  return new RegExp(`^${key}=.*$`, "m").test(text)
    ? text.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${text.trimEnd()}\n${line}\n`;
}

/**
 * Is this credential accepted?
 *
 * "The connection failed" and "the password is wrong" are different answers,
 * and conflating them produces a confident lie. A Neon compute waking from
 * suspension — or, on this machine, the TLS-intercepting antivirus reissuing
 * its certificate — fails a connection for a few seconds while the password
 * remains perfectly valid. Reported as "the credential is dead", that reads as
 * proof a rotation landed when nothing rotated at all.
 *
 * So only Postgres' own 28P01 counts as a refusal. Anything else is retried,
 * and if it still will not connect the answer is "unknown", never "dead".
 *
 * Returns "ok" | "denied" | "unknown".
 */
async function credentialState(url, attempts = 3) {
  const require = createRequire(path.join(root, "packages/core/package.json"));
  const mod = await import(
    pathToFileURL(require.resolve("@neondatabase/serverless")).href
  );
  // The driver's entry point is CommonJS, so importing it yields the module
  // under `default`. Reaching straight for `mod.neon` gets undefined, and
  // calling undefined throws — which an over-broad catch happily reports as
  // "this credential no longer works".
  const neon = mod.neon ?? mod.default?.neon;
  if (typeof neon !== "function") throw new Error("could not load the Neon driver");

  let last = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const rows = await neon(url)`SELECT current_user AS who, current_database() AS db`;
      return { state: "ok", detail: `${rows[0].who}@${rows[0].db}` };
    } catch (error) {
      const code = error?.code ?? "";
      const message = String(error?.message ?? "");
      if (code === "28P01" || /password authentication failed/i.test(message)) {
        return { state: "denied", detail: "password rejected (28P01)" };
      }
      last = `${code || "no code"}: ${message.split("\n")[0].slice(0, 90)}`;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  return { state: "unknown", detail: last };
}

const pulled = path.join(tmpdir(), `ovation-env-${randomUUID()}`);

try {
  console.log("\n  pulling development environment from Vercel…");
  // Through a shell, so the platform's own resolution finds the CLI (vercel
  // is vercel.cmd on Windows, and execFile does not apply PATHEXT).
  execSync(
    `vercel env pull "${pulled}" --environment=development --yes`,
    { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
  );

  const remote = readFileSync(pulled, "utf8");
  const local = readFileSync(envPath, "utf8");

  const changes = [];
  for (const key of KEYS) {
    const before = read(local, key);
    const after = read(remote, key);
    if (!after) {
      console.log(`  ${key}: absent from Vercel — skipped`);
      continue;
    }
    const same = before === after;
    console.log(
      `  ${key.padEnd(13)} local ${before ? shortHash(before) : "(none)"}` +
        `  vercel ${shortHash(after)}  ${same ? "same" : "DIFFERENT"}`,
    );
    if (!same) changes.push([key, before, after]);
  }

  if (changes.length === 0) {
    console.log(
      "\n  Nothing to update — Vercel holds the same credentials .env already has.",
    );
    // The tell that separates "not rotated" from "rotated, not yet synced".
    const current = read(local, "DATABASE_URL");
    if (current) {
      const { state, detail } = await credentialState(current);
      if (state === "ok") {
        console.log(
          `  The credential in .env still authenticates (${detail}), so NO rotation has taken effect.`,
        );
      } else if (state === "denied") {
        console.log(
          "  The credential in .env is REJECTED — a rotation happened, but Vercel has not synced the new one yet. Try again shortly.",
        );
      } else {
        console.log(
          `  Could not reach the database, so the credential's validity is UNKNOWN — not evidence of a rotation. (${detail})`,
        );
      }
    }
    process.exit(0);
  }

  let next = local;
  for (const [key, , after] of changes) next = replace(next, key, after);
  writeFileSync(envPath, next, "utf8");
  console.log(`\n  updated .env (${changes.map(([k]) => k).join(", ")})`);

  // Did the new one work, and is the old one actually dead?
  const [, oldUrl, newUrl] =
    changes.find(([key]) => key === "DATABASE_URL") ?? [];
  if (newUrl) {
    const { state, detail } = await credentialState(newUrl);
    console.log(
      state === "ok"
        ? `  new credential works — ${detail}`
        : `  NEW CREDENTIAL DOES NOT WORK (${state}: ${detail})`,
    );
  }
  if (oldUrl) {
    const { state, detail } = await credentialState(oldUrl);
    console.log(
      state === "denied"
        ? "  old credential is dead."
        : state === "ok"
          ? "  WARNING: the OLD credential still authenticates. It has NOT been revoked."
          : `  old credential's state is UNKNOWN (${detail}) — check before assuming it is revoked.`,
    );
  }
  console.log();
} finally {
  rmSync(pulled, { force: true });
}
