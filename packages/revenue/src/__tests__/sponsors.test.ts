import { describe, expect, it } from "vitest";
import {
  matchTargetAccounts,
  normaliseCompany,
  unmatchedTargetAccounts,
} from "../sponsors/match";
import {
  buildRoiReport,
  estimateLogoImpressions,
  impressionMultiplier,
  isoWeekKey,
  scoreRenewalIntent,
} from "../sponsors/roi";
import { entitlementDeltas, packageReference, parseEntitlements } from "../sponsors/packages";
import { renderSponsorRoiEmail, escapeHtml } from "../sponsors/report-html";
import {
  buildEvidence,
  findUpsellCandidates,
  groundingViolations,
  templateOffer,
} from "../sponsors/upsell";
import type { MatchedLead } from "../sponsors/match";
import { PAGE_VISITS, SEED_GUESTS, SEED_SPONSORS, EVENT_DATE } from "./fixtures";

const helvion = SEED_SPONSORS[0]!;
const nexa = SEED_SPONSORS[1]!;
const corda = SEED_SPONSORS[2]!;

describe("company normalisation", () => {
  it("is case and whitespace insensitive", () => {
    expect(normaliseCompany("Helvion Group")).toBe(normaliseCompany("helvion group"));
    expect(normaliseCompany("  HELVION   GROUP  ")).toBe("helvion group");
  });

  it("is punctuation and accent insensitive", () => {
    expect(normaliseCompany("Société Générale")).toBe(normaliseCompany("societe generale"));
    expect(normaliseCompany("Portmann & Co.")).toBe(normaliseCompany("Portmann and Co"));
  });

  it("strips trailing legal forms only", () => {
    expect(normaliseCompany("Vantage Pharma NV")).toBe(normaliseCompany("Vantage Pharma"));
    expect(normaliseCompany("Lumen Energy GmbH")).toBe("lumen energy");
    // A leading "co" is part of the name, not a suffix.
    expect(normaliseCompany("Co-operative Bank")).toBe("co operative bank");
  });

  it("does NOT collapse companies that merely share a first word", () => {
    expect(normaliseCompany("Corda Capital")).not.toBe(normaliseCompany("Corda Legal"));
    expect(normaliseCompany("Helvion Group")).not.toBe(normaliseCompany("Helvion Systems"));
  });

  it("treats an empty or missing company as no match", () => {
    expect(normaliseCompany(null)).toBe("");
    expect(normaliseCompany("   ")).toBe("");
  });
});

describe("target-account matching", () => {
  it("matches Helvion's accounts to real guests, case-insensitively", () => {
    const matched = matchTargetAccounts(helvion.targetAccounts, SEED_GUESTS);
    expect(matched.map((lead) => lead.guestId).sort()).toEqual(["g1", "g2", "g3", "g4"]);
    // "northgate bank" and "Vantage Pharma NV" both land.
    expect(matched.find((lead) => lead.guestId === "g2")?.targetAccount).toBe("Northgate Bank");
    expect(matched.find((lead) => lead.guestId === "g3")?.targetAccount).toBe("Vantage Pharma");
  });

  it("never double-counts a guest", () => {
    const matched = matchTargetAccounts(
      ["Northgate Bank", "northgate bank", "NORTHGATE BANK NV"],
      SEED_GUESTS,
    );
    expect(matched.map((lead) => lead.guestId).sort()).toEqual(["g1", "g2"]);
  });

  it("ignores guests with no company", () => {
    expect(matchTargetAccounts(["Solvenda"], SEED_GUESTS).map((l) => l.guestId)).toEqual(["g8"]);
  });

  it("reports the accounts nobody from has registered", () => {
    const matched = matchTargetAccounts(
      ["Northgate Bank", "Caelum Aerospace"],
      SEED_GUESTS,
    );
    expect(unmatchedTargetAccounts(["Northgate Bank", "Caelum Aerospace"], matched)).toEqual([
      "Caelum Aerospace",
    ]);
  });

  it("returns nothing when the sponsor listed no accounts", () => {
    expect(matchTargetAccounts([], SEED_GUESTS)).toEqual([]);
  });
});

