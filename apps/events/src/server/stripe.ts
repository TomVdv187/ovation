import Stripe from "stripe";

/**
 * Stripe, when it is configured.
 *
 * Everything downstream treats a missing key as a supported state rather than
 * an error: without STRIPE_SECRET_KEY the ticket flow falls back to a local
 * checkout that runs the exact same fulfilment code the webhook runs, so the
 * purchase path can be walked end to end on a fresh clone. The fallback is
 * gated on the key being absent — it can never shadow a real payment.
 */

let client: Stripe | null = null;

export function paymentsEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!client) {
    client = new Stripe(key, { typescript: true });
  }
  return client;
}

export function webhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET || null;
}
