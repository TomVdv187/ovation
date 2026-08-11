import { describe, expect, it } from "vitest";
import { scoreEngagement } from "../src/engine/engagement";
import { predictNoShow } from "../src/engine/no-show";
import { recommendRecovery } from "../src/engine/recovery";
import { rulesV1 } from "../src/engine/rules-v1";
import type { SeatPressure } from "../src/engine/types";
import { eventContextOf } from "../src/service";
import { daysBefore, EVENT, signals } from "./support/factories";

const ctx = eventContextOf(EVENT);

function assess(guest: Parameters<typeof rulesV1.assess>[0]) {
  return rulesV1.assess(guest, ctx);
}

const noPressure: SeatPressure = {
  capacity: 250,
  waitlisted: 0,
  predictedAttending: 120,
  seatSwapWorthwhile: false,
};

const fullRoom: SeatPressure = {
  capacity: 100,
  waitlisted: 12,
  predictedAttending: 98,
  seatSwapWorthwhile: true,
};

describe("no-show prediction (rules-v1)", () => {
  it("does not punish a brand-new contact for silence it has not had time to break", () => {
    const base = { rsvpStatus: "INVITED" as const, email: "someone@solvenda.be" };
    const veteran = predictNoShow(signals({ id: "v", ...base, createdAt: daysBefore(75) }), ctx, 0);
    const newcomer = predictNoShow(signals({ id: "n", ...base, createdAt: daysBefore(3) }), ctx, 0);

    expect(veteran.noShowRisk).toBe("HIGH");
    expect(newcomer.noShowProbability).toBeLessThan(veteran.noShowProbability);
    expect(newcomer.noShowRisk).not.toBe("HIGH");
    expect(newcomer.drivers.find((d) => d.factor === "engagement_decay")?.detail).toContain(
      "silence counts for less",
    );
  });

  it("treats settled RSVP states as facts rather than forecasts", () => {
    expect(assess(signals({ id: "in", rsvpStatus: "CHECKED_IN" })).noShowProbability).toBe(0);
    expect(assess(signals({ id: "no", rsvpStatus: "DECLINED" })).noShowRisk).toBe("HIGH");
    expect(assess(signals({ id: "gone", rsvpStatus: "NO_SHOW" })).noShowProbability).toBe(1);
  });

  it("counts a paid ticket as sunk cost and a free seat as risk", () => {
    const shape = { rsvpStatus: "CONFIRMED" as const, emailOpens: 3, createdAt: daysBefore(60) };
    const paid = assess(signals({ id: "paid", ...shape, paidCents: 14_500 }));
    const free = assess(signals({ id: "free", ...shape, paidCents: 0 }));

    expect(paid.noShowProbability).toBeLessThan(free.noShowProbability);
    expect(free.riskDrivers.find((d) => d.factor === "ticket_type")?.detail).toContain(
      "free or unpaid seat",
    );
  });

  it("uses the email domain as a stand-in for travel, and says so", () => {
    const shape = { rsvpStatus: "CONFIRMED" as const, createdAt: daysBefore(60) };
    const local = assess(signals({ id: "l", ...shape, email: "a@helvion.be" }));
    const neighbour = assess(signals({ id: "n", ...shape, email: "a@helvion.nl" }));
    const far = assess(signals({ id: "f", ...shape, email: "a@helvion.jp" }));

    expect(local.noShowProbability).toBeLessThan(neighbour.noShowProbability);
    expect(neighbour.noShowProbability).toBeLessThan(far.noShowProbability);
    expect(local.riskDrivers.find((d) => d.factor === "travel_distance")?.detail).toContain("Belgium");
  });

  it("weighs how the guest behaved at the organisation's earlier events", () => {
    const shape = { rsvpStatus: "CONFIRMED" as const, createdAt: daysBefore(60), paidCents: 9_500 };
    const reliable = assess(
      signals({ id: "r", ...shape, history: { attended: 3, noShows: 0 } }),
    );
    const flaky = assess(signals({ id: "f", ...shape, history: { attended: 0, noShows: 2 } }));

    expect(flaky.noShowProbability).toBeGreaterThan(reliable.noShowProbability);
    expect(flaky.riskDrivers.find((d) => d.factor === "historic_behaviour")?.detail).toContain(
      "did not turn up",
    );
  });

  it("keeps probabilities inside the band their label promises", () => {
    for (const guest of [
      signals({ id: "1" }),
      signals({ id: "2", rsvpStatus: "CONFIRMED", emailClicks: 4, emailOpens: 8, paidCents: 20_000 }),
      signals({ id: "3", rsvpStatus: "WAITLISTED" }),
    ]) {
      const { noShowRisk, noShowProbability } = assess(guest);
      expect(noShowProbability).toBeGreaterThanOrEqual(0);
      expect(noShowProbability).toBeLessThanOrEqual(1);
      if (noShowRisk === "LOW") expect(noShowProbability).toBeLessThan(0.2);
      if (noShowRisk === "HIGH") expect(noShowProbability).toBeGreaterThanOrEqual(0.45);
    }
  });
});