describe("logo impressions", () => {
  it("counts only placements that render on the public page", () => {
    // Helvion: hero 1.0 + stage 0 + dinner menu 0 + email footer 0.
    // A logo on the dinner menu is real value, but it is not a page impression.
    expect(impressionMultiplier(["hero", "stage", "dinner menu", "email footer"])).toBe(1);
    expect(impressionMultiplier(["programme", "email footer"])).toBe(0.6);
  });

  it("scales with the event's own page traffic", () => {
    expect(estimateLogoImpressions(["hero"], PAGE_VISITS)).toBe(4820);
    expect(estimateLogoImpressions(["programme"], PAGE_VISITS)).toBe(2892);
    expect(estimateLogoImpressions(["hero"], 0)).toBe(0);
  });

  it("gives an unknown placement a conservative weight, never a generous one", () => {
    expect(impressionMultiplier(["sponsor carousel"])).toBe(0.4);
  });
});

describe("renewal intent", () => {
  it("reads HIGH for an engaged sponsor delivering on its entitlements", () => {
    const signal = scoreRenewalIntent({
      engagementScore: 78,
      leads: 26,
      meetings: 5,
      reportOpens: 6,
      benefitsPageClicks: 11,
      targetAccountIntros: 5,
    });
    expect(signal.intent).toBe("HIGH");
    expect(signal.drivers.length).toBeGreaterThan(2);
  });

  it("reads LOW for a disengaged sponsor — Corda's seeded profile", () => {
    const signal = scoreRenewalIntent({
      engagementScore: 31,
      leads: 2,
      meetings: 1,
      reportOpens: 2,
      benefitsPageClicks: 3,
      targetAccountIntros: 2,
    });
    // Weak but real activity is LOW, not UNKNOWN: this is the sponsor most in
    // need of a call, and it must not hide behind "no data".
    expect(signal.intent).toBe("LOW");
    expect(signal.score).toBe(0);
  });

  it("reads UNKNOWN only when nothing has been observed at all", () => {
    const signal = scoreRenewalIntent({
      engagementScore: 0,
      leads: 0,
      meetings: 0,
      reportOpens: 0,
      benefitsPageClicks: 0,
      targetAccountIntros: 0,
    });
    expect(signal.intent).toBe("UNKNOWN");
    expect(signal.score).toBe(0);
  });

  it("explains every point it scored", () => {
    const signal = scoreRenewalIntent({
      engagementScore: 72,
      leads: 14,
      meetings: 2,
      reportOpens: 9,
      benefitsPageClicks: 17,
      targetAccountIntros: 2,
    });
    expect(signal.drivers.join(" ")).toContain("72/100");
    expect(signal.drivers.join(" ")).toContain("9 sponsor reports");
  });
});

describe("ROI aggregation", () => {
  const leads = matchTargetAccounts(helvion.targetAccounts, SEED_GUESTS);
  const report = buildRoiReport({
    storedStats: helvion.roiStats,
    entitlements: parseEntitlements(helvion.entitlements),
    engagementScore: helvion.engagementScore,
    pageVisits: PAGE_VISITS,
    matchedLeads: leads,
  });

  it("computes leads from matched guests, not from the stored snapshot", () => {
    expect(report.stats.leads).toBe(leads.length);
    expect(report.stats.leads).not.toBe(26); // the stale stored value
  });

  it("computes impressions from live page traffic", () => {
    expect(report.stats.logoImpressions).toBe(4820);
  });

  it("passes observed counters through untouched", () => {
    expect(report.stats.meetings).toBe(4);
    expect(report.stats.reportOpens).toBe(6);
    expect(report.stats.benefitsPageClicks).toBe(11);
  });

  it("falls back to the stored snapshot when the page has no traffic yet", () => {
    const cold = buildRoiReport({
      storedStats: helvion.roiStats,
      entitlements: parseEntitlements(helvion.entitlements),
      engagementScore: helvion.engagementScore,
      pageVisits: 0,
      matchedLeads: leads,
    });
    expect(cold.stats.logoImpressions).toBe(18400);
  });

  it("tolerates an empty roiStats JSON blob", () => {
    const empty = buildRoiReport({
      storedStats: {},
      entitlements: parseEntitlements({}),
      engagementScore: 0,
      pageVisits: 100,
      matchedLeads: [],
    });
    expect(empty.stats.meetings).toBe(0);
    expect(empty.stats.renewalIntent).toBe("UNKNOWN");
  });
});

describe("isoWeekKey", () => {
  it("is stable within a week and changes across weeks", () => {
    expect(isoWeekKey(new Date("2026-08-10T00:00:00Z"))).toBe(
      isoWeekKey(new Date("2026-08-14T23:00:00Z")),
    );
    expect(isoWeekKey(new Date("2026-08-10T00:00:00Z"))).not.toBe(
      isoWeekKey(new Date("2026-08-18T00:00:00Z")),
    );
  });
});

