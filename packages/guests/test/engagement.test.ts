import { describe, expect, it } from "vitest";
import { scoreEngagement } from "../src/engine/engagement";
import { eventContextOf } from "../src/service";
import { daysBefore, EVENT, signals } from "./support/factories";

const ctx = eventContextOf(EVENT);

describe("engagement scoring", () => {
  it("gives a brand-new contact a zero score that explains itself rather than a verdict", () => {
    const guest = signals({ id: "new", createdAt: daysBefore(3) });
    const { score, factors } = scoreEngagement(guest, ctx);

    expect(score).toBe(0);
    expect(factors).toHaveLength(3);
    // The absence of signal is the story, so it leads.
    expect(factors[0]?.factor).toBe("new_contact");
    expect(factors[0]?.detail).toContain("3 days before the doors open");
    expect(factors.every((f) => typeof f.detail === "string" && f.detail.endsWith("."))).toBe(true);
  });

  it("gives a silent invited guest a zero score, and does not excuse it as newness", () => {
    const guest = signals({ id: "silent", createdAt: daysBefore(75) });
    const { score, factors } = scoreEngagement(guest, ctx);

    expect(score).toBe(0);
    expect(factors).toHaveLength(3);
    expect(factors.map((f) => f.factor)).toEqual([
      "link_clicks",
      "rsvp_commitment",
      "email_opens",
    ]);
    expect(factors.map((f) => f.factor)).not.toContain("new_contact");
    expect(factors[0]?.detail).toContain("never clicked");
  });

  it("caps a fully engaged VIP at 100 and leads with the strongest real signal", () => {
    const guest = signals({
      id: "vip",
      segment: "VIP",
      rsvpStatus: "CONFIRMED",
      emailOpens: 8,
      emailClicks: 4,
      pageVisits: 6,
      plusOnes: 1,
      lastSeenAt: daysBefore(6),
      registeredAt: daysBefore(70),
      paidCents: 120_000,
    });
    const { score, factors } = scoreEngagement(guest, ctx);

    expect(score).toBe(100);
    expect(factors).toHaveLength(3);
    expect(factors.map((f) => f.factor)).toEqual([
      "link_clicks",
      "rsvp_commitment",
      "email_opens",
    ]);
    expect(factors[0]?.weight).toBeGreaterThan(factors[1]?.weight ?? 0);
  });

  it("always returns exactly three factors, whatever the guest looks like", () => {
    const shapes = [
      signals({ id: "a" }),
      signals({ id: "b", rsvpStatus: "DECLINED" }),
      signals({ id: "c", rsvpStatus: "CHECKED_IN", emailOpens: 2 }),
      signals({ id: "d", notes: "Looking forward to it, thank you!" }),
      signals({ id: "e", emailClicks: 99, emailOpens: 99, pageVisits: 99 }),
    ];
    for (const shape of shapes) {
      expect(scoreEngagement(shape, ctx).factors).toHaveLength(3);
    }
  });

  it("reads reply tone from the notes an organiser logged", () => {
    const warm = scoreEngagement(signals({ id: "warm", notes: "Looking forward to it." }), ctx);
    const cold = scoreEngagement(
      signals({ id: "cold", notes: "Unfortunately I have a clash that evening." }),
      ctx,
    );

    expect(warm.score).toBeGreaterThan(cold.score);
    const coldFactor = cold.contributions.find((c) => c.factor === "reply_sentiment");
    expect(coldFactor?.weight).toBeLessThan(0);
    expect(coldFactor?.detail).toContain("hesitantly");
  });

  it("is a pure function of the data — the same guest scores the same twice", () => {
    const guest = signals({
      id: "repeat",
      emailOpens: 3,
      emailClicks: 2,
      pageVisits: 5,
      rsvpStatus: "CONFIRMED",
      lastSeenAt: daysBefore(30),
      registeredAt: daysBefore(44),
    });
    const first = scoreEngagement(guest, ctx);
    const second = scoreEngagement(guest, ctx);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
