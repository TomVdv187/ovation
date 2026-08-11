"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { emptyFormState, type FormState } from "~/lib/form-state";

/**
 * The tier picker.
 *
 * Quota, sold count and status come from the server; this only decides what a
 * guest may click. A tier that is sold out, closed, draft or outside its sales
 * window is shown and explained rather than hidden — "Early sold out in nine
 * days" is information, and pretending the tier never existed is not.
 *
 * The quantity ceiling follows the tier's real remaining count. That is a
 * courtesy, not a guarantee: the guarantee is the conditional UPDATE in
 * ~/server/ticketing, which is the only thing standing between two people and
 * the same last seat.
 */

export interface TierView {
  id: string;
  name: string;
  description: string | null;
  priceLabel: string;
  free: boolean;
  remaining: number;
  purchasable: boolean;
  /** Why it cannot be bought, when it cannot. */
  unavailableLabel: string | null;
}

export interface TicketPickerProps {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  slug: string;
  tiers: TierView[];
  maxPerOrder: number;
  /** False when no Stripe key is configured and checkout settles locally. */
  paymentsConfigured: boolean;
}

export function TicketPicker({
  action,
  slug,
  tiers,
  maxPerOrder,
  paymentsConfigured,
}: TicketPickerProps) {
  const [state, formAction, pending] = useActionState(action, emptyFormState);
  const summary = useRef<HTMLDivElement>(null);

  const buyable = tiers.filter((tier) => tier.purchasable);
  const [selectedId, setSelectedId] = useState(buyable[0]?.id ?? "");
  const selected = tiers.find((tier) => tier.id === selectedId);
  const max = Math.max(1, Math.min(maxPerOrder, selected?.remaining ?? 1));

  const errorKeys = Object.keys(state.errors);
  const hasErrors = errorKeys.length > 0 || state.formError !== null;

  useEffect(() => {
    if (hasErrors) summary.current?.focus();
  }, [state, hasErrors]);

  return (
    <form action={formAction} className="mt-10 space-y-8" noValidate>
      <input type="hidden" name="slug" value={slug} />

      {hasErrors ? (
        <div
          ref={summary}
          tabIndex={-1}
          role="alert"
          className="rounded-ev border-2 border-ev-danger bg-ev-surface p-5"
        >
          <h2 className="text-lg">We could not start that order</h2>
          {state.formError ? (
            <p className="mt-2 text-base text-ev-ink-muted">{state.formError}</p>
          ) : null}
          {errorKeys.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {errorKeys.map((key) => (
                <li key={key} className="text-base">
                  {state.errors[key]}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <fieldset>
        <legend className="ev-kicker text-ev-accent-text">
          Choose your ticket
        </legend>
        <ul className="mt-5 space-y-3">
          {tiers.map((tier) => {
            const id = `tier-${tier.id}`;
            return (
              <li key={tier.id}>
                <label
                  htmlFor={id}
                  className={`flex cursor-pointer items-start gap-4 rounded-ev border p-5 ${
                    tier.id === selectedId
                      ? "border-ev-accent bg-ev-wash"
                      : "border-ev-line bg-ev-surface"
                  } ${tier.purchasable ? "" : "cursor-not-allowed opacity-70"}`}
                >
                  <input
                    id={id}
                    type="radio"
                    name="tierId"
                    value={tier.id}
                    disabled={!tier.purchasable}
                    checked={tier.id === selectedId}
                    onChange={() => setSelectedId(tier.id)}
                    className="mt-1 h-5 w-5 shrink-0 accent-[var(--ev-accent)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="text-lg">{tier.name}</span>
                      <span className="text-lg tabular-nums text-ev-accent-text">
                        {tier.priceLabel}
                      </span>
                    </span>
                    {tier.description ? (
                      <span className="mt-2 block text-base leading-relaxed text-ev-ink-muted">
                        {tier.description}
                      </span>
                    ) : null}
                    <span className="mt-2 block text-sm text-ev-ink-muted">
                      {tier.unavailableLabel ??
                        (tier.remaining <= 20
                          ? `${tier.remaining} left`
                          : "Available")}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {buyable.length === 0 ? null : (
        <>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label htmlFor="quantity" className="block text-base">
                How many?
              </label>
              <select
                id="quantity"
                name="quantity"
                defaultValue="1"
                key={`${selectedId}-${max}`}
                aria-describedby={
                  state.errors.quantity ? "error-quantity" : undefined
                }
                aria-invalid={state.errors.quantity ? true : undefined}
                className="ev-field mt-3"
              >
                {Array.from({ length: max }, (_, index) => index + 1).map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
              </select>
              <FieldError id="error-quantity" message={state.errors.quantity} />
            </div>

            <div>
              <label htmlFor="buyer-name" className="block text-base">
                Full name <span className="text-ev-ink-muted">(required)</span>
              </label>
              <input
                id="buyer-name"
                name="name"
                type="text"
                autoComplete="name"
                required
                aria-describedby={state.errors.name ? "error-name" : undefined}
                aria-invalid={state.errors.name ? true : undefined}
                className="ev-field mt-3"
              />
              <FieldError id="error-name" message={state.errors.name} />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="buyer-email" className="block text-base">
                Email <span className="text-ev-ink-muted">(required)</span>
              </label>
              <p id="hint-email" className="mt-1 text-sm text-ev-ink-muted">
                Your ticket and check-in code go here.
              </p>
              <input
                id="buyer-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                aria-describedby={
                  state.errors.email ? "error-email hint-email" : "hint-email"
                }
                aria-invalid={state.errors.email ? true : undefined}
                className="ev-field mt-3"
              />
              <FieldError id="error-email" message={state.errors.email} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" className="ev-button" disabled={pending}>
              {pending
                ? "One moment…"
                : selected?.free
                  ? "Claim your ticket"
                  : "Continue to payment"}
            </button>
            <p aria-live="polite" className="text-sm text-ev-ink-muted">
              {pending
                ? "Holding your seats…"
                : selected?.free
                  ? "No payment needed."
                  : paymentsConfigured
                    ? "You will be taken to Stripe to pay."
                    : "Checkout completes here in test mode. No card is taken."}
            </p>
          </div>
        </>
      )}
    </form>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-2 flex gap-2 text-sm text-ev-danger">
      <span aria-hidden="true">!</span>
      <span>{message}</span>
    </p>
  );
}
