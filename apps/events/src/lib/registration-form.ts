import type { RegistrationConfig } from "@ovation/core";

/**
 * The registration form, derived from Event.registrationConfig.
 *
 * Nothing about the form is hardcoded: the organiser's field list drives what
 * is asked, in what order, with which options. Two things are enforced on top,
 * because the database requires them and a form that cannot produce a valid
 * Guest is not a form: there is always a name and always an email, using the
 * organiser's labels when they supplied them.
 *
 * Pure and dependency-free so the server action and the client component
 * validate against exactly the same shape.
 */

export type FieldMapping =
  | "name"
  | "email"
  | "company"
  | "title"
  | "dietary"
  | null;

export interface FormField {
  key: string;
  label: string;
  type: "text" | "email" | "select" | "checkbox" | "textarea";
  required: boolean;
  options: string[];
  /** Guest column this answer belongs in; null means it lands in notes. */
  mapsTo: FieldMapping;
  autoComplete?: string;
}

const COLUMN_BY_KEY: Record<string, FieldMapping> = {
  name: "name",
  fullname: "name",
  full_name: "name",
  email: "email",
  emailaddress: "email",
  company: "company",
  organisation: "company",
  organization: "company",
  title: "title",
  jobtitle: "title",
  job_title: "title",
  role: "title",
  dietary: "dietary",
  dietaryrequirements: "dietary",
  dietary_requirements: "dietary",
};

const AUTOCOMPLETE: Partial<Record<NonNullable<FieldMapping>, string>> = {
  name: "name",
  email: "email",
  company: "organization",
  title: "organization-title",
};

export function mappingFor(key: string): FieldMapping {
  return COLUMN_BY_KEY[key.trim().toLowerCase().replace(/[\s-]/g, "")] ?? null;
}

export function buildFormFields(config: RegistrationConfig): FormField[] {
  const fields: FormField[] = config.fields.map((field) => {
    const mapsTo = mappingFor(field.key);
    return {
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      options: field.options,
      mapsTo,
      ...(mapsTo && AUTOCOMPLETE[mapsTo]
        ? { autoComplete: AUTOCOMPLETE[mapsTo] }
        : {}),
    };
  });

  // A Guest needs a name and an email. If the config forgot them, add them —
  // silently dropping the registration would be worse than an extra input.
  if (!fields.some((f) => f.mapsTo === "email")) {
    fields.unshift({
      key: "email",
      label: "Email",
      type: "email",
      required: true,
      options: [],
      mapsTo: "email",
      autoComplete: "email",
    });
  }
  if (!fields.some((f) => f.mapsTo === "name")) {
    fields.unshift({
      key: "name",
      label: "Full name",
      type: "text",
      required: true,
      options: [],
      mapsTo: "name",
      autoComplete: "name",
    });
  }

  // collectDietary asks for the question, not for a particular set of answers:
  // with no options configured it is a free-text box, never an invented list.
  if (config.collectDietary && !fields.some((f) => f.mapsTo === "dietary")) {
    fields.push({
      key: "dietary",
      label: "Dietary requirements",
      type: "text",
      required: false,
      options: [],
      mapsTo: "dietary",
    });
  }

  return fields;
}

export interface RegistrationValues {
  name: string;
  email: string;
  company: string | null;
  title: string | null;
  dietary: string | null;
  plusOnes: number;
  /** Answers to fields with no Guest column, kept as label/value pairs. */
  extra: Array<{ label: string; value: string }>;
}

export interface ValidationOutcome {
  values: RegistrationValues | null;
  /** Keyed by field key, plus "consent" and "plusOnes". */
  errors: Record<string, string>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validates a raw form submission. Runs on the server for real; the client
 * imports it too so the first pass of errors arrives without a round trip.
 */
export function validateRegistration(
  config: RegistrationConfig,
  raw: Record<string, string>,
): ValidationOutcome {
  const fields = buildFormFields(config);
  const errors: Record<string, string> = {};

  const values: RegistrationValues = {
    name: "",
    email: "",
    company: null,
    title: null,
    dietary: null,
    plusOnes: 0,
    extra: [],
  };

  for (const field of fields) {
    const answer = (raw[field.key] ?? "").trim();

    if (field.required && answer.length === 0) {
      errors[field.key] = `${field.label} is required.`;
      continue;
    }
    if (field.type === "select" && answer && !field.options.includes(answer)) {
      errors[field.key] = `Choose one of the listed options.`;
      continue;
    }
    if (field.mapsTo === "email" && answer && !EMAIL.test(answer)) {
      errors[field.key] = "That does not look like an email address.";
      continue;
    }
    if (answer.length > 500) {
      errors[field.key] = `${field.label} is too long.`;
      continue;
    }

    switch (field.mapsTo) {
      case "name":
        values.name = answer;
        break;
      case "email":
        values.email = answer.toLowerCase();
        break;
      case "company":
        values.company = answer || null;
        break;
      case "title":
        values.title = answer || null;
        break;
      case "dietary":
        values.dietary = answer || null;
        break;
      default:
        if (answer) values.extra.push({ label: field.label, value: answer });
    }
  }

  if (config.allowPlusOnes) {
    const requested = Number.parseInt(raw.plusOnes ?? "0", 10);
    if (Number.isNaN(requested) || requested < 0) {
      errors.plusOnes = "Tell us a number of guests, or leave it at none.";
    } else if (requested > config.maxPlusOnes) {
      errors.plusOnes = `You can bring at most ${config.maxPlusOnes}.`;
    } else {
      values.plusOnes = requested;
    }
  }

  if (raw.consent !== "on" && raw.consent !== "true") {
    errors.consent = "Please agree to how we use your details before you send.";
  }

  return Object.keys(errors).length > 0
    ? { values: null, errors }
    : { values, errors };
}
