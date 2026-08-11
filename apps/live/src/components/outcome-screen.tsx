"use client";

import type { CSSProperties } from "react";
import type { CheckinOutcome } from "@ovation/core/schemas";

/**
 * The refusal screen matters as much as the welcome.
 *
 * A greeter reads this at arm's length, in the dark, with a queue behind the
 * guest. So each outcome gets its own colour, its own glyph and its own verb —
 * never a shared "error" state with the detail buried in small print. Two of
 * these are *rejections* and one is a *duplicate*, and confusing them at the
 * door is the difference between "one moment, sir" and turning away a guest
 * who is already inside.
 */

export type DoorOutcome = CheckinOutcome | "QUEUED_OFFLINE";

interface Presentation {
  label: string;
  hint: string;
  tone: "good" | "warn" | "bad" | "info";
  glyph: string;
}

const PRESENTATION: Record<DoorOutcome, Presentation> = {
  CHECKED_IN: {
    label: "Welcome",
    hint: "Checked in",
    tone: "good",
    glyph: "✓",
  },
  ALREADY_CHECKED_IN: {
    label: "Already in",
    hint: "This code has been used",
    tone: "warn",
    glyph: "↺",
  },
  REJECTED_INVALID_TOKEN: {
    label: "Not a valid code",
    hint: "Signature did not verify — use the door list",
    tone: "bad",
    glyph: "✕",
  },
  REJECTED_EXPIRED: {
    label: "Code expired",
    hint: "Ask the guest to refresh their ticket",
    tone: "bad",
    glyph: "⧗",
  },
  REJECTED_WRONG_EVENT: {
    label: "Wrong event",
    hint: "This code is for another night",
    tone: "bad",
    glyph: "⇄",
  },
  REJECTED_UNKNOWN_GUEST: {
    label: "Not on the list",
    hint: "No guest matches this code",
    tone: "bad",
    glyph: "?",
  },
  QUEUED_OFFLINE: {
    label: "Saved offline",
    hint: "Unverified — syncs when signal returns",
    tone: "info",
    glyph: "⇡",
  },
};

/**
 * Derived from the status tokens rather than hand-picked hexes, so a theme
 * change moves these with everything else. A 14% wash is the right weight for
 * a badge in a dashboard and far too quiet for a screen read at arm's length
 * in a dark foyer, hence the much heavier mix.
 */
const TONE_TOKEN: Record<Presentation["tone"], string> = {
  good: "--ov-good",
  warn: "--ov-warning",
  bad: "--ov-critical",
  info: "--ov-chart-1",
};

function toneStyle(tone: Presentation["tone"]): CSSProperties {
  const token = `var(${TONE_TOKEN[tone]})`;
  return {
    background: `color-mix(in srgb, ${token} 26%, var(--ov-bg))`,
    borderColor: token,
    color: `color-mix(in srgb, ${token} 18%, var(--ov-ink))`,
  };
}

export interface OutcomeScreenProps {
  outcome: DoorOutcome;
  guestName?: string | null;
  company?: string | null;
  segment?: string | null;
  plusOnes?: number;
  notes?: string[];
  opener?: string | null;
  detail?: string | null;
  latencyMs?: number | null;
  onDismiss: () => void;
}

export function OutcomeScreen({
  outcome,
  guestName,
  company,
  segment,
  plusOnes = 0,
  notes = [],
  opener,
  detail,
  latencyMs,
  onDismiss,
}: OutcomeScreenProps) {
  const p = PRESENTATION[outcome];

  return (
    <button
      type="button"
      onClick={onDismiss}
      aria-live="assertive"
      style={toneStyle(p.tone)}
      className="fixed inset-0 z-50 flex w-full flex-col items-center justify-center border-8 px-6 text-center"
    >
      <span aria-hidden className="text-[22vh] leading-none">
        {p.glyph}
      </span>

      <span className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">
        {p.label}
      </span>

      {guestName ? (
        <span className="ov-display mt-6 text-3xl sm:text-4xl">
          {guestName}
          {plusOnes > 0 ? (
            <span className="ml-3 align-middle text-xl opacity-80">
              +{plusOnes}
            </span>
          ) : null}
        </span>
      ) : null}

      {company ? (
        <span className="mt-1 text-lg opacity-80">
          {company}
          {segment && segment !== "PROSPECT" ? ` · ${segment}` : ""}
        </span>
      ) : null}

      {notes.length > 0 ? (
        <ul className="mt-5 max-w-xl space-y-1 text-base opacity-95">
          {notes.map((n) => (
            <li key={n}>• {n}</li>
          ))}
        </ul>
      ) : null}

      {opener ? (
        <p className="mt-5 max-w-xl text-lg italic opacity-90">“{opener}”</p>
      ) : null}

      <span className="mt-6 text-sm uppercase tracking-[0.18em] opacity-70">
        {detail ?? p.hint}
      </span>

      {typeof latencyMs === "number" ? (
        <span className="absolute bottom-4 right-5 font-mono text-xs opacity-50">
          {Math.round(latencyMs)} ms
        </span>
      ) : null}

      <span className="absolute bottom-4 left-5 text-xs uppercase tracking-[0.18em] opacity-50">
        Tap to scan next
      </span>
    </button>
  );
}
