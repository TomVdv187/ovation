import { whiteGloveSchema, type WhiteGlove } from "@ovation/core";

/**
 * The VIP white-glove checklist: four things somebody has to actually do before
 * a VIP walks in. `done` is an explicit escape hatch — a VIP who drives himself
 * still needs "transport" ticked off, and an organiser ticking it should not see
 * it come back as outstanding forever.
 */

export const WHITE_GLOVE_FIELDS = ["transport", "seating", "dietary", "host"] as const;
export type WhiteGloveField = (typeof WHITE_GLOVE_FIELDS)[number];

export function blankWhiteGlove(): WhiteGlove {
  return { transport: null, seating: null, dietary: null, host: null, done: [] };
}

/**
 * Read whatever is in the `Guest.whiteGlove` JSON column into a checklist we can
 * trust. Anything unparseable becomes a blank checklist rather than an error —
 * a malformed blob should not take the VIP screen down.
 */
export function readWhiteGlove(raw: unknown): WhiteGlove {
  if (raw === null || raw === undefined) return blankWhiteGlove();
  const parsed = whiteGloveSchema.safeParse(raw);
  return parsed.success ? { ...blankWhiteGlove(), ...parsed.data } : blankWhiteGlove();
}

/** A fresh checklist for a guest just promoted to VIP, pre-filled from what we know. */
export function openWhiteGlove(guest: { dietary: string | null }): WhiteGlove {
  return { ...blankWhiteGlove(), dietary: guest.dietary ?? null };
}

function isSet(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * What is still missing, as instructions somebody can act on. An item counts as
 * handled when its field is filled in *or* the organiser has ticked it in `done`.
 */
export function outstandingWhiteGlove(
  checklist: WhiteGlove,
  guest: { name: string; dietary: string | null },
): string[] {
  const done = new Set(checklist.done.map((d) => d.trim().toLowerCase()));
  const outstanding: string[] = [];

  if (!isSet(checklist.transport) && !done.has("transport")) {
    outstanding.push(`Arrange transport for ${guest.name}, or tick it off if they are making their own way.`);
  }
  if (!isSet(checklist.seating) && !done.has("seating")) {
    outstanding.push(`Assign ${guest.name} a table — VIPs should not be looking for their name on the night.`);
  }
  if (!isSet(checklist.dietary) && !done.has("dietary")) {
    outstanding.push(
      guest.dietary
        ? `Confirm the ${guest.dietary.toLowerCase()} cover with catering for ${guest.name}.`
        : `Check whether ${guest.name} has a dietary requirement before the menu is locked.`,
    );
  }
  if (!isSet(checklist.host) && !done.has("host")) {
    outstanding.push(`Assign a host to look after ${guest.name} from the door onwards.`);
  }

  return outstanding;
}
