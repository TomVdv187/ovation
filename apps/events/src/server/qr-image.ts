import QRCode from "qrcode";

/**
 * Renders a check-in token as something a door scanner can read.
 *
 * Error correction level M with a quiet zone of 4 modules: the code is printed
 * on a phone screen at arm's length under event lighting, which is exactly the
 * case M is specified for.
 */

export interface QrOptions {
  /** Module colour. Must be the darker of the pair — scanners assume it. */
  dark?: string;
  light?: string;
  /** Pixels per module in the PNG. 8 gives a ~330px code for a JWT. */
  scale?: number;
}

function options(opts: QrOptions = {}) {
  return {
    errorCorrectionLevel: "M" as const,
    margin: 4,
    scale: opts.scale ?? 8,
    color: {
      dark: opts.dark ?? "#000000ff",
      light: opts.light ?? "#ffffffff",
    },
  };
}

export function qrPng(text: string, opts?: QrOptions): Promise<Buffer> {
  return QRCode.toBuffer(text, { type: "png", ...options(opts) });
}

export function qrDataUrl(text: string, opts?: QrOptions): Promise<string> {
  return QRCode.toDataURL(text, { type: "image/png", ...options(opts) });
}

export function qrSvg(text: string, opts?: QrOptions): Promise<string> {
  return QRCode.toString(text, { type: "svg", ...options(opts) });
}
