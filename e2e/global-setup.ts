import { CONSOLE, EVENTS } from "./helpers/urls";

/**
 * Prove the servers are OVATION's before a single assertion runs.
 *
 * `reuseExistingServer` cannot tell one Next app from another, so a stray dev
 * server on 3000 gets adopted silently and the suite spends its run asserting
 * things about somebody else's product. That happened, and it cost an
 * afternoon: test 1 reported "the console does not redirect to /signin", which
 * is a fair description of an unrelated app.
 *
 * The cost of being wrong here is a misdiagnosed product defect, so this fails
 * loudly and names the port.
 */
const CHECKS = [
  { what: "the console", url: `${CONSOLE}/signin`, marker: /Ovation/ },
  {
    what: "the events app",
    url: `${EVENTS}/e/meridian-summit-2026`,
    marker: /Meridian Summit 2026/,
  },
];

export default async function globalSetup() {
  for (const check of CHECKS) {
    let body: string;
    try {
      body = await (await fetch(check.url)).text();
    } catch (e) {
      throw new Error(
        `${check.what} is not answering at ${check.url}: ${(e as Error).message}`,
      );
    }
    if (!check.marker.test(body)) {
      throw new Error(
        `Something is answering at ${check.url}, but it is not ${check.what} — ` +
          `no ${check.marker} in the response.\n` +
          `Another app is probably holding that port. Stop it, or run with ` +
          `E2E_CONSOLE_PORT / E2E_EVENTS_PORT set to free ones.`,
      );
    }
  }
}