describe("package reference and entitlement deltas", () => {
  it("prices Gold from what Gold sponsors at THIS event actually pay", () => {
    const reference = packageReference(SEED_SPONSORS, "GOLD");
    expect(reference.amountCents).toBe(1_250_000);
    expect(reference.fromThisEvent).toBe(true);
  });

  it("falls back to the rate card when no Gold sponsor has signed", () => {
    const reference = packageReference([nexa, corda], "GOLD");
    expect(reference.fromThisEvent).toBe(false);
    expect(reference.amountCents).toBe(1_250_000);
  });

  it("describes exactly what Silver gains by moving to Gold", () => {
    const deltas = entitlementDeltas(
      parseEntitlements(nexa.entitlements),
      packageReference(SEED_SPONSORS, "GOLD").entitlements,
    );
    const joined = deltas.join(" ");
    expect(joined).toContain("hero");
    expect(joined).toContain("2 to 8"); // VIP dinner seats
    expect(joined).toContain("2 to 5"); // target-account introductions
    expect(joined).toContain("speaking slot");
  });
});

describe("upsell radar", () => {
  const leadsBySponsor = new Map<string, MatchedLead[]>(
    SEED_SPONSORS.map((s) => [s.id, matchTargetAccounts(s.targetAccounts, SEED_GUESTS)]),
  );
  const activityBySponsor = new Map(
    SEED_SPONSORS.map((s) => {
      const stats = s.roiStats as {
        reportOpens: number;
        benefitsPageClicks: number;
        meetings: number;
      };
      return [
        s.id,
        {
          reportOpens: stats.reportOpens,
          benefitsPageClicks: stats.benefitsPageClicks,
          meetings: stats.meetings,
        },
      ];
    }),
  );

  const candidates = findUpsellCandidates({
    sponsors: SEED_SPONSORS,
    threshold: 60,
    currency: "EUR",
    eventTitle: "Meridian Summit 2026",
    eventDate: EVENT_DATE,
    leadsBySponsor,
    activityBySponsor,
  });

  it("surfaces Nexa Systems and not Corda Capital", () => {
    expect(candidates.map((c) => c.name)).toEqual(["Nexa Systems"]);
  });

  it("never pitches Gold to a sponsor who already has it", () => {
    expect(candidates.some((c) => c.sponsorId === helvion.id)).toBe(false);
  });

  it("asks for the €6,500 increment", () => {
    expect(candidates[0]!.incrementalAmountCents).toBe(650_000);
    expect(candidates[0]!.currentPackage).toBe("SILVER");
    expect(candidates[0]!.suggestedPackage).toBe("GOLD");
  });

  it("respects a raised threshold", () => {
    const strict = findUpsellCandidates({
      sponsors: SEED_SPONSORS,
      threshold: 75,
      currency: "EUR",
      eventTitle: "Meridian Summit 2026",
      eventDate: EVENT_DATE,
      leadsBySponsor,
      activityBySponsor,
    });
    expect(strict).toEqual([]);
  });

  it("grounds every piece of evidence in a stored number", () => {
    const evidence = candidates[0]!.evidence.join("\n");
    expect(evidence).toContain("Silver sponsor of Meridian Summit 2026 at €6,000");
    expect(evidence).toContain("engagement score is 72 out of 100");
    expect(evidence).toContain("opened 9 sponsor reports");
    expect(evidence).toContain("benefits page 17 times");
    expect(evidence).toContain("€6,500");
    // Nexa's three target accounts each have exactly one guest in the fixture.
    expect(evidence).toContain("3 registered guests");
  });

  it("omits activity the sponsor has not actually had", () => {
    const quiet = buildEvidence({
      sponsor: { ...nexa, engagementScore: 61 },
      entitlements: parseEntitlements(nexa.entitlements),
      reference: packageReference(SEED_SPONSORS, "GOLD"),
      leads: [],
      activity: { reportOpens: 0, benefitsPageClicks: 0, meetings: 0 },
      threshold: 60,
      currency: "EUR",
      eventTitle: "Meridian Summit 2026",
    });
    const joined = quiet.join("\n");
    expect(joined).not.toContain("reports");
    expect(joined).not.toContain("clicked through");
    expect(joined).not.toContain("registered guests");
  });

  it("drafts template copy whose every figure appears in the evidence", () => {
    const offer = templateOffer(candidates[0]!, "Meridian Summit 2026", "EUR");
    expect(offer.source).toBe("template");
    expect(offer.body).toContain("72 out of 100");
    expect(offer.body).toContain("€6,500");
    expect(offer.body).toContain("€6,000");
    expect(offer.body).toContain("€12,500");
    expect(offer.body).toContain("Bram");
    // Numbers in the copy must all be numbers we hold.
    const figures = offer.body.match(/€[\d,]*\d/g) ?? [];
    expect(figures.length).toBeGreaterThan(0);
    const evidence = candidates[0]!.evidence.join(" ");
    for (const figure of figures) {
      expect(evidence).toContain(figure);
    }
    // The same gate generated copy has to pass.
    expect(groundingViolations(`${offer.subject}\n${offer.body}`, candidates[0]!.evidence)).toEqual(
      [],
    );
  });

  describe("the grounding gate on generated copy", () => {
    const evidence = candidates[0]!.evidence;

    it("passes copy built only from the evidence", () => {
      const grounded =
        "Your engagement score of 72 out of 100 stood out. Gold is €12,500 against your current €6,000 — €6,500 more.";
      expect(groundingViolations(grounded, evidence)).toEqual([]);
    });

    it("catches an invented statistic", () => {
      const invented =
        "Sponsors like you see a 340% return, and 1,200 attendees will pass your stand.";
      expect(groundingViolations(invented, evidence)).toEqual(["340", "1,200"]);
    });

    it("catches a plausible-looking but wrong figure", () => {
      // €6,750 is close to the real €6,500 and would read as fine to a human.
      expect(groundingViolations("The step up is €6,750.", evidence)).toEqual(["6,750"]);
    });

    it("ignores numbers written as words", () => {
      expect(groundingViolations("A handful of your target accounts are coming.", evidence)).toEqual(
        [],
      );
    });

    it("does not trip over trailing punctuation", () => {
      expect(groundingViolations("You have opened 9. That is a lot.", evidence)).toEqual([]);
    });
  });
});

