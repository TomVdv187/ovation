import { describe, expect, it } from "vitest";
import {
  assignSegments,
  emptySegmentationContext,
  inferSegment,
  normaliseCompany,
  type SegmentationContext,
  type SegmentationSubject,
} from "../src/engine/segmentation";

function subject(overrides: Partial<SegmentationSubject> & { id: string }): SegmentationSubject {
  return {
    email: `${overrides.id}@example.be`,
    company: "Kestrel Logistics",
    title: "Programme Director",
    paidCents: 0,
    hasPremiumTicket: false,
    hasWhiteGlove: false,
    ...overrides,
  };
}

const sponsored: SegmentationContext = {
  sponsorCompanies: new Set([normaliseCompany("Helvion Group"), normaliseCompany("Portmann & Co")]),
  sponsorContacts: new Set(["griet.segers@helviongroup.be"]),
};

describe("segment inference", () => {
  it("reads a newsroom title as press, wherever they work", () => {
    const result = inferSegment(
      subject({ id: "a", title: "Senior Correspondent", company: "De Tijd" }),
      emptySegmentationContext(),
    );
    expect(result.segment).toBe("PRESS");
    expect(result.reason).toContain("newsroom");
  });

  it("does not file a media company's chief executive as a reporter", () => {
    const result = inferSegment(
      subject({ id: "b", title: "CEO", company: "Arclight Media", paidCents: 14_500 }),
      emptySegmentationContext(),
    );
    expect(result.segment).not.toBe("PRESS");
  });

  it("needs seniority plus a real marker before calling somebody a VIP", () => {
    const senior = subject({ id: "c", title: "CEO", company: "Corda Capital" });
    expect(inferSegment(senior, emptySegmentationContext()).segment).toBe("PROSPECT");

    const withTable = { ...senior, hasPremiumTicket: true, paidCents: 120_000 };
    const vip = inferSegment(withTable, emptySegmentationContext());
    expect(vip.segment).toBe("VIP");
    expect(vip.reason).toContain("top-tier ticket");

    const alreadyLookedAfter = { ...senior, hasWhiteGlove: true };
    expect(inferSegment(alreadyLookedAfter, emptySegmentationContext()).segment).toBe("VIP");
  });

  it("treats a sponsor's people and a partnerships lead as partners", () => {
    expect(
      inferSegment(subject({ id: "d", email: "griet.segers@helviongroup.be" }), sponsored).segment,
    ).toBe("PARTNER");
    expect(inferSegment(subject({ id: "e", company: "Helvion Group" }), sponsored).segment).toBe(
      "PARTNER",
    );
    expect(
      inferSegment(subject({ id: "f", title: "Head of Partnerships" }), sponsored).segment,
    ).toBe("PARTNER");
  });

  it("matches sponsor names through punctuation differences", () => {
    expect(inferSegment(subject({ id: "g", company: "Portmann and Co" }), sponsored).segment).toBe(
      "PARTNER",
    );
  });

  it("calls somebody who has paid a client, and somebody who has not a prospect", () => {
    expect(
      inferSegment(subject({ id: "h", paidCents: 9_500 }), emptySegmentationContext()).segment,
    ).toBe("CLIENT");
    expect(inferSegment(subject({ id: "i" }), emptySegmentationContext()).segment).toBe("PROSPECT");
  });

  it("explains every assignment in a sentence an organiser can argue with", () => {
    const subjects = [
      subject({ id: "a", title: "Editor", company: "L'Echo" }),
      subject({ id: "b", paidCents: 14_500 }),
      subject({ id: "c" }),
    ];
    for (const s of subjects) {
      const { reason } = inferSegment(s, sponsored);
      expect(reason.length).toBeGreaterThan(25);
      expect(reason.endsWith(".")).toBe(true);
    }
  });
});

describe("organiser overrides", () => {
  it("always beats inference, and says what inference would have chosen", () => {
    const subjects = [subject({ id: "x", paidCents: 14_500 })];
    const [assignment] = assignSegments(subjects, emptySegmentationContext(), [
      { guestId: "x", segment: "VIP" },
    ]);

    expect(assignment?.segment).toBe("VIP");
    expect(assignment?.overridden).toBe(true);
    expect(assignment?.reason).toContain("Inference would have said CLIENT");
  });

  it("reports overridden honestly when the organiser and inference agree", () => {
    const subjects = [subject({ id: "y", paidCents: 14_500 })];
    const [assignment] = assignSegments(subjects, emptySegmentationContext(), [
      { guestId: "y", segment: "CLIENT" },
    ]);

    expect(assignment?.segment).toBe("CLIENT");
    expect(assignment?.overridden).toBe(true);
    expect(assignment?.reason).toContain("what inference would have chosen anyway");
  });

  it("leaves guests without an override untouched", () => {
    const subjects = [subject({ id: "p" }), subject({ id: "q", paidCents: 100 })];
    const assignments = assignSegments(subjects, emptySegmentationContext(), [
      { guestId: "p", segment: "PRESS" },
    ]);

    expect(assignments.map((a) => [a.guestId, a.segment, a.overridden])).toEqual([
      ["p", "PRESS", true],
      ["q", "CLIENT", false],
    ]);
  });
});
