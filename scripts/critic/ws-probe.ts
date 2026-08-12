/**
 * Agent 7 · CRITIC — which Neon transport actually works from here?
 *
 * Every Next dev server in this repo answers 500 with
 * "Received network error or non-101 status code" on the first query, while the
 * identical client under plain tsx is fine. 101 is the WebSocket upgrade, so
 * this isolates the two transports the Neon driver can use.
 */
import { neon, neonConfig, Pool } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL!;

async function main() {
  console.log("globalThis.WebSocket:", typeof (globalThis as { WebSocket?: unknown }).WebSocket);

  try {
    const sql = neon(url);
    const t = performance.now();
    const rows = await sql`SELECT 1 AS one`;
    console.log(`HTTP  (neon fetch)      : ok  ${(performance.now() - t).toFixed(0)}ms  ${JSON.stringify(rows)}`);
  } catch (e) {
    console.log(`HTTP  (neon fetch)      : FAIL ${(e as Error).message}`);
  }

  try {
    const pool = new Pool({ connectionString: url });
    const t = performance.now();
    const res = await pool.query("SELECT 1 AS one");
    console.log(`WS    (Pool, default)   : ok  ${(performance.now() - t).toFixed(0)}ms  ${JSON.stringify(res.rows)}`);
    await pool.end();
  } catch (e) {
    console.log(`WS    (Pool, default)   : FAIL ${(e as Error).message}`);
  }

  try {
    neonConfig.poolQueryViaFetch = true;
    const pool = new Pool({ connectionString: url });
    const t = performance.now();
    const res = await pool.query("SELECT 1 AS one");
    console.log(`HTTP  (poolQueryViaFetch): ok  ${(performance.now() - t).toFixed(0)}ms  ${JSON.stringify(res.rows)}`);
    await pool.end();
  } catch (e) {
    console.log(`HTTP  (poolQueryViaFetch): FAIL ${(e as Error).message}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
