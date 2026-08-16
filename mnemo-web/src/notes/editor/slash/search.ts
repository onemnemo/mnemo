/**
 * Matching a typed `/query` against the menu's rows, ported from
 * `SlashCommandMenu`'s filter.
 *
 * Two properties are worth keeping, and both come from the desktop:
 *
 *  - **Normalize hard, then substring.** Accents, punctuation and case are
 *    stripped from both sides before comparing, so `to-do`, `To Do` and `todo`
 *    are one query, and a user typing `numbered` finds a row whose label is
 *    "Numbered List" without the list of aliases growing a maintenance problem.
 *  - **Digits and their words are the same token.** "heading 1" and
 *    "heading one" find the same row. Menus that skip this fail on exactly the
 *    rows people search for by number.
 *
 * Matching is over the *resolved* label and description, so it follows the UI
 * language, plus the i18n key and node name, which keeps the English names
 * working in a non-English UI. The description is never drawn; it exists so
 * that "bulleted" finds the bullet list.
 */

const DIGIT_WORDS: readonly string[] = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
];

const WORD_OF_DIGIT = new Map(DIGIT_WORDS.map((word, digit) => [String(digit), word]));
const DIGIT_OF_WORD = new Map(DIGIT_WORDS.map((word, digit) => [word, String(digit)]));

/**
 * Lower case, accent-free, letters and digits only, single-spaced.
 *
 * Combining marks are dropped after decomposing rather than mapped, so `é`
 * compares equal to `e` in either encoding. Everything that is not a letter or
 * digit becomes one space, which is what makes `to-do` and `to do` the same
 * query and what lets a hint like `1.` be searched as `1`.
 */
export function normalizeSearchText(text: string): string {
  if (text.trim().length === 0) return '';
  const decomposed = text.normalize('NFD').replace(/\p{Mn}/gu, '');
  let out = '';
  let lastWasSpace = false;
  for (const ch of decomposed) {
    if (/\p{L}|\p{N}/u.test(ch)) {
      out += ch.toLowerCase();
      lastWasSpace = false;
    } else if (!lastWasSpace) {
      out += ' ';
      lastWasSpace = true;
    }
  }
  return out.trim();
}

/**
 * The all-words and all-digits readings of an already-normalized string, or
 * nothing when it contains neither. Both are yielded rather than one canonical
 * form because the query goes through the same expansion, and meeting in the
 * middle needs both sides to offer both readings.
 */
function numericAliases(normalized: string): string[] {
  if (normalized.length === 0) return [];
  const parts = normalized.split(' ');
  const words: string[] = [];
  const digits: string[] = [];
  let replaced = false;

  for (const part of parts) {
    const word = WORD_OF_DIGIT.get(part);
    const digit = DIGIT_OF_WORD.get(part);
    if (word !== undefined) {
      words.push(word);
      digits.push(part);
      replaced = true;
    } else if (digit !== undefined) {
      words.push(part);
      digits.push(digit);
      replaced = true;
    } else {
      words.push(part);
      digits.push(part);
    }
  }

  return replaced ? [words.join(' '), digits.join(' ')] : [];
}

/** Every string a row can be found by, normalized and deduplicated. */
export function searchCandidates(sources: readonly (string | undefined)[]): readonly string[] {
  const out = new Set<string>();
  for (const source of sources) {
    if (source === undefined) continue;
    const normalized = normalizeSearchText(source);
    if (normalized.length > 0) out.add(normalized);
    for (const alias of numericAliases(normalized)) out.add(alias);
  }
  return [...out];
}

/** Whether any of a row's candidates contains the normalized query. */
export function matchesQuery(candidates: readonly string[], query: string): boolean {
  const normalized = normalizeSearchText(query);
  if (normalized.length === 0) return true;
  const wanted = [normalized, ...numericAliases(normalized)];
  return candidates.some((candidate) => wanted.some((term) => candidate.includes(term)));
}
