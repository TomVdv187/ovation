import { qrPng } from "~/server/qr-image";
import { verifyQrToken } from "~/server/qr-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The check-in code as a downloadable image, for a guest who would rather have
 * it in their camera roll than in a browser tab.
 *
 * The token is verified before anything is drawn: this endpoint will not mint a
 * picture of a code that would be turned away at the door.
 */
export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("t");
  if (!token) {
    return new Response("Missing token.", { status: 400 });
  }

  const verified = verifyQrToken(token);
  if (!verified.ok) {
    return new Response(`Token rejected: ${verified.reason}.`, { status: 400 });
  }

  const png = await qrPng(token, { scale: 10 });

  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "content-disposition": 'attachment; filename="check-in-code.png"',
      // A ticket is personal. Nothing shared may cache it.
      "cache-control": "private, no-store",
    },
  });
}
