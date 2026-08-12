"use server";

import { redirect } from "next/navigation";
import { paymentsEnabled } from "~/server/stripe";
import { fulfilOrder, releaseOrder } from "~/server/ticketing";

/**
 * The local checkout's two buttons.
 *
 * Both refuse to run when STRIPE_SECRET_KEY is present. That guard is the whole
 * safety story for this route: with a payment provider configured there is no
 * way to settle an order without money, and without one a fresh clone can still
 * walk the entire purchase path.
 */

function assertLocalOnly(): void {
  if (paymentsEnabled()) {
    throw new Error(
      "Stripe is configured — the local checkout is disabled. Pay through Stripe.",
    );
  }
}

export async function confirmLocalPayment(formData: FormData): Promise<void> {
  assertLocalOnly();
  const slug = String(formData.get("slug") ?? "");
  const orderId = String(formData.get("orderId") ?? "");

  // CC-002: the buyer's name is on the Order row, so it no longer has to be
  // smuggled through the URL and back in through a hidden form field.
  await fulfilOrder(orderId);
  redirect(`/e/${slug}/order/${orderId}`);
}

export async function abandonLocalPayment(formData: FormData): Promise<void> {
  assertLocalOnly();
  const slug = String(formData.get("slug") ?? "");
  const orderId = String(formData.get("orderId") ?? "");

  await releaseOrder(orderId, "CANCELLED");
  redirect(`/e/${slug}/tickets?cancelled=1`);
}
