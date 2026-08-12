import { describe, expect, it, vi } from "vitest";
import type { InviteWriter, WriteRequest } from "../src/invites/types";

/**
 * The router half of personaliseInvite: that drafts land as PROPOSED
 * EmailMessage rows and nothing is ever sent. The model is stubbed here — its
 * judgement is the eval's business, the wiring is this file's.
 */

const stub = vi.hoisted(() => {
  const seen: WriteRequest[] = [];
  let keyPresent = true;
  const writer: InviteWriter = {
    model: "stub",
    write: async (request) => {
      seen.push(request);
      const first = request.guest.name.split(" ")[0] ?? "there";
      return {
        subject: `Meridian Summit 2026 for ${first}`.slice(0, 55),
        body: [
          `Hi ${first},`,
          "",
          `Meridian Summit 2026 is at Horta Hall on Thursday 24 September, and I would like ${request.guest.company ?? "you"} in the room. It is an evening for the people who build Belgium's next decade, and the panel on capital, talent and the Benelux advantage is the part I think you would take most from.`,
          "",
          // Every noun here is drawn from the event record; the checker rejects
          // anything that is not, which is exactly what it is for.
          "Doors open at 18:30, dinner is seated, and the evening closes with a nightcap. If you would rather not, one line back is plenty and I will pass the seat on.",
          "",
          "Kind regards,",
          "Meridian Collective",
        ].join("\n"),
        groundedOn: [`company: ${request.guest.company ?? "unknown"}`],
      };
    },
  };
  return {
    seen,
    writer,
    setKeyPresent: (value: boolean) => {
      keyPresent = value;
    },
    isKeyPresent: () => keyPresent,
  };
});

vi.mock("../src/invites/writer", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/invites/writer")>();
  return {
    ...original,
    hasApiKey: () => stub.isKeyPresent(),
    anthropicWriter: () => stub.writer,
  };
});

const { EVENT } = await import("./support/factories");
const { buildWorld, harness } = await import("./support/world");

describe("guests.personaliseInvite", () => {
  it("stores one PROPOSED, personalised email per guest and never sends", async () => {
    const world = buildWorld();
    const { caller } = harness(world);

    const result = await caller.personaliseInvite({
      eventId: EVENT.id,
      guestIds: ["g-vip", "g-client", "g-press"],
      intent: "INVITE",
    });

    expect(result.status).toBe("PROPOSED");
    expect(result.campaignId).toMatch(/^invite-/);
    expect(result.emails.map((e) => e.guestId).sort()).toEqual(["g-client", "g-press", "g-vip"]);

    expect(world.emails).toHaveLength(3);
    for (const row of world.emails) {
      expect(row.status).toBe("PROPOSED");
      expect(row.personalised).toBe(true);
      expect(row.campaignId).toBe(result.campaignId);
      expect(row.eventId).toBe(EVENT.id);
      // Nothing in this package knows how to send; there is no provider id or
      // sent timestamp to set.
      expect(row).not.toHaveProperty("sentAt");
      expect(row).not.toHaveProperty("providerMessageId");
    }

    for (const email of result.emails) {
      expect(email.emailMessageId).toBeTruthy();
      expect(email.subject.length).toBeLessThan(60);
      expect(email.groundedOn.length).toBeGreaterThan(0);
    }
  });

  it("writes from each guest's own record, so no two briefs are the same", async () => {
    stub.seen.length = 0;
    const { caller } = harness();
    await caller.personaliseInvite({
      eventId: EVENT.id,
      guestIds: ["g-vip", "g-press"],
      intent: "REMINDER",
      brief: "mention the seated dinner",
    });

    expect(stub.seen).toHaveLength(2);
    expect(stub.seen.every((r) => r.intent === "REMINDER")).toBe(true);
    expect(stub.seen.every((r) => r.brief === "mention the seated dinner")).toBe(true);
    const byId = new Map(stub.seen.map((r) => [r.guest.id, r.guest]));
    expect(byId.get("g-vip")?.company).toBe("Helvion Group");
    expect(byId.get("g-press")?.company).toBe("De Tijd");
    // What each guest actually bought reaches the writer, so the copy can lean
    // on it instead of guessing.
    expect(byId.get("g-vip")?.ticketTier).toBe("VIP Table");
    expect(byId.get("g-press")?.ticketTier).toBeNull();
  });

  it("files the draft under the EmailKind the approval queue expects", async () => {
    const world = buildWorld();
    const { caller } = harness(world);
    await caller.personaliseInvite({
      eventId: EVENT.id,
      guestIds: ["g-wait-partner"],
      intent: "WAITLIST_PROMOTION",
      campaignId: "wave-2",
    });

    expect(world.emails[0]?.kind).toBe("INVITE");
    expect(world.emails[0]?.campaignId).toBe("wave-2");
  });

  it("refuses a guest from another event rather than writing to a stranger", async () => {
    const { caller } = harness();
    await expect(
      caller.personaliseInvite({ eventId: EVENT.id, guestIds: ["someone-else"], intent: "INVITE" }),
    ).rejects.toThrow(/None of those guests/);
  });

  it("says so plainly when there is no API key, instead of falling back to a template", async () => {
    stub.setKeyPresent(false);
    try {
      const { caller } = harness();
      await expect(
        caller.personaliseInvite({ eventId: EVENT.id, guestIds: ["g-vip"], intent: "INVITE" }),
      ).rejects.toThrow(/no template fallback by design/);
    } finally {
      stub.setKeyPresent(true);
    }
  });
});
