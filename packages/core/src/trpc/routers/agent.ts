import { z } from "zod";
import {
  agentActionsInput,
  agentActionsOutput,
  agentApproveInput,
  agentApproveOutput,
  agentCommandInput,
  agentCommandOutput,
  agentHistoryInput,
  agentHistoryOutput,
  agentRejectInput,
} from "../../schemas/agent";
import { notImplemented, orgProcedure, router } from "../init";

const OWNER = "Agent 1 · CONDUCTOR (apps/console)";

/**
 * The agent brain's surface.
 *
 * `command` may only ever return PROPOSED actions. `approve` is the single
 * place in the codebase allowed to turn a proposal into a side effect, and it
 * must do so transactionally: flip to EXECUTED and perform the mutation in one
 * transaction, or neither.
 */
export const agentRouter = router({
  command: orgProcedure
    .input(agentCommandInput)
    .output(agentCommandOutput)
    .mutation(() => {
      throw notImplemented("agent.command", OWNER);
    }),

  approve: orgProcedure
    .input(agentApproveInput)
    .output(agentApproveOutput)
    .mutation(() => {
      throw notImplemented("agent.approve", OWNER);
    }),

  reject: orgProcedure
    .input(agentRejectInput)
    .output(agentApproveOutput)
    .mutation(() => {
      throw notImplemented("agent.reject", OWNER);
    }),

  actions: orgProcedure
    .input(agentActionsInput)
    .output(agentActionsOutput)
    .query(() => {
      throw notImplemented("agent.actions", OWNER);
    }),

  history: orgProcedure
    .input(agentHistoryInput)
    .output(agentHistoryOutput)
    .query(() => {
      throw notImplemented("agent.history", OWNER);
    }),

  /** Per-organisation switch for auto-approving COSMETIC actions only. */
  setAutoApprove: orgProcedure
    .input(z.object({ autoApproveCosmetic: z.boolean() }))
    .output(z.object({ autoApproveCosmetic: z.boolean() }))
    .mutation(() => {
      throw notImplemented("agent.setAutoApprove", OWNER);
    }),
});
