/**
 * Unicode fractions for a typed `\n/d`.
 *
 * The nine fractions Unicode ships as one precomposed glyph get that glyph,
 * the highest fidelity a font can give. Anything else is built from the
 * superscript digits, the fraction slash (U+2044) and the subscript digits,
 * which most fonts kern into a readable stack: `\5/7` is written as ⁵⁄₇.
 * Plain text either way, so it is searchable, survives a markdown round
 * trip and needs no node view.
 */

const PRECOMPOSED: ReadonlyMap<string, string> = new Map([
  ['1/2', '½'],
  ['1/3', '⅓'],
  ['2/3', '⅔'],
  ['1/4', '¼'],
  ['3/4', '¾'],
  ['1/8', '⅛'],
  ['3/8', '⅜'],
  ['5/8', '⅝'],
  ['7/8', '⅞'],
]);

const SUPERSCRIPT_DIGITS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
const SUBSCRIPT_DIGITS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

/** U+2044, the fraction slash, which fonts stack the digits around. */
const FRACTION_SLASH = '\u2044';

const FRACTION_QUERY = /^(\d+)\/(\d+)$/u;

export interface Fraction {
  readonly numerator: number;
  readonly denominator: number;
}

/** `n/d` with a non-zero denominator, as typed after the backslash, or null. */
export function parseFraction(query: string): Fraction | null {
  const match = FRACTION_QUERY.exec(query);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) {
    return null;
  }
  return { numerator, denominator };
}

function digits(value: number, alphabet: readonly string[]): string {
  return Array.from(String(value), (digit) => alphabet[Number(digit)] ?? '').join('');
}

export function renderFraction({ numerator, denominator }: Fraction): string {
  const precomposed = PRECOMPOSED.get(`${String(numerator)}/${String(denominator)}`);
  if (precomposed) return precomposed;
  return `${digits(numerator, SUPERSCRIPT_DIGITS)}${FRACTION_SLASH}${digits(denominator, SUBSCRIPT_DIGITS)}`;
}
