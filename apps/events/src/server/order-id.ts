import { randomBytes } from "node:crypto";
import { hostname } from "node:os";

/**
 * Order ids, generated here rather than by Prisma.
 *
 * `Order.id` is `@default(cuid())`, which Prisma generates in the client — it
 * is not a database default, and there is no public API to ask Prisma for one.
 * Every row Prisma writes therefore arrives with its id already attached.
 *
 * Reservation writes its Order with raw SQL, in the same statement that takes
 * the seats (see `reserve` in ticketing.ts), so it has to supply the id itself.
 * This produces the same 25-character cuid v1 shape Prisma does —
 * `c` + timestamp + counter + fingerprint + randomness — so ids stay uniform
 * across the table and nothing downstream can tell which path wrote a row.
 *
 * Uniqueness comes from four independent sources, in decreasing order of how
 * often they save you: the millisecond timestamp, a per-process counter (two
 * ids in the same millisecond), the host/pid fingerprint (two processes in the
 * same millisecond), and 40 bits of randomness (everything else). The primary
 * key is still the real guarantee — a collision fails the insert rather than
 * corrupting anything.
 */

const BASE = 36;
const BLOCK = 4;
const DISCRETE_VALUES = BASE ** BLOCK;

let counter = 0;

function pad(value: string, size: number): string {
  return value.length >= size ? value.slice(-size) : value.padStart(size, "0");
}

/** Which machine and which process. Stable for the life of the process. */
const fingerprint = (() => {
  const pid = pad(process.pid.toString(BASE), 2);
  const host = hostname();
  const hostSum = host
    .split("")
    .reduce((total, char) => total + char.charCodeAt(0), host.length + BASE);
  return pid + pad(hostSum.toString(BASE), 2);
})();

function randomBlock(): string {
  return pad(randomBytes(4).readUInt32BE(0).toString(BASE), BLOCK);
}

export function createOrderId(): string {
  counter = (counter + 1) % DISCRETE_VALUES;
  return (
    "c" +
    Date.now().toString(BASE) +
    pad(counter.toString(BASE), BLOCK) +
    fingerprint +
    randomBlock() +
    randomBlock()
  );
}
