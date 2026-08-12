/**
 * Print the Gold-upgrade offer the radar would draft for the seeded Nexa
 * Systems sponsor, alongside the evidence it is allowed to draw on.
 *
 *   pnpm --filter @ovation/revenue offer:preview
 *
 * No database required — it runs on the seed fixtures. With ANTHROPIC_API_KEY
 * set it calls claude-opus-5; without one it prints the deterministic template.
 * Either way the point is the same: read the copy, then check every factual
 * claim in it against the evidence list printed above it.
 */
import { copywritingAvailable, REVENUE_MODEL } from "../src/anthropic";
import { matchTargetAccounts } from "../src/sponsors/match";
import { parseRoiStats } from "../src/sponsors/roi";
import { draftGoldOffer, findUpsellCandidates } from "../src/sponsors/upsell";
import { EVENT_DATE, SEED_GUESTS, SEED_SPONSORS } from "../src/__tests__/fixtures";

const EVENT_TITLE = "Meridian Summit 2026";

async function main() {
  const candidates = findUpsellCandidates({
    sponsors: SEED_SPONSORS,
    threshold: 60,
    currency: "EUR",
    eventTitle: EVENT_TITLE,
    eventDate: EVENT_DATE,
    leadsBySponsor: new Map(
      SEED_SPONSORS.map((s) => [s.id, matchTargetAccounts(s.targetAccounts, SEED_GUESTS)]),
    ),
    activityBySponsor: new Map(
      SEED_SPONSORS.map((s) => {
        const stats = parseRoiStats(s.roiStats);
        return [
          s.id,
          {
            reportOpens: stats.reportOpens,
            benefitsPageClicks: stats.benefitsPageClicks,
            meetings: stats.meetings,
          },
        ];
      }),
    ),
  });

  console.log(`Candidates: ${candidates.map((c) => c.name).join(", ") || "(none)"}\n`);

  for (const candidate of candidates) {
    console.log("=".repeat(72));
    console.log(`${candidate.name} — ${candidate.currentPackage} → ${candidate.suggestedPackage}`);
    console.log("=".repeat(72));
    console.log("\nEVIDENCE (the complete set of facts the copy may contain):\n");
    candidate.evidence.forEach((fact, i) => console.log(`  ${i + 1}. ${fact}`));

    console.log(
      `\nDrafting with ${copywritingAvailable() ? REVENUE_MODEL : "the deterministic template (no ANTHROPIC_API_KEY)"}…\n`,
    );
    const offer = await draftGoldOffer(candidate, EVENT_TITLE, "EUR");

    console.log(`SOURCE:  ${offer.source}`);
    console.log(`SUBJECT: ${offer.subject}\n`);
    console.log(offer.body);
    console.log();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
