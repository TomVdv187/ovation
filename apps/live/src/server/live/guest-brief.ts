import { whiteGloveSchema } from "@ovation/core";
import type { GuestSegmentT } from "@ovation/core";

/**
 * What the greeter needs in the two seconds between the beep and the handshake.
 *
 * Both fields are derived, not invented. The opener is assembled from columns
 * the guest actually has (title, company, interests, notes) with a fixed
 * template — no model call, because the door has no latency budget for one and
 * a hallucinated fact said out loud to a VIP is worse than no fact at all.
 */

export interface GuestBriefSource {
  name: string;
  company: string | null;
  title: string | null;
  segment: GuestSegmentT;
  dietary: string | null;
  plusOnes: number;
  interests: string[];
  notes: string | null;
  whiteGlove: unknown;
}

export function whiteGloveNotes(guest: GuestBriefSource): string[] {
  const notes: string[] = [];

  const parsed = whiteGloveSchema.safeParse(guest.whiteGlove);
  if (parsed.success) {
    const wg = parsed.data;
    const done = new Set(wg.done);
    if (wg.host) notes.push(`Host: ${wg.host}`);
    if (wg.seating) notes.push(`Seating: ${wg.seating}`);
    // A transport line already ticked off the checklist is noise at the door.
    if (wg.transport && !done.has(wg.transport)) {
      notes.push(`Transport: ${wg.transport}`);
    }
    if (wg.dietary) notes.push(`Dietary: ${wg.dietary}`);
  }

  if (guest.dietary) notes.push(`Dietary: ${guest.dietary}`);
  if (guest.plusOnes > 0) {
    notes.push(`+${guest.plusOnes} guest${guest.plusOnes === 1 ? "" : "s"}`);
  }
  if (guest.notes) notes.push(guest.notes);

  // De-duplicate: whiteGlove.dietary and Guest.dietary often say the same thing.
  return [...new Set(notes)];
}

export function conversationOpener(guest: GuestBriefSource): string | null {
  const role = [guest.title, guest.company].filter(Boolean).join(" at ");
  const interest = guest.interests[0];

  if (role && interest) {
    return `${role} — ask about ${lower(interest)}.`;
  }
  if (role) return `${role}.`;
  if (interest) return `Ask about ${lower(interest)}.`;
  return null;
}

function lower(s: string): string {
  // Interests are title-cased in the seed ("Climate Tech"); leave acronyms alone.
  return s
    .split(" ")
    .map((w) => (w.length > 3 && w === w.toUpperCase() ? w : w.toLowerCase()))
    .join(" ");
}
