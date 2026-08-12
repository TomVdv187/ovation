/**
 * Agent 7 · CRITIC — how much of the check-in budget is just the wire?
 *
 * One trivial query, twenty times, through the same Neon HTTP adapter the
 * product uses. Whatever this costs is the floor under every round trip in
 * every measurement in INTEGRATION_REPORT.md.
 */
import { db } from "@ovation/core/db";

async function main() {
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    await db.$queryRaw`SELECT 1`;
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  const p = (q: number) => samples[Math.min(samples.length - 1, Math.ceil((q / 100) * samples.length) - 1)]!;
  console.log(
    `SELECT 1 over the Neon HTTP adapter: p50=${p(50).toFixed(0)}ms p95=${p(95).toFixed(0)}ms min=${samples[0]!.toFixed(0)}ms`,
  );

  const t = performance.now();
  await db.$transaction([db.$queryRaw`SELECT 1`, db.$queryRaw`SELECT 1`]);
  console.log(`a 2-statement transaction: ${(performance.now() - t).toFixed(0)}ms`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
