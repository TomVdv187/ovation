"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Camera QR decoding.
 *
 * Two decoders, picked at runtime:
 *
 *  - **BarcodeDetector** where the browser has it (Chrome, Android WebView,
 *    Edge). Hardware-accelerated, decodes off the video frame directly, and
 *    costs nothing to ship.
 *  - **jsQR** everywhere else, notably iOS Safari. Pure JS over an
 *    ImageData buffer, loaded lazily so the fast path never pays for it.
 *
 * The scan loop is throttled to ~8 fps against a downscaled frame. Decoding
 * every frame at full resolution pegs a tablet's CPU and *increases* time to
 * first read; the budget here is the whole point.
 *
 * Duplicate suppression is in the loop rather than the caller: a QR code sits
 * in front of the lens for a second or more, which is thirty reads of the same
 * string. Only the first fires.
 */

export type ScannerStatus =
  | "idle"
  | "starting"
  | "scanning"
  | "denied"
  | "unsupported"
  | "error";

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
}

const SCAN_INTERVAL_MS = 125;
const MAX_EDGE = 640;
/** Ignore a repeat of the same code inside this window. */
const DEDUPE_MS = 2_500;

export interface UseQrScannerOptions {
  onDecode: (value: string, decodedAt: number) => void;
  enabled: boolean;
}

export function useQrScanner({ onDecode, enabled }: UseQrScannerOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<ScannerStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;

  const lastValueRef = useRef<{ value: string; at: number } | null>(null);

  /** Lets the door reset suppression after it has rendered an outcome. */
  const clearDedupe = useCallback(() => {
    lastValueRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }

    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let detector: BarcodeDetectorLike | null = null;
    let jsQR: typeof import("jsqr").default | null = null;
    let cancelled = false;
    let busy = false;

    const emit = (value: string) => {
      const now = Date.now();
      const last = lastValueRef.current;
      if (last && last.value === value && now - last.at < DEDUPE_MS) return;
      lastValueRef.current = { value, at: now };
      onDecodeRef.current(value, now);
    };

    const tick = async () => {
      if (busy || cancelled) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      busy = true;
      try {
        if (detector) {
          const found = await detector.detect(video);
          const hit = found.find((f) => f.rawValue);
          if (hit) emit(hit.rawValue);
        } else if (jsQR) {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const scale = Math.min(
            1,
            MAX_EDGE / Math.max(video.videoWidth, video.videoHeight || 1),
          );
          const w = Math.max(1, Math.round(video.videoWidth * scale));
          const h = Math.max(1, Math.round(video.videoHeight * scale));
          if (canvas.width !== w) canvas.width = w;
          if (canvas.height !== h) canvas.height = h;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(video, 0, 0, w, h);
          const image = ctx.getImageData(0, 0, w, h);
          const result = jsQR(image.data, w, h, {
            inversionAttempts: "dontInvert",
          });
          if (result?.data) emit(result.data);
        }
      } catch {
        /* a dropped frame is not an error worth showing a greeter */
      } finally {
        busy = false;
      }
    };

    const start = async () => {
      setStatus("starting");
      setError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("unsupported");
        setError("This browser cannot open a camera.");
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (err) {
        if (cancelled) return;
        const name = (err as DOMException).name;
        setStatus(name === "NotAllowedError" ? "denied" : "error");
        setError(
          name === "NotAllowedError"
            ? "Camera access was refused. Use the door list instead."
            : `Camera unavailable: ${(err as Error).message}`,
        );
        return;
      }

      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        await video.play().catch(() => undefined);
      }

      const Ctor = (
        globalThis as unknown as {
          BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike;
        }
      ).BarcodeDetector;

      if (Ctor) {
        detector = new Ctor({ formats: ["qr_code"] });
      } else {
        jsQR = (await import("jsqr")).default;
      }

      if (cancelled) return;
      setStatus("scanning");
      timer = setInterval(() => void tick(), SCAN_INTERVAL_MS);
    };

    void start();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };
  }, [enabled]);

  return { videoRef, canvasRef, status, error, clearDedupe };
}
