"use client";

import { useActionState, useEffect, useRef } from "react";
import { emptyFormState, type FormState } from "~/lib/form-state";
import type { FormField } from "~/lib/registration-form";

/**
 * The registration form.
 *
 * Every input on it comes from Event.registrationConfig — the field list, the
 * labels, the select options, whether plus-ones are offered and how many, and
 * the consent wording. Nothing here is written for one event.
 *
 * Accessibility is the point of this screen, so: real labels tied to real
 * inputs, errors announced in a focusable summary and repeated beside the
 * field, aria-invalid and aria-describedby wired up, no colour-only signalling,
 * and 48px controls because most of these arrive from a phone.
 */

export interface RegisterFormProps {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  slug: string;
  fields: FormField[];
  allowPlusOnes: boolean;
  maxPlusOnes: number;
  consentText: string;
  /** True when the room is full and this submission joins a waiting list. */
  waitlisting: boolean;
}

export function RegisterForm({
  action,
  slug,
  fields,
  allowPlusOnes,
  maxPlusOnes,
  consentText,
  waitlisting,
}: RegisterFormProps) {
  const [state, formAction, pending] = useActionState(action, emptyFormState);
  const summary = useRef<HTMLDivElement>(null);

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
          <h2 className="text-lg">We could not send that</h2>
          {state.formError ? (
            <p className="mt-2 text-base text-ev-ink-muted">
              {state.formError}
            </p>
          ) : null}
          {errorKeys.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {errorKeys.map((key) => (
                <li key={key}>
                  <a
                    href={`#field-${key}`}
                    className="text-base underline underline-offset-4"
                  >
                    {state.errors[key]}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-6">
        {fields.map((field) => (
          <Field key={field.key} field={field} error={state.errors[field.key]} />
        ))}

        {allowPlusOnes && maxPlusOnes > 0 ? (
          <div>
            <label htmlFor="field-plusOnes" className="block text-base">
              Are you bringing anyone?
            </label>
            <p id="hint-plusOnes" className="mt-1 text-sm text-ev-ink-muted">
              {maxPlusOnes === 1
                ? "You may bring one guest."
                : `You may bring up to ${maxPlusOnes} guests.`}{" "}
              We count their seat too.
            </p>
            <select
              id="field-plusOnes"
              name="plusOnes"
              defaultValue="0"
              aria-describedby={
                state.errors.plusOnes ? "error-plusOnes hint-plusOnes" : "hint-plusOnes"
              }
              aria-invalid={state.errors.plusOnes ? true : undefined}
              className="ev-field mt-3"
            >
              {Array.from({ length: maxPlusOnes + 1 }, (_, n) => (
                <option key={n} value={String(n)}>
                  {n === 0
                    ? "Just me"
                    : `${n} guest${n === 1 ? "" : "s"} as well as me`}
                </option>
              ))}
            </select>
            <FieldError id="error-plusOnes" message={state.errors.plusOnes} />
          </div>
        ) : null}
      </div>

      <fieldset className="rounded-ev border border-ev-line p-5">
        <legend className="ev-kicker px-2 text-ev-accent-text">Your data</legend>
        <div className="flex gap-3">
          <input
            id="field-consent"
            name="consent"
            type="checkbox"
            value="on"
            aria-describedby={state.errors.consent ? "error-consent" : undefined}
            aria-invalid={state.errors.consent ? true : undefined}
            className="mt-1 h-6 w-6 shrink-0 accent-[var(--ev-accent)]"
          />
          <label
            htmlFor="field-consent"
            className="text-base leading-relaxed text-ev-ink-muted"
          >
            {consentText}
          </label>
        </div>
        <FieldError id="error-consent" message={state.errors.consent} />
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className="ev-button" disabled={pending}>
          {pending
            ? "Sending…"
            : waitlisting
              ? "Join the waiting list"
              : "Confirm my place"}
        </button>
        <p aria-live="polite" className="text-sm text-ev-ink-muted">
          {pending ? "Saving your details…" : "We will email your confirmation."}
        </p>
      </div>
    </form>
  );
}

function Field({ field, error }: { field: FormField; error?: string }) {
  const id = `field-${field.key}`;
  const errorId = `error-${field.key}`;
  const described = error ? errorId : undefined;

  const shared = {
    id,
    name: field.key,
    required: field.required,
    "aria-invalid": error ? (true as const) : undefined,
    "aria-describedby": described,
    className: "ev-field mt-3",
    ...(field.autoComplete ? { autoComplete: field.autoComplete } : {}),
  };

  return (
    <div>
      <label htmlFor={id} className="block text-base">
        {field.label}
        {field.required ? (
          <span className="text-ev-ink-muted"> (required)</span>
        ) : (
          <span className="text-ev-ink-muted"> (optional)</span>
        )}
      </label>

      {field.type === "textarea" ? (
        <textarea {...shared} rows={4} />
      ) : field.type === "select" ? (
        <select {...shared} defaultValue="">
          <option value="">Please choose</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.type === "checkbox" ? (
        <div className="mt-3 flex gap-3">
          <input
            {...shared}
            type="checkbox"
            value="on"
            className="mt-1 h-6 w-6 shrink-0 accent-[var(--ev-accent)]"
          />
        </div>
      ) : (
        <input
          {...shared}
          type={field.mapsTo === "email" ? "email" : "text"}
          inputMode={field.mapsTo === "email" ? "email" : undefined}
        />
      )}

      <FieldError id={errorId} message={error} />
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-2 flex gap-2 text-sm text-ev-danger">
      {/* A symbol as well as the colour: contrast is not the only reader. */}
      <span aria-hidden="true">!</span>
      <span>{message}</span>
    </p>
  );
}
