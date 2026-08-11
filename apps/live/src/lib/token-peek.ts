// The `@ovation/core` barrel re-exports the tRPC builder, which calls
// `initTRPC.create()` at module scope and throws in a browser. Client code
// imports the schema subpath so the server half never reaches the bundle.
import { qrTokenPayloadSchema, type QrTokenPayload } from "@ovation/core/schemas";

/**
 * Read a QR token's claims **without verifying the signature**.
 *
 * This exists for one reason: when the tablet has no network it still has to
 * tell the greeter something useful. With the claims in hand it can look the
 * guest up in the cached door list, spot an obviously expired code and refuse
 * a code minted for a different event — all on the device, in a few
 * milliseconds.
 *
 * It is not, and must never become, an authorisation decision. The signing
 * secret is server-side; a forged token peeks perfectly well. Everything this
 * returns is provisional and the server's answer on replay overrides it. The
 * door UI marks offline results as unverified for exactly this reason.
 */
export type PeekResult =
  | { ok: true; payload: QrTokenPayload; expired: boolean }
  | { ok: false };

export function peekQrToken(token: string): PeekResult {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return { ok: false };

  try {
    const json = decodeBase64Url(parts[1] as string);
    const parsed = qrTokenPayloadSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return { ok: false };
    return {
      ok: true,
      payload: parsed.data,
      expired: parsed.data.exp * 1000 <= Date.now(),
    };
  } catch {
    return { ok: false };
  }
}

function decodeBase64Url(segment: string): string {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
