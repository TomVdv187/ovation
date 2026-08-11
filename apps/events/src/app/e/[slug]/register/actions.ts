"use server";

import { redirect } from "next/navigation";
import type { FormState } from "~/lib/form-state";
import { register } from "~/server/registration";

/**
 * The registration submit.
 *
 * A progressively-enhanced server action: the form posts and works with
 * JavaScript switched off, and useActionState upgrades it to inline errors when
 * it is on. Success redirects to the ticket, so a refresh cannot re-submit.
 */
export async function registerAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const slug = String(formData.get("slug") ?? "");
  if (!slug) {
    return { errors: {}, formError: "Something went wrong. Please try again." };
  }

  const raw: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") raw[key] = value;
  }

  const result = await register(slug, raw);
  if (!result.ok) {
    return { errors: result.errors, formError: result.formError };
  }

  // redirect() signals by throwing — it must stay outside any try/catch.
  redirect(
    result.token
      ? `/e/${slug}/ticket?t=${encodeURIComponent(result.token)}`
      : `/e/${slug}/ticket?waitlisted=1`,
  );
}
