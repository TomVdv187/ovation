import { describe, expect, it } from "vitest";
import { EVENT, ORG_ID } from "./support/factories";
import { buildWorld, harness } from "./support/world";

describe("guests.list", () => {
  it("returns every guest scored, segmented, risked and with an action to take", async () => {
    const { caller } = harness();
    const page = await caller.list({ eventId: EVENT.id, limit: 50, sortBy: "engagementScore", sortDir: "desc" });

    expect(page.total).toBe(10);
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toBeNull();

    for (const guest of page.items) {
      expect(guest.engagementFactors).toHaveLength(3);
      expect(guest.noShowProbability).not.toBeNull();
      expect(guest.recoveryAction).not.toBeNull();
      expect(guest.recoveryAction?.reason.length).toBeGreaterThan(20);
      expect(["LOW", "MEDIUM", "HIGH"]).toContain(guest.noShowRisk);
    }
  });

  it("does not serve the placeholder scores the seed left in the columns", async () => {
    const world = buildWorld();
    const { caller } = harness(world);
    const stored = world.guests.map((g) => g.engagementScore);
    const page = await caller.list({ eventId: EVENT.id, limit: 50, sortBy: "name", sortDir: "asc" });

    expect(stored.every((s) => s === 0)).toBe(true);
    expect(page.items.some((g) => g.engagementScore > 0)).toBe(true);
  });

  it("sorts by engagement, then by risk, in both directions", async () => {
    const { caller } = harness();
    const desc = await caller.list({ eventId: EVENT.id, limit: 50, sortBy: "engagementScore", sortDir: "desc" });
    const asc = await caller.list({ eventId: EVENT.id, limit: 50, sortBy: "engagementScore", sortDir: "asc" });

    const scores = desc.items.map((g) => g.engagementScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);

    const ascScores = asc.items.map((g) => g.engagementScore);
    expect([...ascScores].sort((a, b) => a - b)).toEqual(ascScores);
    // Both directions cover the same guests; ties fall back to id ascending
    // either way, which is what keeps a page boundary from skipping anyone.
    expect(new Set(asc.items.map((g) => g.id))).toEqual(new Set(desc.items.map((g) => g.id)));

    const byRisk = await caller.list({
      eventId: EVENT.id,
      limit: 50,
      sortBy: "noShowProbability",
      sortDir: "desc",
    });
    const risks = byRisk.items.map((g) => g.noShowProbability ?? 0);
    expect([...risks].sort((a, b) => b - a)).toEqual(risks);
  });

  it("filters on segment, rsvp state, derived risk and free text", async () => {
    const { caller } = harness();
    const base = { eventId: EVENT.id, limit: 50, sortBy: "name", sortDir: "asc" } as const;

    const vips = await caller.list({ ...base, segment: "VIP" });
    expect(vips.items.map((g) => g.id)).toEqual(["g-vip"]);

    const waitlisted = await caller.list({ ...base, rsvpStatus: "WAITLISTED" });
    expect(waitlisted.items.map((g) => g.id).sort()).toEqual(["g-wait-partner", "g-wait-prospect"]);

    const risky = await caller.list({ ...base, noShowRisk: "HIGH" });
    expect(risky.total).toBeGreaterThan(0);
    expect(risky.items.every((g) => g.noShowRisk === "HIGH")).toBe(true);

    const search = await caller.list({ ...base, search: "helvion" });
    expect(search.items.map((g) => g.id).sort()).toEqual(["g-sponsor-contact", "g-vip"]);
  });

  it("pages without skipping or repeating a guest", async () => {
    const { caller } = harness();
    const seen: string[] = [];
    let cursor: string | null | undefined;

    for (let page = 0; page < 10; page++) {
      const result = await caller.list({
        eventId: EVENT.id,
        limit: 3,
        sortBy: "engagementScore",
        sortDir: "desc",
        cursor,
      });
      seen.push(...result.items.map((g) => g.id));
      cursor = result.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);
  });

  it("refuses an event belonging to another organisation", async () => {
    const { caller } = harness(buildWorld(), "org-someone-else");
    await expect(caller.list({ eventId: EVENT.id, limit: 50, sortBy: "name", sortDir: "asc" })).rejects.toThrow(
      /No event/,
    );
  });
});

