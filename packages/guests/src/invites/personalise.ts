import { randomUUID } from "node:crypto";
import { explainFailures, inspectEmail, type CheckReport } from "./checks";
import { createLimiter, mapLimited, type Limiter, type LimiterOptions } from "./limiter";
import type {
  CampaignIntent,
  EventFacts,
  GuestFacts,
  InviteWriter,
  WrittenEmail,
} from "./types";

/**
 * Write one email per guest, check it, and hand back the drafts.
 *
 * Nothing here sends anything. The drafts are stored as EmailMessage rows with
 * status PROPOSED by the caller, and the Conductor's approval flow is what turns
 * a PROPOSED row into a sent one. There is no delivery client in this package
 * and there should never be.
 */

export const DEFAULT_MAX_ATTEMPTS = 3;

export interface Draft {
  guest: GuestFacts;
  email: WrittenEmail;
  report: CheckReport;
  attempts: number;
}

export interface RejectedDraft {
  guestId: string;
  attempts: number;
  reasons: string[];
}

export interface PersonaliseResult {
  drafts: Draft[];
  /** Guests we could not write an acceptable email for. Deliberately not silent. */
  rejected: RejectedDraft[];
}

export interface PersonaliseOptions {
  event: EventFacts;
  guests: GuestFacts[];
  intent: CampaignIntent;
  brief?: string;
  writer: InviteWriter;
  limits?: Partial<LimiterOptions>;
  limiter?: Limiter;
  maxAttempts?: number;
  onWarning?: (warning: { guestId: string; attempt: number; reason: string }) => void;
}

export async function personaliseBatch(options: PersonaliseOptions): Promise<PersonaliseResult> {
  const {
    event,
    guests,
    intent,
    brief,
    writer,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    onWarning,
  } = options;

  const limiter = options.limiter ?? createLimiter(options.limits);

  type Settled = { draft?: Draft; rejected?: RejectedDraft };

  const settled = await mapLimited(guests, limiter, async (guest): Promise<Settled> => {
    const reasons: string[] = [];
    let retryHint: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const email = await writer.write({ guest, event, intent, brief, retryHint });
        const report = inspectEmail(email, guest, event);
        if (report.ok) return { draft: { guest, email, report, attempts: attempt } };

        // Feed the failures back rather than throwing them away: most rejections
        // are a forgotten company name or an over-long subject, both of which the
        // model fixes first time when told.
        retryHint = explainFailures(report);
        reasons.push(...report.failures.map((f) => `${f.check}: ${f.detail}`));
        onWarning?.({ guestId: guest.id, attempt, reason: retryHint });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        reasons.push(reason);
        retryHint = undefined;
        onWarning?.({ guestId: guest.id, attempt, reason });
      }
    }

    return { rejected: { guestId: guest.id, attempts: maxAttempts, reasons } };
  });

  return {
    drafts: settled.flatMap((r) => (r.draft ? [r.draft] : [])),
    rejected: settled.flatMap((r) => (r.rejected ? [r.rejected] : [])),
  };
}

/**
 * A campaign id groups the drafts so the approval flow can act on the batch.
 * Random rather than derived, so re-running a campaign never merges two waves
 * of drafts into one approval decision.
 */
export function newCampaignId(intent: CampaignIntent): string {
  return `${intent.toLowerCase().replace(/_/g, "-")}-${randomUUID().slice(0, 8)}`;
}
