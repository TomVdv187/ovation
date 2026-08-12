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

  /**
   * CC-004: a mutation, not a query. The output carries an `agentActionId`, so
   * the procedure has to persist the drafted copy on an AgentAction before it
   * can answer — it writes. It is also the one place that calls the Anthropic
   * API, and a query may be prefetched and served over a cacheable GET.
   */
  sponsorUpsellCandidates: orgProcedure
    .input(sponsorUpsellCandidatesInput)
    .output(sponsorUpsellCandidatesOutput)
    .mutation(() => {
      throw notImplemented("revenue.sponsorUpsellCandidates", OWNER);
    }),

  sponsorRoiReport: orgProcedure
    .input(sponsorRoiReportInput)
    .output(sponsorRoiReportOutput)
    .mutation(() => {
      throw notImplemented("revenue.sponsorRoiReport", OWNER);
    }),
});
