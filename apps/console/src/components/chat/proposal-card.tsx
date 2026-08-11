"use client";

import { useState } from "react";
import type { ActionRiskT, AgentAction, SideEffect } from "@ovation/core";

/**
 * The trust surface.
 *
 * A card states what changes, how heavy it is, and every knock-on effect the
 * agent predicted, before the organiser can approve it. Approve is the only
 * button in the console that causes anything to happen.
 */

const RISK: Record<
  ActionRiskT,
  { label: string; className: string; note: string }
> = {
  COSMETIC: {
    label: "Cosmetic",
    className: "border-good/40 bg-good/10 text-good",
    note: "Reversible, and nobody is contacted.",
  },
  OPERATIONAL: {
    label: "Operational",
    className: "border-warning/40 bg-warning/10 text-warning",
    note: "Changes how the event runs. Always needs you.",
  },
  OUTBOUND: {
    label: "Outbound",
    className: "border-serious/40 bg-serious/10 text-serious",
    note: "This leaves the building. It can never auto-approve.",
  },
  DESTRUCTIVE: {
    label: "Destructive",
    className: "border-critical/40 bg-critical/10 text-critical",
    note: "Hard to undo. It can never auto-approve.",
  },
};

export interface ProposalCardProps {
  action: AgentAction;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  busy?: boolean;
}

export function ProposalCard({
  action,
  onApprove,
  onReject,
  busy = false,
}: ProposalCardProps) {
  const [expanded, setExpanded] = useState(false);
  const risk = RISK[action.risk];
  const sideEffects = action.sideEffects as SideEffect[];
  const open = action.status === "PROPOSED";

  return (
    <article
      className="rounded-lg border border-line bg-surface-raised shadow-card"
      aria-label={`Proposal: ${action.summary}`}
    >
      <div className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-widest ${risk.className}`}
            >
              {risk.label}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-subtle">
              {action.type.replace(/_/g, " ")}
            </span>
          </div>
          <h4 className="ov-display mt-2 text-base leading-snug text-ink">
            {action.summary}
          </h4>
        </div>
      </div>

      <div className="px-4 py-3">
        <p className="text-[11px] uppercase tracking-widest text-ink-subtle">
          If you approve
        </p>
        <ul className="mt-2 space-y-2">
          {sideEffects.length === 0 ? (
            <li className="text-sm text-ink-muted">
              No side effects were predicted for this action.
            </li>
          ) : (
            sideEffects.map((effect, i) => (
              <li key={i} className="flex gap-2.5 text-sm">
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gold-dim"
                />
                <span className="min-w-0">
                  <span className="text-ink">{effect.label}</span>
                  {typeof effect.count === "number" && (
                    <span className="ml-1.5 font-mono text-xs text-gold">
                      {effect.count.toLocaleString("en-GB")}
                    </span>
                  )}
                  {effect.detail && (
                    <span className="mt-0.5 block whitespace-pre-wrap text-xs leading-relaxed text-ink-muted">
                      {effect.detail}
                    </span>
                  )}
                </span>
              </li>
            ))
          )}
        </ul>

        <p className="mt-3 text-xs text-ink-subtle">{risk.note}</p>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs text-ink-subtle underline underline-offset-4 transition-colors hover:text-ink-muted"
          aria-expanded={expanded}
        >
          {expanded ? "Hide" : "Show"} the exact payload
        </button>
        {expanded && (
          <pre className="mt-2 max-h-52 overflow-auto rounded border border-line bg-surface-sunken p-2.5 font-mono text-[11px] leading-relaxed text-ink-muted">
            {JSON.stringify(action.payload, null, 2)}
          </pre>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-4 py-3">
        {open ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onApprove(action.id)}
              className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink-inverse transition-colors duration-150 ease-ov hover:bg-gold-bright disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Working" : "Approve"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onReject(action.id)}
              className="rounded border border-line-strong px-3 py-1.5 text-sm text-ink-muted transition-colors duration-150 ease-ov hover:border-critical/60 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reject
            </button>
          </>
        ) : (
          <DecidedBadge action={action} />
        )}
      </div>
    </article>
  );
}

function DecidedBadge({ action }: { action: AgentAction }) {
  const map: Record<string, { text: string; className: string }> = {
    EXECUTED: { text: "Approved and applied", className: "text-good" },
    APPROVED: { text: "Approved", className: "text-good" },
    REJECTED: { text: "Rejected. Nothing changed.", className: "text-ink-subtle" },
    FAILED: { text: "Failed. Nothing changed.", className: "text-critical" },
  };
  const state = map[action.status] ?? {
    text: action.status,
    className: "text-ink-subtle",
  };

  return (
    <p className={`text-xs ${state.className}`}>
      {state.text}
      {action.error && (
        <span className="ml-1 text-ink-subtle">({action.error})</span>
      )}
    </p>
  );
}
