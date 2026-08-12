/**
 * @ovation/guests — guest intelligence. Owned by Agent 3 · ORACLE.
 *
 * The console mounts the router with one line in apps/console/src/server/router.ts:
 *
 *   import { guestsRouter } from "@ovation/guests";
 *   ...
 *   guests: guestsRouter,
 *
 * Rules that are not ours to change:
 *  - every score returns its top-3 factors (deterministic, explainable);
 *  - risk always comes with a recommended recovery action;
 *  - personaliseInvite writes EmailMessage rows as PROPOSED and NEVER sends.
 */
export { guestsRouter } from "./router";

export const OWNER = "Agent 3 · ORACLE";

// The engine, exported so live ops and the agent can score in-memory guests
// without a round trip, and so an ML engine can be registered at boot.
export {
  DEFAULT_ENGINE_ID,
  getEngine,
  predictAttendance,
  registerEngine,
  runEngine,
  rulesV1,
  seatPressureFrom,
} from "./engine/rules-v1";
export { scoreEngagement, topFactors } from "./engine/engagement";
export { band, predictNoShow } from "./engine/no-show";
export { recommendRecovery } from "./engine/recovery";
export {
  assignSegments,
  emptySegmentationContext,
  inferSegment,
  normaliseCompany,
} from "./engine/segmentation";
export { planWaitlist, promotionScore } from "./engine/waitlist";
export {
  blankWhiteGlove,
  openWhiteGlove,
  outstandingWhiteGlove,
  readWhiteGlove,
  WHITE_GLOVE_FIELDS,
} from "./engine/white-glove";

export type {
  Assessment,
  EventContext,
  GuestHistory,
  GuestSignals,
  ScoreOutcome,
  ScoringEngine,
  SeatPressure,
} from "./engine/types";
export type {
  SegmentAssignment,
  SegmentationContext,
  SegmentationSubject,
} from "./engine/segmentation";
export type { WaitlistPlan, WaitlistPromotion, WaitlistRow } from "./engine/waitlist";

// Invitation writing. The checks are exported because the eval script and any
// downstream approval UI should judge a draft by exactly the same rules.
export {
  buildSystemPrompt,
  buildUserMessage,
  formatEventDate,
  WRITE_TOOL_NAME,
  WRITE_TOOL_SCHEMA,
} from "./invites/prompt";
export {
  buildVocabulary,
  countWords,
  explainFailures,
  findInventedProperNouns,
  findTemplatedPairs,
  inspectEmail,
  similarity,
  SPAM_TRIGGERS,
  SUBJECT_MAX_CHARS,
} from "./invites/checks";
export { createLimiter, DEFAULT_LIMITS, mapLimited } from "./invites/limiter";
export { newCampaignId, personaliseBatch } from "./invites/personalise";
export { renderDataBlock, safeFirstName, sanitiseList, sanitiseValue } from "./invites/sanitise";
export { anthropicWriter, hasApiKey, INVITE_MODEL, MissingApiKeyError } from "./invites/writer";

export type {
  CheckFinding,
  CheckReport,
  CheckSeverity,
  Vocabulary,
} from "./invites/checks";
export type { Draft, PersonaliseOptions, PersonaliseResult } from "./invites/personalise";
export type {
  AgendaHighlight,
  CampaignIntent,
  EventFacts,
  GuestFacts,
  InviteWriter,
  WriteRequest,
  WrittenEmail,
} from "./invites/types";

export {
  isPremiumTier,
  noTicket,
  toContractGuest,
  toEventFacts,
  toGuestFacts,
  toSignals,
} from "./mappers";
export type { EventRow, GuestRow, TicketFacts } from "./mappers";
