"use server";

import { redirect } from "next/navigation";
import type { FormState } from "~/lib/form-state";
import { startCheckout } from "~/server/ticketing";

/**
 * Opens a checkout.
 *
 * Seats are taken before the guest ever reaches a payment page — see
 * ~/server/ticketing for why that ordering is what makes overselling
 * impossible. On success this redirects to Stripe, or, when no Stripe key is
 * configured, to the local checkout that runs the same fulfilment path.
 */
export async function checkoutAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const slug = String(formData.get("slug") ?? "");
  const tierId = String(formData.get("tierId") ?? "");

  if (!slug || !tierId) {
    return { errors: {}, formError: "Choose a ticket first." };
  }

  const result = await startCheckout({
    slug,
    tierId,
    quantity: Number(formData.get("quantity") ?? 1),
    email: String(formData.get("email") ?? ""),
    name: String(formData.get("name") ?? ""),
  });

  if (!result.ok) {
    return { errors: result.errors, formError: result.formError };
  }

  // Throws to signal — keep it outside any try/catch.
  redirect(result.redirectTo);
}
