import { createHmac, timingSafeEqual } from "node:crypto";
import { qrTokenPayloadSchema, type QrTokenPayload } from "@ovation/core";

/**
 * The check-in credential.
 *
 * A plain HS256 JWT — header, payload, signature, base64url, dots — because
 * Agent 5 · MAÎTRE D' verifies these at the door with whatever JWT library it
 * likes and both ends have to agree without sharing code. The claim set is
 * qrTokenPayloadSchema exactly: { gid, eid, iat, exp }, seconds since epoch.
 *
 * Signed with QR_SIGNING_SECRET. Hand-rolled on node:crypto rather than pulling
 * a JWT dependency: the algorithm is thirty lines and this way the public app
 * ships nothing extra to the edge.
 */

const HEADER = base64url(
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf8"),
);

/** Only used when QR_SIGNING_SECRET is unset, so a fresh clone works offline. */
const DEV_SECRET = "ovation-development-qr-secret";
let warned = false;

function secret(): string {
  const configured = process.env.QR_SIGNING_SECRET;
  if (configured && configured.length > 0) return configured;
  if (!warned) {
    warned = true;
    console.warn(
      "[qr] QR_SIGNING_SECRET is not set — signing check-in tokens with the " +
        "development secret. Set it before anything reaches a real door.",
    );
  }
  return DEV_SECRET;
}

export interface SignQrTokenInput {
  guestId: string;
  eventId: string;
  /** Token dies here. Default: the event date plus a day of slack. */
  expiresAt: Date;
  issuedAt?: Date;
}

export function signQrToken(input: SignQrTokenInput): string {
  const payload: QrTokenPayload = qrTokenPayloadSchema.parse({
    gid: input.guestId,
    eid: input.eventId,
    iat: toSeconds(input.issuedAt ?? new Date()),
    exp: toSeconds(input.expiresAt),
  });

  const body = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signingInput = `${HEADER}.${body}`;
  return `${signingInput}.${sign(signingInput)}`;
}

export type QrVerifyResult =
  | { ok: true; payload: QrTokenPayload }
  | { ok: false; reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" };

export function verifyQrToken(token: string, now = new Date()): QrVerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "MALFORMED" };

  const [header, body, signature] = parts as [string, string, string];
  if (!constantTimeEqual(signature, sign(`${header}.${body}`))) {
    return { ok: false, reason: "BAD_SIGNATURE" };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(
      Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
        "utf8",
      ),
    );
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }

  const parsed = qrTokenPayloadSchema.safeParse(decoded);
  if (!parsed.success) return { ok: false, reason: "MALFORMED" };
  if (parsed.data.exp <= toSeconds(now)) return { ok: false, reason: "EXPIRED" };

  return { ok: true, payload: parsed.data };
}

/** Doors close long after the last speech; a day of slack costs nothing. */
export function ticketExpiry(eventDate: Date, eventEnd: Date | null): Date {
  const base = eventEnd ?? eventDate;
  return new Date(base.getTime() + 24 * 60 * 60 * 1000);
}

function sign(input: string): string {
  return base64url(createHmac("sha256", secret()).update(input).digest());
}

function base64url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function toSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