describe("guests.get", () => {
  it("returns the same numbers list does", async () => {
    const { caller } = harness();
    const page = await caller.list({ eventId: EVENT.id, limit: 50, sortBy: "name", sortDir: "asc" });
    const first = page.items[0];
    expect(first).toBeDefined();

    const one = await caller.get({ id: first?.id ?? "" });
    expect(one.engagementScore).toBe(first?.engagementScore);
    expect(one.noShowProbability).toBe(first?.noShowProbability);
    expect(one.engagementFactors).toEqual(first?.engagementFactors);
  });

  it("will not reach into another organisation's guest", async () => {
    const { caller } = harness(buildWorld(), "org-someone-else");
    await expect(caller.get({ id: "g-vip" })).rejects.toThrow(/No guest/);
  });
});

describe("guests.score", () => {
  it("is byte-identical across runs, and names the engine that produced it", async () => {
    const { caller, fake } = harness();
    const first = await caller.score({ eventId: EVENT.id, persist: true });
    const second = await caller.score({ eventId: EVENT.id, persist: true });

    expect(first.engine).toBe("rules-v1");
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    // The first run wrote the recomputed values; the second found nothing to fix.
    const firstRunWrites = fake.writes.length;
    expect(firstRunWrites).toBeGreaterThan(0);
    await caller.score({ eventId: EVENT.id, persist: true });
    expect(fake.writes.length).toBe(firstRunWrites);
  });

  it("gives every guest exactly three factors and a recovery action", async () => {
    const { caller } = harness();
    const { results } = await caller.score({ eventId: EVENT.id, persist: false });

    expect(results).toHaveLength(10);
    for (const result of results) {
      expect(result.factors).toHaveLength(3);
      expect(result.recoveryAction.action).toBeTruthy();
      expect(result.recoveryAction.reason.length).toBeGreaterThan(20);
    }
  });

  it("writes nothing when asked not to", async () => {
    const { caller, fake } = harness();
    await caller.score({ eventId: EVENT.id, persist: false });
    expect(fake.writes).toEqual([]);
  });

  it("scores a subset without letting the subset change the answer", async () => {
    const { caller } = harness();
    const all = await caller.score({ eventId: EVENT.id, persist: false });
    const one = await caller.score({ eventId: EVENT.id, guestIds: ["g-vip"], persist: false });

    expect(one.results).toHaveLength(1);
    expect(one.results[0]).toEqual(all.results.find((r) => r.guestId === "g-vip"));
  });

  it("persists the recovery action in a shape the column can hold", async () => {
    const { caller, fake } = harness();
    await caller.score({ eventId: EVENT.id, persist: true });

    const write = fake.writes.find((w) => w.id === "g-vip");
    expect(write).toBeDefined();
    const action = write?.data["recoveryAction"] as { action: string; dueBy: string | null };
    expect(typeof action.action).toBe("string");
    expect(action.dueBy === null || typeof action.dueBy === "string").toBe(true);
    expect(JSON.parse(JSON.stringify(write?.data))).toBeTruthy();
  });
});

describe("guests.segment", () => {
  it("infers from company, title, sponsorship and spend", async () => {
    const { caller } = harness();
    const { assignments } = await caller.segment({ eventId: EVENT.id, overrides: [] });
    const by = new Map(assignments.map((a) => [a.guestId, a]));

    expect(by.get("g-vip")?.segment).toBe("VIP");
    expect(by.get("g-press")?.segment).toBe("PRESS");
    expect(by.get("g-sponsor-contact")?.segment).toBe("PARTNER");
    expect(by.get("g-wait-partner")?.segment).toBe("PARTNER");
    expect(by.get("g-client")?.segment).toBe("CLIENT");
    expect(by.get("g-silent")?.segment).toBe("PROSPECT");
    expect(assignments.every((a) => a.overridden === false)).toBe(true);
  });

  it("lets an organiser override inference and says so honestly", async () => {
    const { caller, fake } = harness();
    const { assignments } = await caller.segment({
      eventId: EVENT.id,
      guestIds: ["g-silent"],
      overrides: [{ guestId: "g-silent", segment: "VIP" }],
    });

    const assignment = assignments.find((a) => a.guestId === "g-silent");
    expect(assignment?.segment).toBe("VIP");
    expect(assignment?.overridden).toBe(true);
    expect(assignment?.reason).toContain("Inference would have said PROSPECT");

    // A new VIP gets a checklist opened for them in the same breath.
    const write = fake.writes.find((w) => w.id === "g-silent");
    expect(write?.data["segment"]).toBe("VIP");
    expect(write?.data["whiteGlove"]).toMatchObject({ transport: null, done: [] });
  });

  it("honours an override for a guest outside the requested subset", async () => {
    const { caller } = harness();
    const { assignments } = await caller.segment({
      eventId: EVENT.id,
      guestIds: ["g-client"],
      overrides: [{ guestId: "g-press", segment: "VIP" }],
    });

    expect(assignments.map((a) => a.guestId).sort()).toEqual(["g-client", "g-press"]);
    expect(assignments.find((a) => a.guestId === "g-press")?.segment).toBe("VIP");
  });

  it("does not overwrite a checklist an organiser has already started", async () => {
    const world = buildWorld();
    const { caller, fake } = harness(world);
    await caller.segment({
      eventId: EVENT.id,
      guestIds: ["g-vip"],
      overrides: [{ guestId: "g-vip", segment: "CLIENT" }],
    });
    await caller.segment({
      eventId: EVENT.id,
      guestIds: ["g-vip"],
      overrides: [{ guestId: "g-vip", segment: "VIP" }],
    });

    const back = fake.writes.filter((w) => w.id === "g-vip").at(-1);
    expect(back?.data["whiteGlove"]).toBeUndefined();
    expect(world.guests.find((g) => g.id === "g-vip")?.whiteGlove).toMatchObject({
      transport: "Car from Antwerpen-Centraal",
    });
  });
});

