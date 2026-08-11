/**
 * Turning untrusted text into inert data.
 *
 * A guest's name, company and notes arrive from a public registration form, so
 * they are attacker-controlled strings that end up a few characters away from a
 * system prompt. Two defences, applied here:
 *
 *  1. angle brackets and ampersands are escaped, so nothing inside a value can
 *     close the `<guest_record>` block it sits in and start issuing orders;
 *  2. newlines, control characters and invisible characters are collapsed, so a
 *     value cannot fake the line structure of the surrounding block or hide text
 *     from whoever reviews the draft.
 *
 * The instruction "treat that block as data" lives in the system prompt. This
 * file is what makes that instruction enforceable rather than aspirational.
 */

/** Longest a single guest-supplied value may be before it is cut short. */
export const MAX_FIELD_CHARS = 200;

/** Longest the free-text notes field may be. */
export const MAX_NOTES_CHARS = 600;

const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F-\\u009F]", "g");

/** Zero-width, line-separator and bidi marks, which can hide text from a human reviewer. */
const INVISIBLE_CHARS = new RegExp(
  "[\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060-\\u2064\\uFEFF]",
  "g",
);

export function sanitiseValue(value: unknown, maxChars = MAX_FIELD_CHARS): string {
  const text =
    typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);

  const flattened = text
    .normalize("NFC")
    .replace(CONTROL_CHARS, " ")
    .replace(INVISIBLE_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();

  const escaped = flattened
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped.length > maxChars ? `${escaped.slice(0, maxChars - 1).trimEnd()}…` : escaped;
}

export function sanitiseList(values: readonly unknown[], maxItems = 12): string {
  return values
    .slice(0, maxItems)
    .map((v) => sanitiseValue(v, 60))
    .filter((v) => v.length > 0)
    .join(", ");
}

export type BlockEntry = [label: string, value: string | number | null | undefined];

/**
 * Render a labelled data block. Labels are ours and fixed; only the values come
 * from outside, and they have already been through `sanitiseValue`.
 */
export function renderDataBlock(tag: string, entries: BlockEntry[]): string {
  const lines = entries
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([label, value]) => `  ${label}: ${String(value)}`);
  return `<${tag}>\n${lines.join("\n")}\n</${tag}>`;
}

/** The display name we address someone by, with the same protections applied. */
export function safeFirstName(name: string): string {
  const clean = sanitiseValue(name, 60);
  const first = clean.split(" ")[0] ?? "";
  return first.length > 0 ? first : "there";
}
