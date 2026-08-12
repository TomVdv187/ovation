import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
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
  chatMessageSchema,
  orgProcedure,
  router,
} from "@ovation/core";
import type { Db } from "@ovation/core/db";
import { toAgentAction } from "~/server/agent/actions";
import { runAgentTurn } from "~/server/agent/brain";
import { executeApprovedActions } from "~/server/agent/execute";
import { AgentUnavailableError } from "~/server/agent/model";

/**
 * The agent brain's surface. Signatures are the contract's, unchanged.
 *
 * `command` can only ever hand back PROPOSED actions; `approve` is the single
 * door to a side effect and goes through executeApprovedActions, which is
 * transactional.
 */
export const agentRouter = router({
  command: orgProcedure
    .input(agentCommandInput)
    .output(agentCommandOutput)
    .mutation(async ({ ctx, input }) => {
      const organisationId = ctx.session.user.organisationId!;
      try {
        return await runAgentTurn({
          db: ctx.db,
          eventId: input.eventId,
          organisationId,
          userId: ctx.session.user.id,
          message: input.message,
          threadFrom: input.threadFrom,
        });
      } catch (error) {
        if (error instanceof AgentUnavailableError) {
          // A missing key is a configuration state, not a bug. The console
          // stays up and the chat shows this verbatim.
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error.message,
            cause: error,
          });
        }
        throw error;
      }
    }),

  approve: orgProcedure
    .input(agentApproveInput)
    .output(agentApproveOutput)
    .mutation(async ({ ctx, input }) => {
      await assertActionsBelongToOrg(ctx, input.actionIds);
      const results = await executeApprovedActions(
        ctx.db,
        input.actionIds,
        { kind: "HUMAN", userId: ctx.session.user.id },
        input.patch,
      );
      return { results };
    }),

  reject: orgProcedure
    .input(agentRejectInput)
    .output(agentApproveOutput)
    .mutation(async ({ ctx, input }) => {
      await assertActionsBelongToOrg(ctx, input.actionIds);

      // Rejection mutates the action row and nothing else in the world.
      await ctx.db.agentAction.updateMany({
        where: { id: { in: input.actionIds }, status: { in: ["PROPOSED", "APPROVED"] } },
        data: {
          status: "REJECTED",
          approvedBy: ctx.session.user.id,
          approvedAt: new Date(),
          error: input.reason ?? null,
        },
      });

      const rows = await ctx.db.agentAction.findMany({
        where: { id: { in: input.actionIds } },
      });
      return {
        results: rows.map((row) => ({
          actionId: row.id,
          status: row.status,
          result: null,
          error: row.error,
        })),
      };
    }),

  actions: orgProcedure
    .input(agentActionsInput)
    .output(agentActionsOutput)
    .query(async ({ ctx, input }) => {
      const organisationId = ctx.session.user.organisationId!;
      const [rows, pendingApprovals] = await Promise.all([
        ctx.db.agentAction.findMany({
          where: {
            eventId: input.eventId,
            organisationId,
            ...(input.status ? { status: input.status } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: input.limit,
        }),
        ctx.db.agentAction.count({
          where: { eventId: input.eventId, organisationId, status: "PROPOSED" },
        }),
      ]);
      return { items: rows.map(toAgentAction), pendingApprovals };
    }),

  history: orgProcedure
    .input(agentHistoryInput)
    .output(agentHistoryOutput)
    .query(async ({ ctx, input }) => {
      const organisationId = ctx.session.user.organisationId!;
      const [messages, openProposals] = await Promise.all([
        // Agent 7 · CRITIC, Phase 3: was `where: { eventId }` with no tenant
        // filter, so any signed-in user of any organisation could read the full
        // agent transcript of any event by id — including whatever the
        // organiser typed into the chat. Reproduction: check A9 in
        // apps/console/scripts/critic-approval.ts.
        ctx.db.chatMessage.findMany({
          where: { eventId: input.eventId, event: { organisationId } },
          orderBy: { createdAt: "desc" },
          take: input.limit,
        }),
        ctx.db.agentAction.findMany({
          where: {
            eventId: input.eventId,
            organisationId,
            status: "PROPOSED",
          },
          orderBy: { createdAt: "asc" },
        }),
      ]);

      return {
        messages: messages.reverse().map((m) => chatMessageSchema.parse(m)),
        openProposals: openProposals.map(toAgentAction),
      };
    }),

  setAutoApprove: orgProcedure
    .input(z.object({ autoApproveCosmetic: z.boolean() }))
    .output(z.object({ autoApproveCosmetic: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const organisationId = ctx.session.user.organisationId!;
      const org = await ctx.db.organisation.findUnique({
        where: { id: organisationId },
        select: { settings: true },
      });
      const settings =
        typeof org?.settings === "object" && org.settings !== null
          ? (org.settings as Record<string, unknown>)
          : {};

      await ctx.db.organisation.update({
        where: { id: organisationId },
        data: {
          settings: {
            ...settings,
            autoApproveCosmetic: input.autoApproveCosmetic,
          },
        },
      });
      // Only COSMETIC is ever affected. OUTBOUND and DESTRUCTIVE stay gated by
      // requiresApproval regardless of this flag.
      return { autoApproveCosmetic: input.autoApproveCosmetic };
    }),
});

/** No cross-tenant approvals, whatever ids arrive on the wire. */
async function assertActionsBelongToOrg(
  ctx: { db: Db; session: { user: { organisationId: string | null } } },
  actionIds: string[],
): Promise<void> {
  const count = await ctx.db.agentAction.count({
    where: {
      id: { in: actionIds },
      organisationId: ctx.session.user.organisationId ?? "",
    },
  });
  if (count !== new Set(actionIds).size) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "One or more actions do not belong to your organisation.",
    });
  }
}
