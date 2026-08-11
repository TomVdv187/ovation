import { createCallerFactory, type Context } from "@ovation/core";
import { appRouter } from "./router";

/**
 * In-process caller for the other agents' contracts.
 *
 * The host companion needs guests and sponsors. It gets them by calling
 * `guests.list` and `revenue.sponsors` exactly as any other consumer would —
 * no cross-package imports, no queries against tables this app does not own.
 * When those procedures are still stubs the caller throws NOT_IMPLEMENTED and
 * the UI shows a pending state; when the Oracle and the Treasury land, this
 * file does not change.
 */
const caller = createCallerFactory(appRouter);

export function createPeerCaller(ctx: Context) {
  return caller(ctx);
}
