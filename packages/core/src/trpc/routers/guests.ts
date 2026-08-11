import {
  guestGetInput,
  guestListInput,
  guestListOutput,
  guestSchema,
  guestScoreInput,
  guestScoreOutput,
  guestSegmentInput,
  guestSegmentOutput,
  personaliseInviteInput,
  personaliseInviteOutput,
  vipChecklistInput,
  vipChecklistOutput,
  waitlistSuggestionsInput,
  waitlistSuggestionsOutput,
} from "../../schemas/guest";
import { notImplemented, orgProcedure, router } from "../init";

const OWNER = "Agent 3 · ORACLE (packages/guests)";

export const guestsRouter = router({
  list: orgProcedure
    .input(guestListInput)
    .output(guestListOutput)
    .query(() => {
      throw notImplemented("guests.list", OWNER);
    }),

  get: orgProcedure
    .input(guestGetInput)
    .output(guestSchema)
    .query(() => {
      throw notImplemented("guests.get", OWNER);
    }),

  /** Deterministic and explainable: every score carries its top-3 factors. */
  score: orgProcedure
    .input(guestScoreInput)
    .output(guestScoreOutput)
    .mutation(() => {
      throw notImplemented("guests.score", OWNER);
    }),

  segment: orgProcedure
    .input(guestSegmentInput)
    .output(guestSegmentOutput)
    .mutation(() => {
      throw notImplemented("guests.segment", OWNER);
    }),

  /**
   * Writes EmailMessage rows with status PROPOSED and returns them. It must
   * never send: the Conductor's approval flow owns delivery.
   */
  personaliseInvite: orgProcedure
    .input(personaliseInviteInput)
    .output(personaliseInviteOutput)
    .mutation(() => {
      throw notImplemented("guests.personaliseInvite", OWNER);
    }),

  waitlistSuggestions: orgProcedure
    .input(waitlistSuggestionsInput)
    .output(waitlistSuggestionsOutput)
    .query(() => {
      throw notImplemented("guests.waitlistSuggestions", OWNER);
    }),

  vipChecklist: orgProcedure
    .input(vipChecklistInput)
    .output(vipChecklistOutput)
    .query(() => {
      throw notImplemented("guests.vipChecklist", OWNER);
    }),
});
