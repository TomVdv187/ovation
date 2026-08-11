/**
 * The shape a server action hands back to a form.
 *
 * Kept out of the "use server" modules on purpose: every export of one of those
 * has to be an async function, so shared types and constants live here.
 */
export interface FormState {
  /** Keyed by field name. Rendered next to the input and in the summary. */
  errors: Record<string, string>;
  /** Something that went wrong with the submission as a whole. */
  formError: string | null;
}

export const emptyFormState: FormState = { errors: {}, formError: null };
