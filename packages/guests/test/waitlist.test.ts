import { describe, expect, it } from "vitest";
import { rulesV1 } from "../src/engine/rules-v1";
import type { EventContext, GuestSignals } from "../src/engine/types";
import { planWaitlist, type WaitlistRow } from "../src/engine/waitlist";
import { eventContextOf } from "../src/service";
import { daysBefore, EVENT, signals } from "./support/factories";

const ctx = eventContextOf(EVENT);

function row(guest: GuestSignals): WaitlistRow {
  return { signals: guest, assessment: rulesV1.assess(guest, ctx) };
}

function smallRoom(capacity: number): EventContext {
  return { ...ctx, capacity };
}

const confirmedGuest = (id: string, plusOnes = 0) =>
  signals({
    id,
    rsvpStatus: "CONFIRMED",
    emailOpens: 8,
    emailClicks: 4,
    pageVisits: 6,
    plusOnes,
    paidCents: 14_500,
    lastSeenAt: daysBefore(5),
    registeredAt: daysBefore(60),
  });

describe("waitlist planning", () => {
  it("counts seats rather than people, and discounts for predicted no-shows", () => {
    const rows = [row(confirmedGuest("a", 1)), row(confirmedGuest("b"))];
    const plan = planWaitlist(rows, smallRoom(10));

    // Two guests, three seats committed.
    expect(plan.confirmed).toBe(3);
    expect(plan.predictedAttending).toBeLessThanOrEqual(3);
    expect(plan.freeSeats).toBe(10 - plan.predictedAttending);
  });

  it("ignores invitations and declines when working out what is committed", () => {
    const rows = [
      row(confirmedGuest("a")),
      row(signals({ id: "b", rsvpStatus: "INVITED" })),
      row(signals({ id: "c", rsvpStatus: "DECLINED" })),
      row(signals({ id: "d", rsvpStatus: "WAITLISTED" })),
    ];
    expect(planWaitlist(rows, smallRoom(10)).confirmed).toBe(1);
  });

  it("ranks the waitlist by who is worth promoting, not by who asked first", () => {
    const eager = signals({
      id: "eager-prospect",
      rsvpStatus: "WAITLISTED",
      segment: "PROSPECT",
      emailOpens: 4,
      emailClicks: 1,
      pageVisits: 3,
      lastSeenAt: daysBefore(4),
      createdAt: daysBefore(30),
    });
    const vip = signals({
      id: "quiet-vip",
      rsvpStatus: "WAITLISTED",
      segment: "VIP",
      emailOpens: 4,
      emailClicks: 2,
      pageVisits: 2,
      lastSeenAt: daysBefore(20),
      createdAt: daysBefore(60),
    });

    const plan = planWaitlist([row(eager), row(vip)], smallRoom(20));
    expect(plan.promote.map((p) => p.guestId)).toEqual(["quiet-vip", "eager-prospect"]);
    expect(plan.promote[0]?.rank).toBe(1);
    expect(plan.promote[0]?.reason).toContain("VIP");
    expect(plan.promote[0]?.reason).toContain("engagement");
  });

  it("breaks ties on who joined the waitlist first", () => {
    const shape = { rsvpStatus: "WAITLISTED" as const, segment: "CLIENT" as const, emailOpens: 3 };
    // Both far enough past the new-contact grace period that only the
    // waitlist join order separates them — and the alphabetically later id
    // wins, which proves the tie-break is joined-first rather than id order.
    const early = signals({ id: "z-early", ...shape, createdAt: daysBefore(50) });
    const late = signals({ id: "a-late", ...shape, createdAt: daysBefore(30) });

    const plan = planWaitlist([row(late), row(early)], smallRoom(20));
    expect(plan.promote.map((p) => p.guestId)).toEqual(["z-early", "a-late"]);
  });

  it("promotes nobody when the room is already full", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(confirmedGuest(`c${i}`)));
    rows.push(row(signals({ id: "waiting", rsvpStatus: "WAITLISTED" })));

    const plan = planWaitlist(rows, smallRoom(4));
    expect(plan.freeSeats).toBeLessThanOrEqual(0);
    expect(plan.promote).toEqual([]);
  });

  it("does not offer a party of two the last single seat, but does offer it to a party of one", () => {
    const pair = signals({ id: "a-pair", rsvpStatus: "WAITLISTED", plusOnes: 1, emailOpens: 8, emailClicks: 4 });
    const single = signals({ id: "b-single", rsvpStatus: "WAITLISTED", emailOpens: 1 });
    const holders = Array.from({ length: 9 }, (_, i) => row(confirmedGuest(`h${i}`)));

    const plan = planWaitlist([...holders, row(pair), row(single)], smallRoom(10));
    expect(plan.freeSeats).toBe(1);
    expect(plan.promote.map((p) => p.guestId)).toEqual(["b-single"]);
  });
});