describe("email HTML", () => {
  const leads = matchTargetAccounts(helvion.targetAccounts, SEED_GUESTS);
  const entitlements = parseEntitlements(helvion.entitlements);
  const report = buildRoiReport({
    storedStats: helvion.roiStats,
    entitlements,
    engagementScore: helvion.engagementScore,
    pageVisits: PAGE_VISITS,
    matchedLeads: leads,
  });
  const html = renderSponsorRoiEmail({
    sponsorName: helvion.name,
    sponsorPackage: helvion.package,
    amountCents: helvion.amountCents,
    currency: "EUR",
    eventTitle: "Meridian Summit 2026",
    eventDate: EVENT_DATE,
    periodLabel: "2026-W33",
    stats: report.stats,
    renewal: report.renewal,
    entitlements,
    matchedLeads: leads,
    unmatchedAccounts: [],
    pageVisits: PAGE_VISITS,
    impressionMultiplier: report.impressionMultiplier,
    contactName: helvion.contactName,
  });

  it("survives an email client: tables, inline styles, no external CSS", () => {
    expect(html).toContain("<table");
    expect(html).toContain('role="presentation"');
    expect(html).toContain("style=");
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("class=");
    expect(html).not.toMatch(/display:\s*(flex|grid)/);
    expect(html).not.toMatch(/https?:\/\//); // no remote fonts, images or trackers
  });

  it("carries the real numbers", () => {
    expect(html).toContain("Helvion Group");
    expect(html).toContain("€12,500");
    expect(html).toContain("4,820"); // impressions
    expect(html).toContain("Lotte Peeters");
  });

  it("labels modelled impressions as an estimate", () => {
    expect(html).toContain("estimate");
  });

  it("escapes anything a human typed", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    const injected = renderSponsorRoiEmail({
      sponsorName: `<img src=x onerror="alert(1)">`,
      sponsorPackage: "GOLD",
      amountCents: 1,
      currency: "EUR",
      eventTitle: "Ev&nt",
      eventDate: EVENT_DATE,
      periodLabel: "2026-W33",
      stats: report.stats,
      renewal: report.renewal,
      entitlements,
      matchedLeads: [],
      unmatchedAccounts: [],
      pageVisits: 0,
      impressionMultiplier: 0,
      contactName: null,
    });
    expect(injected).not.toContain("<img");
    expect(injected).toContain("&lt;img");
    expect(injected).toContain("Ev&amp;nt");
  });
});
