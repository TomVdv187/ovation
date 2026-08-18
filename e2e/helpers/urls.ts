/**
 * Where the suite expects to find the apps. Shared by the specs and the
 * Playwright config so the two can never disagree.
 *
 * The ports are overridable because `reuseExistingServer` is on: Playwright
 * decides a server is already running by seeing whether ANYTHING answers on
 * the port, and 3000 is the default port of every Next app on the machine. A
 * run that lands on someone else's dev server fails deep inside an assertion
 * and reads as a product bug — set E2E_CONSOLE_PORT / E2E_EVENTS_PORT and the
 * suite steps aside instead. global-setup.ts checks the identity either way.
 */
export const CONSOLE_PORT = Number(process.env.E2E_CONSOLE_PORT ?? 3000);
export const EVENTS_PORT = Number(process.env.E2E_EVENTS_PORT ?? 3001);

export const CONSOLE = process.env.CONSOLE_URL ?? `http://localhost:${CONSOLE_PORT}`;
export const EVENTS = process.env.EVENTS_URL ?? `http://localhost:${EVENTS_PORT}`;
