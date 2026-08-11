import { SignJWT, errors, jwtVerify } from "jose";
import { qrTokenPayloadSchema, type QrTokenPayload } from "@ovation/core";

/**
 * The check-in token boundary.
 *
 * Agent 2 · MAISON mints these at registration; we only ever verify. The
 * payload is exactly `qrTokenPayloadSchema` — { gid, eid, iat, exp } — and the
 * signature is HS256 over QR_SIGNING_SECRET.
 *
 * Rejections are values, not exceptions, because the door UI has to paint a
 * refusal as fast as an acceptance and the two must be visually distinct. The
 * ordering matters and is deliberate:
 *
 *   1. bad signature (forged)          -> REJECTED_INVALID_TOKEN
 *   2. valid signature, past exp       -> REJECTED_EXPIRED
 *   3. valid and current, wrong event  -> REJECTED_WRONG_EVENT  (caller's job)
 *
 * A forged token that *also* claims to be expired must read as INVALID, never
 * EXPIRED: we have no reason to believe anything it says.
 */

export type QrRejection = "REJECTED_INVALID_TOKEN" | "REJECTED_EXPIRED";

export type QrVerifyResult =
  | { ok: true; payload: QrTokenPayload }
  | { ok: false; reason: QrRejection };

const DEV_FALLBACK_SECRET = "ovation-dev-qr-secret-do-not-use-in-production";

let cachedSecret: Uint8Array | null = null;

export function qrSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  const raw = process.env.QR_SIGNING_SECRET;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "QR_SIGNING_SECRET is required in production — check-in cannot verify tokens without it.",
      );
    }
    console.warn(
      "[live] QR_SIGNING_SECRET is unset; using the development fallback secret.",
    );
    cachedSecret = new TextEncoder().encode(DEV_FALLBACK_SECRET);
    return cachedSecret;
  }
  cachedSecret = new TextEncoder().encode(raw);
  return cachedSecret;
}

/**
 * Verify signature, expiry and payload shape. No clock tolerance: an expired
 * code is expired, and the organiser can always fall back to the door list.
 */
export async function verifyQrToken(token: string): Promise<QrVerifyResult> {
  if (typeof token !== "string" || token.trim().length === 0) {
    return { ok: false, reason: "REJECTED_INVALID_TOKEN" };
  }

  let claims: Record<string, unknown>;
  try {
    const { payload } = await jwtVerify(token.trim(), qrSecret(), {
      algorithms: ["HS256"],
      clockTolerance: 0,
    });
    claims = payload as Record<string, unknown>;
  } catch (err) {
    // jose only reaches JWTExpired once the signature has already verified, so
    // this branch cannot be entered by a forgery.
    if (err instanceof errors.JWTExpired) {
      return { ok: false, reason: "REJECTED_EXPIRED" };
    }
    return { ok: false, reason: "REJECTED_INVALID_TOKEN" };
  }

  const parsed = qrTokenPayloadSchema.safeParse(claims);
  if (!parsed.success) return { ok: false, reason: "REJECTED_INVALID_TOKEN" };

  // Belt and braces: a token with no exp claim verifies happily in jose, and a
  // never-expiring door pass is not something we want to honour.
  if (parsed.data.exp * 1000 <= Date.now()) {
    return { ok: false, reason: "REJECTED_EXPIRED" };
  }

  return { ok: true, payload: parsed.data };
}

/**
 * Mint a token. Production issuance belongs to Agent 2 · MAISON at
 * registration; this exists so the simulation, the dev QR sheet and the
 * rejection tests can produce real tokens signed with the real secret.
 */
export async function signQrToken(
  payload: Pick<QrTokenPayload, "gid" | "eid"> & { ttlSeconds?: number },
  opts: { secret?: Uint8Array; issuedAt?: number } = {},
): Promise<string> {
  const iat = opts.issuedAt ?? Math.floor(Date.now() / 1000);
  const exp = iat + (payload.ttlSeconds ?? 60 * 60 * 24 * 7);
  return new SignJWT({ gid: payload.gid, eid: payload.eid, iat, exp })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(opts.secret ?? qrSecret());
}
