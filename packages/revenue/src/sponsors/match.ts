/**
 * Target-account matching.
 *
 * A sponsor lists the companies it wants introductions to; we join that list
 * against Guest.company. Humans type company names inconsistently — "Helvion
 * Group", "helvion group", "Helvion Group NV", "Portmann & Co." — so the join
 * is on a normalised key, not raw equality.
 */

/** Legal-form and filler tokens stripped from the end of a company name. */
const TRAILING_NOISE = new Set([
  "nv",
  "sa",
  "bv",
  "bvba",
  "cvba",
  "sprl",
  "srl",
  "scrl",
  "gmbh",
  "ag",
  "kg",
  "ltd",
  "limited",
  "llc",
  "lllp",
  "llp",
  "plc",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "sas",
  "sarl",
  "spa",
  "oy",
  "ab",
  "as",
  "aps",
  "co",
  "and",
]);

/**
 * Case-, accent- and punctuation-insensitive company key.
 *
 * "Helvion Group" and "helvion group" collapse to the same key; so do
 * "Portmann & Co" and "Portmann and Co." Industry words ("Capital", "Group",
 * "Systems") are deliberately NOT stripped — they distinguish real, different
 * companies, and dropping them would merge "Corda Capital" with "Corda Legal".
 */
export function normaliseCompany(value: string | null | undefined): string {
  if (!value) return "";
  const tokens = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // strip accents: "Société" -> "Societe"
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  // Drop legal-form suffixes from the end only — "Co-operative Bank" keeps its
  // leading "co", "Portmann & Co" loses its trailing one.
  while (tokens.length > 1 && TRAILING_NOISE.has(tokens[tokens.length - 1] as string)) {
    tokens.pop();
  }

  return tokens.join(" ");
}

export function companiesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normaliseCompany(a);
  if (!left) return false;
  return left === normaliseCompany(b);
}

export interface GuestFacts {
  id: string;
  name: string;
  company: string | null;
  segment?: string;
  rsvpStatus?: string;
}

export interface MatchedLead {
  guestId: string;
  name: string;
  company: string | null;
  /** Which of the sponsor's target accounts this guest matched. */
  targetAccount: string;
}

/**
 * Every guest whose company is on the sponsor's target-account list.
 *
 * A guest matches at most once even if the sponsor listed the same company
 * twice under different spellings.
 */
export function matchTargetAccounts(
  targetAccounts: readonly string[],
  guests: readonly GuestFacts[],
): MatchedLead[] {
  const wanted = new Map<string, string>();
  for (const account of targetAccounts) {
    const key = normaliseCompany(account);
    if (key && !wanted.has(key)) wanted.set(key, account);
  }
  if (wanted.size === 0) return [];

  const matched: MatchedLead[] = [];
  const seen = new Set<string>();

  for (const guest of guests) {
    const key = normaliseCompany(guest.company);
    if (!key) continue;
    const targetAccount = wanted.get(key);
    if (!targetAccount || seen.has(guest.id)) continue;
    seen.add(guest.id);
    matched.push({
      guestId: guest.id,
      name: guest.name,
      company: guest.company,
      targetAccount,
    });
  }

  return matched.sort(
    (a, b) =>
      a.targetAccount.localeCompare(b.targetAccount) || a.name.localeCompare(b.name),
  );
}

/** Which target accounts produced no guest at all — the gap to work on. */
export function unmatchedTargetAccounts(
  targetAccounts: readonly string[],
  matched: readonly MatchedLead[],
): string[] {
  const hit = new Set(matched.map((lead) => normaliseCompany(lead.targetAccount)));
  const out: string[] = [];
  for (const account of targetAccounts) {
    const key = normaliseCompany(account);
    if (key && !hit.has(key) && !out.includes(account)) out.push(account);
  }
  return out;
}
