import type { z } from "zod";
import type { Guest, matchmakingOutput, Sponsor } from "@ovation/core";

export type MatchmakingOutput = z.infer<typeof matchmakingOutput>;
export type Match = MatchmakingOutput["matches"][number];

/**
 * Ranked introductions for the host companion.
 *
 * Pure: it takes guests and sponsors that the caller fetched **through the
 * guests and revenue contracts** and returns a ranking. It never touches the
 * database, so it stays testable and so this app never learns the shape of
 * another agent's tables.
 *
 * Two kinds of match, scored on one scale:
 *
 *  - **Affinity** — shared interests, then same industry, then complementary
 *    seniority. The reasons array carries the actual overlap so the host has
 *    something true to say out loud.
 *  - **Sponsor target account** — a signed sponsor named this guest's company
 *    on their target list. That is a commercial obligation the event owes
 *    someone, so it outranks a merely pleasant conversation.
 *
 * Only guests who are in the room are proposed: introducing someone to a
 * person who has not arrived is the fastest way to lose a host's trust.
 */

const SPONSOR_BASE = 0.6;
const SHARED_INTEREST = 0.18;
const SAME_INDUSTRY = 0.12;
const BOTH_SENIOR = 0.08;
const SEGMENT_BONUS: Partial<Record<Guest["segment"], number>> = {
  VIP: 0.1,
  CLIENT: 0.05,
  PARTNER: 0.04,
};

const SENIOR = /\b(ceo|cto|cfo|coo|founder|managing director|board|partner|vp|head of|director)\b/i;

export interface RankInput {
  /** The guest the host is standing next to. Omit for "who should meet whom". */
  subject: Guest | null;
  /** Everyone at the event, from `guests.list`. */
  guests: Guest[];
  /** Sponsors from `revenue.sponsors`; empty when the Treasury is still pending. */
  sponsors: Sponsor[];
  /** Guest ids already through the door. */
  arrived: ReadonlySet<string>;
  /** `${a}|${b}` pairs already introduced, order-independent (see pairKey). */
  introduced: ReadonlySet<string>;
  limit: number;
}

export function rankMatches(input: RankInput): MatchmakingOutput {
  const { subject, guests, sponsors, arrived, introduced, limit } = input;

  const candidates = guests.filter(
    (g) => g.id !== subject?.id && arrived.has(g.id),
  );

  const targetIndex = sponsorTargetIndex(sponsors);

  const scored: Match[] = candidates.map((g) => {
    const reasons: string[] = [];
    let score = 0;
    let sponsorId: string | null = null;

    const sponsorHit = g.company ? targetIndex.get(normalise(g.company)) : null;
    if (sponsorHit) {
      sponsorId = sponsorHit.id;
      score += SPONSOR_BASE;
      reasons.push(
        `${sponsorHit.name} named ${g.company} as a target account`,
      );
    }

    if (subject) {
      const shared = intersect(subject.interests, g.interests);
      if (shared.length > 0) {
        score += Math.min(3, shared.length) * SHARED_INTEREST;
        reasons.push(`Both interested in ${shared.slice(0, 3).join(", ")}`);
      }

      if (
        subject.company &&
        g.company &&
        normalise(subject.company) === normalise(g.company)
      ) {
        // Same employer is not an introduction worth making.
        score -= 0.5;
        reasons.push(`Same company as ${subject.name}`);
      } else if (sameIndustry(subject, g)) {
        score += SAME_INDUSTRY;
        reasons.push("Same industry");
      }

      if (SENIOR.test(subject.title ?? "") && SENIOR.test(g.title ?? "")) {
        score += BOTH_SENIOR;
        reasons.push("Peer seniority");
      }
    } else {
      // No subject: rank the room by who is most worth walking over to.
      if (g.interests.length > 0) {
        reasons.push(`Interested in ${g.interests.slice(0, 2).join(", ")}`);
      }
    }

    score += SEGMENT_BONUS[g.segment] ?? 0;
    score += (g.engagementScore / 100) * 0.1;
    if (g.segment === "VIP") reasons.push("VIP");

    if (reasons.length === 0 && g.title && g.company) {
      reasons.push(`${g.title} at ${g.company}`);
    }

    return {
      guestId: g.id,
      name: g.name,
      company: g.company,
      segment: g.segment,
      score: clamp01(score),
      reasons,
      sponsorId,
      introduced: subject ? introduced.has(pairKey(subject.id, g.id)) : false,
    };
  });

  return {
    matches: scored
      .filter((m) => m.score > 0)
      .sort(
        (a, b) =>
          Number(a.introduced) - Number(b.introduced) ||
          b.score - a.score ||
          a.name.localeCompare(b.name),
      )
      .slice(0, limit),
  };
}

/** Order-independent key so A-met-B and B-met-A are the same fact. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function sponsorTargetIndex(sponsors: Sponsor[]): Map<string, Sponsor> {
  const index = new Map<string, Sponsor>();
  for (const s of sponsors) {
    // An unsigned prospect's wish list is not an obligation.
    if (s.status !== "SIGNED" && s.status !== "SERVICED") continue;
    for (const account of s.targetAccounts) {
      const key = normalise(account);
      if (!index.has(key)) index.set(key, s);
    }
  }
  return index;
}

function sameIndustry(a: Guest, b: Guest): boolean {
  // No industry column exists; the honest proxy is a shared interest tag that
  // both guests list first, which the seed uses as a sector marker.
  return Boolean(
    a.interests[0] && b.interests[0] && a.interests[0] === b.interests[0],
  );
}

function intersect(a: string[], b: string[]): string[] {
  const set = new Set(a.map(normalise));
  return b.filter((x) => set.has(normalise(x)));
}

function normalise(s: string): string {
  return s.trim().toLowerCase();
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Math.round(n * 1000) / 1000));
}

// ── introduction tracking ─────────────────────────────────────

/**
 * There is no Introduction table in the schema (CONTRACT_CHANGES CC-002), and
 * writing this onto another agent's Guest.notes column would be worse than
 * keeping it in memory. Scoped per process, which covers one night's ops on
 * one box; it does not survive a restart, and the host UI says so.
 */
const globalForIntros = globalThis as unknown as {
  ovationIntroductions?: Map<string, Set<string>>;
};
const intros = (globalForIntros.ovationIntroductions ??= new Map());

export function markIntroduced(
  eventId: string,
  a: string,
  b: string,
): void {
  let set = intros.get(eventId);
  if (!set) {
    set = new Set();
    intros.set(eventId, set);
  }
  set.add(pairKey(a, b));
}

export function introductionsFor(eventId: string): ReadonlySet<string> {
  return intros.get(eventId) ?? new Set<string>();
}
