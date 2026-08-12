"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-asks the server whether a pending order has settled.
 *
 * Bounded on purpose: ten checks over half a minute, then it stops and says so.
 * A page that spins forever is worse than one that admits it does not know, and
 * the confirmation email arrives regardless of whether this tab is still open.
 */
const INTERVAL_MS = 3000;
const MAX_ATTEMPTS = 10;

export function OrderPoller() {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (attempts >= MAX_ATTEMPTS) return;
    const timer = window.setTimeout(() => {
      setAttempts((n) => n + 1);
      router.refresh();
    }, INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [attempts, router]);

  return (
    <p aria-live="polite" className="mt-6 text-sm text-ev-ink-muted">
      {attempts >= MAX_ATTEMPTS
        ? "Still not confirmed. Your seats are held and the email will arrive when it settles — you can safely close this page."
        : "Checking for the payment…"}
    </p>
  );
}
