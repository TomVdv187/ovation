import type { CheckoutOutcome, CheckoutRequest } from "@ovation/events/ticketing";
import type { CheckinInput } from "../../apps/live/src/server/live/checkin";

/**
 * The contract between the spec and the child process that runs on its behalf.
 *
 * This file is imported from BOTH sides of the bridge, so every import in it
 * is `import type` and must stay that way. A *value* imported from the
 * workspace here would be pulled back across the boundary the bridge exists to
 * avoid, and would fail exactly the way tests 4 and 5 used to.
 *
 * `result` is what survives JSON, not what the function returns. `opsSnapshot`
 * and `performCheckin` both hand back Dates, and a Date does not survive
 * `JSON.stringify` — so those are `unknown` here and the spec re-parses them
 * with the real zod schema from @ovation/core. That is not a formality: it
 * restores the Dates AND asserts the payload still matches the published
 * output shape, which is a check the in-process import never made.
 */
export interface BridgeTasks {
  startCheckout: { args: CheckoutRequest; result: CheckoutOutcome };
  signQrToken: {
    args: { gid: string; eid: string; ttlSeconds?: number };
    result: string;
  };
  /** Re-parse with `checkinOutput`. */
  performCheckin: { args: CheckinInput; result: unknown };
  /** Re-parse with `opsSnapshotOutput`. */
  opsSnapshot: { args: { eventId: string }; result: unknown };
}

export type BridgeTask = keyof BridgeTasks;

/** Every reply line carries this prefix, so the child is free to log. */
export const BRIDGE_REPLY = "@@bridge@@";

export interface BridgeRequest {
  id: number;
  task: BridgeTask;
  args: unknown;
}

export type BridgeReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };
