import type { EventFacts, GuestFacts, WrittenEmail } from "./types";

/**
 * The automated reader that stands between the model and an EmailMessage row.
 *
 * These are the same checks the eval script asserts, run inline on every draft:
 * a draft that fails is retried with the failures fed back, and one that keeps
 * failing is dropped rather than stored. That is what stops a hallucinated
 * "as we discussed last year" from reaching an organiser's approval queue.
 *
 * Pure and dependency-free on purpose, so both the eval and the unit tests can
 * exercise it without a model, a key or a database.
 */

export const SUBJECT_MAX_CHARS = 60;

export const BODY_WORDS_HARD = { min: 45, max: 400 } as const;
export const BODY_WORDS_SOFT = { min: 70, max: 220 } as const;

/** Phrases that get an event invitation filed as marketing, or as junk. */
export const SPAM_TRIGGERS = [
  "act now",
  "limited time",
  "click here",
  "don't miss",
  "do not miss",
  "exclusive offer",
  "risk-free",
  "money back",
  "buy now",
  "order now",
  "special promotion",
  "once in a lifetime",
  "100% guaranteed",
  "guaranteed",
  "congratulations",
  "winner",
  "cash bonus",
  "no obligation",
  "urgent",
  "apply now",
  "free gift",
  "for free",
  "sign up free",
];

/** Signals that the model answered something inside a data block instead of writing an email. */
const INJECTION_TELLS = [
  /\bsystem prompt\b/i,
  /\bmy instructions\b/i,
  /\bprevious instructions\b/i,
  /\bas an ai\b/i,
  /\bai (?:language )?(?:model|assistant)\b/i,
  /\blanguage model\b/i,
  /\bi (?:have been|was) instructed\b/i,
  /\bi (?:cannot|can't|won't) comply\b/i,
  /\bguest_record\b/i,
  /\bevent_record\b/i,
  /\bcompose_email\b/i,
];

const MERGE_FIELD_PATTERNS = [
  /\[[^\]\n]{1,40}\]/,
  /\{\{?[^}\n]{1,40}\}?\}/,
  /%%[^%\n]{1,40}%%/,
  /\bdear (?:customer|guest|sir or madam|valued)\b/i,
];

const MARKUP_PATTERNS = [
  /<\/?[a-z][a-z0-9-]*(?:\s[^>\n]*)?>/i,
  /^\s*#{1,6}\s/m,
  /\]\(https?:/i,
  /\*\*[^*\n]+\*\*/,
];

/**
 * Words a business invitation may use without them counting as a fact drawn
 * from the guest record. Capitalised words outside this list and outside the
 * record's own vocabulary are treated as invented proper nouns.
 */
const ALLOWED_CAPITALISED = new Set(
  [
    // sentence furniture and salutations
    "dear", "hi", "hello", "kind", "warm", "regards", "best", "wishes", "thanks",
    "thank", "yours", "sincerely", "warmly", "ps",
    "i", "i'd", "i'm", "i'll", "i've", "we", "we'd", "we'll", "we've", "you",
    "you'd", "you'll", "you've", "it", "it's", "there", "this", "that", "if",
    "and", "but", "so", "the", "a", "an", "on", "in", "at", "for", "with", "as",
    "your", "our", "my", "he", "she", "they", "let", "would", "should", "could",
    "no", "yes", "not", "do", "don't", "please", "just", "given", "since",
    "because", "when", "where", "what", "who", "how", "why", "either", "both",
    "after", "before", "between", "over", "under", "about", "from", "to", "of",
    // calendar
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december",
    // places an invitation to a Benelux event may reasonably name
    "antwerp", "antwerpen", "brussels", "bruxelles", "brussel", "ghent", "gent",
    "amsterdam", "rotterdam", "luxembourg", "belgium", "belgian", "netherlands",
    "dutch", "flemish", "wallonia", "flanders", "benelux", "europe", "european",
    "cet", "cest",
    // generic event vocabulary
    "ai", "ceo", "cfo", "coo", "cto", "vip", "rsvp", "q&a",
  ].map((w) => w.toLowerCase()),
);

export type CheckSeverity = "error" | "warning";

export interface CheckFinding {
  check: string;
  ok: boolean;
  severity: CheckSeverity;
  detail: string;
}

export interface CheckReport {
  ok: boolean;
  findings: CheckFinding[];
  failures: CheckFinding[];
}

export function inspectEmail(
  email: WrittenEmail,
  guest: GuestFacts,
  event: EventFacts,
): CheckReport {
  const findings: CheckFinding[] = [];
  const body = email.body ?? "";
  const subject = email.subject ?? "";
  const haystack = `${subject}\n${body}`;
  const vocabulary = buildVocabulary(guest, event);

  findings.push(checkName(guest, body));
  findings.push(checkCompany(guest, body));
  findings.push(checkSubjectLength(subject));
  findings.push(checkSpam(haystack));
  findings.push(checkMergeFields(haystack));
  findings.push(checkMarkup(haystack));
  findings.push(checkInjection(haystack));
  findings.push(checkInventedNumbers(haystack, vocabulary));
  findings.push(checkInventedNames(body, vocabulary));
  findings.push(checkBodyLength(body));
  findings.push(checkGrounding(email));

  const failures = findings.filter((f) => !f.ok && f.severity === "error");
  return { ok: failures.length === 0, findings, failures };
}

/** The reasons string fed back to the model on a retry. */
export function explainFailures(report: CheckReport): string {
  return report.failures.map((f) => `- ${f.check}: ${f.detail}`).join("\n");
}

// ── individual checks ─────────────────────────────────────────

function finding(
  check: string,
  ok: boolean,
  severity: CheckSeverity,
  detail: string,
): CheckFinding {
  return { check, ok, severity, detail };
}

function checkName(guest: GuestFacts, body: string): CheckFinding {
  const first = (guest.name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first) {
    return finding("name_present", true, "error", "Guest has no name on record; nothing to check.");
  }
  const ok = body.toLowerCase().includes(first.toLowerCase());
  return finding(
    "name_present",
    ok,
    "error",
    ok
      ? `Addresses them as "${first}".`
      : `The body never uses the guest's first name ("${first}"). Address them by name.`,
  );
}

function checkCompany(guest: GuestFacts, body: string): CheckFinding {
  const company = (guest.company ?? "").trim();
  if (!company) {
    return finding("company_present", true, "error", "Guest has no company on record; nothing to check.");
  }
  const ok = body.toLowerCase().includes(company.toLowerCase());
  return finding(
    "company_present",
    ok,
    "error",
    ok
      ? `Names ${company}.`
      : `The body never mentions the guest's company ("${company}"). Name it at least once.`,
  );
}

function checkSubjectLength(subject: string): CheckFinding {
  const ok = subject.length > 0 && subject.length < SUBJECT_MAX_CHARS;
  return finding(
    "subject_length",
    ok,
    "error",
    ok
      ? `Subject is ${subject.length} characters.`
      : `Subject is ${subject.length} characters; it must be between 1 and ${SUBJECT_MAX_CHARS - 1}.`,
  );
}

function checkSpam(haystack: string): CheckFinding {
  const lower = haystack.toLowerCase();
  const hits = SPAM_TRIGGERS.filter((phrase) => lower.includes(phrase));
  const shouty = /[A-Z]{5,}/.test(haystack) ? ["shouted words in capitals"] : [];
  const bangs = (haystack.match(/!/g) ?? []).length > 1 ? ["more than one exclamation mark"] : [];
  const all = [...hits, ...shouty, ...bangs];
  return finding(
    "no_spam_triggers",
    all.length === 0,
    "error",
    all.length === 0
      ? "No spam-trigger language."
      : `Contains spam-trigger language: ${all.join(", ")}.`,
  );
}

function checkMergeFields(haystack: string): CheckFinding {
  const hit = MERGE_FIELD_PATTERNS.find((p) => p.test(haystack));
  return finding(
    "no_merge_fields",
    !hit,
    "error",
    hit
      ? `Reads like a template rather than a written email: matched ${hit}.`
      : "No placeholders or template salutations.",
  );
}

function checkMarkup(haystack: string): CheckFinding {
  const hit = MARKUP_PATTERNS.find((p) => p.test(haystack));
  return finding(
    "plain_text",
    !hit,
    "error",
    hit ? `Contains markup rather than plain text: matched ${hit}.` : "Plain text throughout.",
  );
}

function checkInjection(haystack: string): CheckFinding {
  const hit = INJECTION_TELLS.find((p) => p.test(haystack));
  return finding(
    "no_injected_instructions",
    !hit,
    "error",
    hit
      ? `The draft talks about its own instructions or the data blocks (matched ${hit}), which means something in the guest record was treated as a command.`
      : "Nothing in the guest record was treated as an instruction.",
  );
}

function checkInventedNumbers(haystack: string, vocab: Vocabulary): CheckFinding {
  const used = haystack.match(/\d+/g) ?? [];
  const invented = [...new Set(used)].filter((n) => !vocab.numbers.has(n));
  return finding(
    "no_invented_numbers",
    invented.length === 0,
    "error",
    invented.length === 0
      ? "Every number in the copy comes from the record."
      : `Uses numbers that appear nowhere in the guest or event record: ${invented.join(", ")}.`,
  );
}

function checkInventedNames(body: string, vocab: Vocabulary): CheckFinding {
  const invented = findInventedProperNouns(body, vocab);
  return finding(
    "no_invented_facts",
    invented.length === 0,
    "error",
    invented.length === 0
      ? "Every name in the copy comes from the record."
      : `Names things that appear nowhere in the guest or event record: ${invented.join(", ")}.`,
  );
}

function checkBodyLength(body: string): CheckFinding {
  const words = countWords(body);
  const hard = words >= BODY_WORDS_HARD.min && words <= BODY_WORDS_HARD.max;
  const soft = words >= BODY_WORDS_SOFT.min && words <= BODY_WORDS_SOFT.max;
  if (!hard) {
    return finding(
      "body_length",
      false,
      "error",
      `Body is ${words} words; it must be between ${BODY_WORDS_HARD.min} and ${BODY_WORDS_HARD.max}.`,
    );
  }
  return finding(
    "body_length",
    soft,
    "warning",
    soft
      ? `Body is ${words} words.`
      : `Body is ${words} words, outside the comfortable ${BODY_WORDS_SOFT.min}–${BODY_WORDS_SOFT.max} range.`,
  );
}

function checkGrounding(email: WrittenEmail): CheckFinding {
  const count = email.groundedOn?.length ?? 0;
  return finding(
    "grounded_on_declared",
    count > 0,
    "warning",
    count > 0
      ? `Declares ${count} facts it leaned on.`
      : "Declares no grounding facts, so there is nothing to audit the copy against.",
  );
}

// ── vocabulary ────────────────────────────────────────────────

export interface Vocabulary {
  words: Set<string>;
  numbers: Set<string>;
  /** The raw text the vocabulary was built from, useful in test failures. */
  source: string;
}

/**
 * Everything the copy is allowed to know, drawn from the two records the model
 * was given — plus the event date rendered the several ways a human would write
 * it, so "24 September", "18:30" and "6:30pm" all count as grounded.
 */
export function buildVocabulary(guest: GuestFacts, event: EventFacts): Vocabulary {
  const pieces: Array<string | null | undefined> = [
    guest.name,
    guest.email,
    guest.company,
    guest.title,
    guest.segment,
    guest.rsvpStatus,
    guest.ticketTier,
    guest.dietary,
    guest.notes,
    ...guest.interests,
    String(guest.plusOnes),
    String(guest.emailOpens),
    String(guest.emailClicks),
    String(guest.pageVisits),
    event.title,
    event.description,
    event.venue,
    event.venueAddress,
    event.dressCode,
    event.organiser,
    String(event.capacity),
    ...event.agenda.flatMap((item) => [item.title, item.speaker, item.room]),
    ...renderDateVariants(event.date, event.timezone),
    ...(event.endsAt ? renderDateVariants(event.endsAt, event.timezone) : []),
  ];

  const source = pieces.filter((p): p is string => typeof p === "string" && p.length > 0).join(" \n ");

  const words = new Set<string>();
  for (const token of source.toLowerCase().match(/[\p{L}][\p{L}'’-]*/gu) ?? []) {
    words.add(token);
    // Also index the parts of hyphenated and possessive forms.
    for (const part of token.split(/[-'’]/)) {
      if (part.length > 1) words.add(part);
    }
  }

  const numbers = new Set(source.match(/\d+/g) ?? []);
  // Small counting numbers a sentence can carry without claiming a fact.
  for (const n of ["1", "2", "3"]) numbers.add(n);

  return { words, numbers, source };
}

function renderDateVariants(date: Date, timezone: string): string[] {
  const opts: Intl.DateTimeFormatOptions[] = [
    { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: timezone },
    { day: "numeric", month: "short", year: "numeric", timeZone: timezone },
    { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone },
    { hour: "numeric", minute: "2-digit", hour12: true, timeZone: timezone },
  ];
  return opts.map((o) => new Intl.DateTimeFormat("en-GB", o).format(date));
}

/**
 * Capitalised words that are not sentence-initial, not ordinary English and not
 * in the record. A model that invents a speaker, a sponsor or a venue trips this.
 */
export function findInventedProperNouns(body: string, vocab: Vocabulary): string[] {
  const invented = new Set<string>();
  const pattern = /[\p{Lu}][\p{L}'’-]+/gu;

  for (const match of body.matchAll(pattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (startsSentence(body, index)) continue;

    const lower = token.toLowerCase();
    if (ALLOWED_CAPITALISED.has(lower)) continue;
    if (vocab.words.has(lower)) continue;
    if (lower.split(/[-'’]/).every((part) => part.length < 2 || vocab.words.has(part))) continue;

    invented.add(token);
  }

  return [...invented];
}

function startsSentence(body: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const ch = body[i];
    if (ch === undefined) return true;
    if (ch === " " || ch === "\t" || ch === '"' || ch === "'" || ch === "“" || ch === "‘") continue;
    if (ch === "\n" || ch === "." || ch === "!" || ch === "?" || ch === ":") return true;
    return false;
  }
  return true;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// ── distinctness ──────────────────────────────────────────────

/**
 * Jaccard similarity over word trigrams. Two emails written from a template
 * score high here; two written for different people do not. This is the check
 * that would catch a regression back to merge fields.
 */
export function similarity(a: string, b: string): number {
  const left = shingles(a);
  const right = shingles(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const s of left) if (right.has(s)) shared++;
  return shared / (left.size + right.size - shared);
}

function shingles(text: string, size = 3): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) {
    out.add(words.slice(i, i + size).join(" "));
  }
  return out;
}

export interface SimilarPair {
  a: number;
  b: number;
  score: number;
}

/** Every pair scoring at or above `threshold`. Empty means the batch is distinct. */
export function findTemplatedPairs(bodies: string[], threshold = 0.35): SimilarPair[] {
  const pairs: SimilarPair[] = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const score = similarity(bodies[i] ?? "", bodies[j] ?? "");
      if (score >= threshold) pairs.push({ a: i, b: j, score });
    }
  }
  return pairs;
}