describe("recovery actions", () => {
  it("recommends nothing for a healthy guest, and says why", () => {
    const guest = signals({
      id: "healthy",
      rsvpStatus: "CONFIRMED",
      emailOpens: 8,
      emailClicks: 4,
      pageVisits: 6,
      lastSeenAt: daysBefore(5),
      registeredAt: daysBefore(60),
      paidCents: 20_000,
    });
    const action = recommendRecovery(assess(guest), guest, ctx, noPressure);

    expect(action.action).toBe("NONE");
    expect(action.reason).toMatch(/chance of missing the night is normal/);
    expect(action.dueBy).toBeNull();
  });

  it("calls a high-risk VIP instead of emailing them again", () => {
    const guest = signals({ id: "vip", segment: "VIP", rsvpStatus: "INVITED" });
    const action = recommendRecovery(assess(guest), guest, ctx, noPressure);

    expect(action.action).toBe("PERSONAL_CALL");
    expect(action.reason).toContain("call from the host");
    // Deadlines come off the event date, never the clock.
    expect(action.dueBy?.toISOString()).toBe(daysBefore(14).toISOString());
  });

  it("offers a shaky confirmed seat to the waitlist only when the room is nearly full", () => {
    const guest = signals({
      id: "shaky",
      segment: "CLIENT",
      rsvpStatus: "CONFIRMED",
      email: "shaky@example.jp",
      createdAt: daysBefore(60),
    });
    const assessment = assess(guest);
    expect(assessment.noShowRisk).toBe("HIGH");

    expect(recommendRecovery(assessment, guest, ctx, fullRoom).action).toBe("SEAT_SWAP_WAITLIST");
    // With ninety empty chairs, bumping somebody costs goodwill and saves nothing.
    expect(recommendRecovery(assessment, guest, ctx, noPressure).action).toBe("PERSONAL_CALL");
  });

  it("emails rather than calls a high-risk guest with no relationship behind them", () => {
    const guest = signals({ id: "cold", segment: "PROSPECT", rsvpStatus: "INVITED" });
    expect(recommendRecovery(assess(guest), guest, ctx, noPressure).action).toBe(
      "RECONFIRMATION_EMAIL",
    );
  });

  it("leaves settled and waitlisted guests alone", () => {
    for (const status of ["CHECKED_IN", "DECLINED", "NO_SHOW", "WAITLISTED"] as const) {
      const guest = signals({ id: status, rsvpStatus: status });
      const action = recommendRecovery(assess(guest), guest, ctx, fullRoom);
      expect(action.action).toBe("NONE");
      expect(action.reason.length).toBeGreaterThan(20);
    }
  });

  it("never returns a risk without an action to go with it", () => {
    const guests = [
      signals({ id: "a" }),
      signals({ id: "b", rsvpStatus: "CONFIRMED", emailOpens: 4 }),
      signals({ id: "c", segment: "VIP", rsvpStatus: "CONFIRMED" }),
    ];
    for (const guest of guests) {
      const assessment = assess(guest);
      const action = recommendRecovery(assessment, guest, ctx, noPressure);
      expect(action.action).toBeTruthy();
      expect(action.reason).toBeTruthy();
      expect(scoreEngagement(guest, ctx).factors).toHaveLength(3);
    }
  });
});
