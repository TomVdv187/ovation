import {
  evaluateAutoOpenRulesInput,
  evaluateAutoOpenRulesOutput,
  pricingSuggestionsInput,
  pricingSuggestionsOutput,
  revenueSummaryInput,
  revenueSummaryOutput,
  sponsorListInput,
  sponsorListOutput,
  sponsorRoiReportInput,
  sponsorRoiReportOutput,
  sponsorUpsellCandidatesInput,
  sponsorUpsellCandidatesOutput,
} from "../../schemas/revenue";
import { notImplemented, orgProcedure, router } from "../init";

const OWNER = "Agent 4 · TREASURY (packages/revenue)";

export const revenueRouter = router({
  /** One query, dashboard-ready: tickets + sponsors - costs, with the delta. */
  summary: orgProcedure
    .input(revenueSummaryInput)
    .output(revenueSummaryOutput)
    .query(() => {
      throw notImplemented("revenue.summary", OWNER);
    }),

  pricingSuggestions: orgProcedure
    .input(pricingSuggestionsInput)
    .output(pricingSuggestionsOutput)
    .query(() => {
      throw notImplemented("revenue.pricingSuggestions", OWNER);
    }),

  /** Cron/queue entry point. Firing a rule emits an AgentAction PROPOSED. */
  evaluateAutoOpenRules: orgProcedure
    .input(evaluateAutoOpenRulesInput)
    .output(evaluateAutoOpenRulesOutput)
    .mutation(() => {
      throw notImplemented("revenue.evaluateAutoOpenRules", OWNER);
    }),

  sponsors: orgProcedure
    .input(sponsorListInput)
    .output(sponsorListOutput)
    .query(() => {
      throw notImplemented("revenue.sponsors", OWNER);
    }),

  sponsorUpsellCandidates: orgProcedure
    .input(sponsorUpsellCandidatesInput)
    .output(sponsorUpsellCandidatesOutput)
    .query(() => {
      throw notImplemented("revenue.sponsorUpsellCandidates", OWNER);
    }),

  sponsorRoiReport: orgProcedure
    .input(sponsorRoiReportInput)
    .output(sponsorRoiReportOutput)
    .mutation(() => {
      throw notImplemented("revenue.sponsorRoiReport", OWNER);
    }),
});
