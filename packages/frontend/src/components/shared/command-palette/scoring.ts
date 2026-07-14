/** Shared fuzzy scoring for the command palettes. */

/** Below this length the fuzzy tier matches almost everything, so it is skipped. */
const FUZZY_MIN_QUERY_LENGTH = 3;

/** Prose matches count for less than name matches, so a stray word in a long
 *  description cannot outrank an item whose actual name you typed. */
const SECONDARY_WEIGHT = 0.5;

/**
 * Fold a string into comparable words: split camelCase, lowercase, and reduce
 * every separator (`-`, `_`, `.`, `/`, punctuation) to a single space.
 */
function normalise(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface Haystack {
  /** Names and identifiers. Matched strongly, and eligible for fuzzy matching. */
  primary: string[];
  /** Prose. Matched literally only, and down-weighted. */
  secondary: string[];
}

export function buildHaystack(
  primary: Array<string | undefined | null>,
  secondary: Array<string | undefined | null> = []
): Haystack {
  const fold = (values: Array<string | undefined | null>) => {
    const out: string[] = [];
    for (const value of values) {
      if (!value) continue;
      const folded = normalise(value);
      if (folded) out.push(folded);
    }
    return out;
  };
  return { primary: fold(primary), secondary: fold(secondary) };
}

export interface Query {
  /** The whole query, folded. An exact/prefix hit on this beats any term match. */
  phrase: string;
  /** The individual words. Every one of them must match, or the item is dropped. */
  terms: string[];
}

export function parseQuery(raw: string): Query {
  const phrase = normalise(raw);
  return { phrase, terms: phrase ? phrase.split(' ') : [] };
}

/** Returns 0–100. `text` and `query` must both be folded by {@link normalise}. */
function scoreMatch(text: string, query: string, allowFuzzy: boolean): number {
  if (!query || !text) return 0;
  if (text === query) return 100;
  if (text.startsWith(query)) return 90;
  if (text.includes(query)) return 75;
  const words = text.split(' ');
  if (words.some((w) => w.startsWith(query))) return 65;
  if (words.some((w) => w.includes(query))) return 55;
  if (!allowFuzzy) return 0;
  // fuzzy: all query chars appear in order
  let qi = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) qi++;
  }
  if (qi === query.length)
    return 10 + Math.floor((query.length / text.length) * 30);
  return 0;
}

function best(texts: readonly string[], query: string, fuzzy: boolean): number {
  let top = 0;
  for (const text of texts) {
    const score = scoreMatch(text, query, fuzzy);
    if (score > top) top = score;
  }
  return top;
}

/** Returns 0–100. 0 means "do not show this item at all". */
export function scoreItem(haystack: Haystack, query: Query): number {
  const { phrase, terms } = query;
  if (!terms.length) return 0;

  // Fuzzy matching only makes sense for a single word: a multi-word query is a
  // deliberate phrase
  const allowFuzzy =
    terms.length === 1 && phrase.length >= FUZZY_MIN_QUERY_LENGTH;

  const scoreOne = (term: string) =>
    Math.max(
      best(haystack.primary, term, allowFuzzy),
      best(haystack.secondary, term, false) * SECONDARY_WEIGHT
    );

  let sum = 0;
  for (const term of terms) {
    const score = scoreOne(term);
    if (score === 0) return 0; // every term must land somewhere
    sum += score;
  }

  // A phrase hit should beat the average of its
  // parts, which is all the per-term pass can ever report.
  return Math.max(sum / terms.length, terms.length > 1 ? scoreOne(phrase) : 0);
}
