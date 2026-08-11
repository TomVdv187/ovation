import { z } from "zod";

/**
 * Server environment. Parsed lazily so importing @ovation/core in a browser
 * bundle (types, schemas, tokens) never throws.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  AUTH_SECRET: z.string().min(1).optional(),
  AUTH_URL: z.string().url().default("http://localhost:3000"),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("OVATION <hello@ovation.local>"),

  ANTHROPIC_API_KEY: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  REALTIME_APP_ID: z.string().optional(),
  REALTIME_KEY: z.string().optional(),
  REALTIME_SECRET: z.string().optional(),
  REALTIME_CLUSTER: z.string().default("eu"),

  QR_SIGNING_SECRET: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment. Copy .env.example to .env and fill it in.\n${issues}`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** True when a feature's credentials are present; lets agents ship dev-safe fallbacks. */
export const featureFlags = {
  email: () => Boolean(process.env.RESEND_API_KEY),
  payments: () => Boolean(process.env.STRIPE_SECRET_KEY),
  agent: () => Boolean(process.env.ANTHROPIC_API_KEY),
  realtime: () => Boolean(process.env.REALTIME_KEY),
} as const;
