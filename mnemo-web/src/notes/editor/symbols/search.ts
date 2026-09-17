/**
 * Ranked lookup over the catalog's LaTeX names and aliases.
 *
 * Ranking matters more than it looks: "in" is a substring of "infty", "int",
 * "sin" and a dozen aliases, so a plain contains-filter buries ∈ under rows
 * nobody meant. An exact name wins, then an exact alias, then a name prefix,
 * then an alias word prefix, then any substring, and ties keep catalog order,
 * which puts the familiar symbol of a group first. Case counts for an exact
 * name only, so `Omega` puts Ω first and `omega` puts ω first while either
 * still finds both.
 *
 * A query that reads as `n/d` is a fraction whether or not the catalog lists
 * it: the nine precomposed glyphs are rows of their own, and anything else is
 * rendered on the spot from superscript and subscript digits.
 */

import { SYMBOL_CATALOG, type SymbolEntry, type SymbolGroup } from './catalog';
import { parseFraction, renderFraction } from './fractions';

const SCORE = {
  nameExact: 100,
  nameExactFolded: 90,
  aliasExact: 80,
  namePrefix: 60,
  aliasPrefix: 40,
  substring: 10,
} as const;

export interface SymbolHit {
  readonly entry: SymbolEntry;
  /** `recent` for the rows drawn under the Recent heading, otherwise the entry's own group. */
  readonly group: SymbolGroup | 'recent';
}

export interface SymbolSearchOptions {
  readonly catalog?: readonly SymbolEntry[];
  /** LaTeX names, most recent first, shown ahead of the groups while the query is empty. */
  readonly recents?: readonly string[];
}

/** True when any word of the haystack begins with the needle, not just the first. */
function startsWithWord(haystack: string, needle: string): boolean {
  if (haystack.startsWith(needle)) return true;
  let from = haystack.indexOf(' ');
  while (from !== -1) {
    if (haystack.startsWith(needle, from + 1)) return true;
    from = haystack.indexOf(' ', from + 1);
  }
  return false;
}

function score(entry: SymbolEntry, query: string, needle: string): number {
  if (entry.name === query) return SCORE.nameExact;
  const name = entry.name.toLowerCase();
  if (name === needle) return SCORE.nameExactFolded;

  let best = name.startsWith(needle) ? SCORE.namePrefix : name.includes(needle) ? SCORE.substring : 0;
  for (const alias of entry.aliases) {
    const folded = alias.toLowerCase();
    if (folded === needle) return SCORE.aliasExact;
    if (startsWithWord(folded, needle)) best = Math.max(best, SCORE.aliasPrefix);
    else if (folded.includes(needle)) best = Math.max(best, SCORE.substring);
  }
  return best;
}

/** The entry a typed `n/d` names, rendered on the spot when the catalog has no row for it. */
function fractionEntry(query: string, catalog: readonly SymbolEntry[]): SymbolEntry | null {
  const fraction = parseFraction(query);
  if (!fraction) return null;
  if (catalog.some((entry) => entry.name === query)) return null;
  return { name: query, char: renderFraction(fraction), group: 'fractions', aliases: [] };
}

/** Resolves a remembered name back to its entry, or null when nothing answers to it any more. */
export function symbolByName(name: string, catalog: readonly SymbolEntry[] = SYMBOL_CATALOG): SymbolEntry | null {
  return catalog.find((entry) => entry.name === name) ?? fractionEntry(name, catalog);
}

export function searchSymbols(query: string, options: SymbolSearchOptions = {}): readonly SymbolHit[] {
  const catalog = options.catalog ?? SYMBOL_CATALOG;
  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();

  if (needle.length === 0) {
    const recent: SymbolHit[] = [];
    for (const name of options.recents ?? []) {
      const entry = symbolByName(name, catalog);
      if (entry) recent.push({ entry, group: 'recent' });
    }
    return [...recent, ...catalog.map((entry) => ({ entry, group: entry.group }))];
  }

  const scored: { readonly hit: SymbolHit; readonly score: number; readonly order: number }[] = [];
  catalog.forEach((entry, order) => {
    const value = score(entry, trimmed, needle);
    if (value > 0) scored.push({ hit: { entry, group: entry.group }, score: value, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);

  const hits = scored.map((item) => item.hit);
  const fraction = fractionEntry(trimmed, catalog);
  return fraction ? [{ entry: fraction, group: 'fractions' }, ...hits] : hits;
}
