/**
 * @ovation/core — the contract package.
 *
 * READ-ONLY for feature agents. Need a change? Append a request to
 * CONTRACT_CHANGES.md at the repo root; the Integrator applies it.
 *
 * Deliberately does NOT re-export ./db — importing the Prisma client should be
 * an explicit `@ovation/core/db` so it never leaks into a client bundle.
 */
export * from "./schemas/index";
export * from "./trpc/index";
export * from "./design/tokens";
export { ovationPreset } from "./design/tailwind-preset";