describe("guests.waitlistSuggestions", () => {
  it("reports capacity against predicted attendance and ranks who to promote", async () => {
    const { caller } = harness();
    const plan = await caller.waitlistSuggestions({ eventId: EVENT.id });

    expect(plan.capacity).toBe(250);
    expect(plan.confirmed).toBeGreaterThan(0);
    expect(plan.predictedAttending).toBeLessThanOrEqual(plan.confirmed);
    expect(plan.freeSeats).toBe(plan.capacity - plan.predictedAttending);

    expect(plan.promote.map((p) => p.guestId)).toEqual(["g-wait-partner", "g-wait-prospect"]);
    expect(plan.promote[0]?.rank).toBe(1);
    expect(plan.promote[1]?.rank).toBe(2);
    expect(plan.promote[0]?.name).toBe("Bram Willems");
    expect(plan.promote[0]?.reason).toContain("Nexa Systems");
  });
});

describe("guests.vipChecklist", () => {
  it("lists VIPs with what is still outstanding", async () => {
    const { caller } = harness();
    const { guests } = await caller.vipChecklist({ eventId: EVENT.id });

    expect(guests.map((g) => g.guestId)).toEqual(["g-vip"]);
    const vip = guests[0];
    expect(vip?.whiteGlove.transport).toBe("Car from Antwerpen-Centraal");
    expect(vip?.outstanding).toHaveLength(3);
    expect(vip?.outstanding.some((item) => item.includes("vegetarian cover"))).toBe(true);
    expect(vip?.outstanding.some((item) => item.includes("transport"))).toBe(false);
  });

  it("still lists a VIP nobody has opened a checklist for, with everything outstanding", async () => {
    const world = buildWorld();
    const vip = world.guests.find((g) => g.id === "g-vip");
    if (vip) vip.whiteGlove = null;

    const { caller } = harness(world);
    const { guests } = await caller.vipChecklist({ eventId: EVENT.id });
    expect(guests[0]?.outstanding).toHaveLength(4);
  });
});

describe("multi-tenancy", () => {
  it("rejects a user with no organisation", async () => {
    const { caller } = harness(buildWorld(), null);
    await expect(caller.waitlistSuggestions({ eventId: EVENT.id })).rejects.toThrow(
      /not attached to an organisation/,
    );
  });

  it("scopes historic behaviour to the organisation's own events", async () => {
    const world = buildWorld();
    // The same person, a no-show at another organisation's event. It must not
    // count against them here.
    world.events.push({ ...EVENT, id: "evt-other-org", organisationId: "org-rival" });
    world.guests.push({
      ...(world.guests[0] as (typeof world.guests)[number]),
      id: "g-elsewhere",
      eventId: "evt-other-org",
      rsvpStatus: "NO_SHOW",
    });

    const { caller } = harness(world);
    const scoped = await caller.score({ eventId: EVENT.id, persist: false });

    const clean = harness(buildWorld());
    const baseline = await clean.caller.score({ eventId: EVENT.id, persist: false });

    expect(JSON.stringify(scoped.results)).toBe(JSON.stringify(baseline.results));
    expect(ORG_ID).not.toBe("org-rival");
  });
});
