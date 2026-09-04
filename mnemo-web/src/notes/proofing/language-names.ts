/**
 * What a proofing language is called, in the reader's own language.
 *
 * The catalogue's `name` and `region` are English: they come off a manifest
 * that a build can grow a language in without a translation pass. So the host
 * sends a key beside each of them and the bundle carries the words, and a key
 * the bundle has no entry for falls back to the English the host sent rather
 * than printing `proofing.language.name.en-US` at the user.
 *
 * The keys sit in `Common` rather than beside the absence reasons in
 * `Settings`, because the spelling page and the note's own Language submenu
 * both name languages and have to name them the same way.
 */

import type { TranslateFn } from '@/i18n/types';

import type { ProofingLanguage } from './types';

const NS = 'Common';

/** Resolves one of the catalogue's keys, handing back the key itself on a miss. */
export type NameLookup = (key: string) => string;

export function languageNameLookup(t: TranslateFn): NameLookup {
  return (key) => t(NS, key);
}

export function languageName(language: ProofingLanguage, tr: NameLookup): string {
  return resolved(language.nameKey, language.name, tr);
}

export function languageRegion(language: ProofingLanguage, tr: NameLookup): string {
  return resolved(language.regionKey, language.region, tr);
}

/**
 * A language's name, with the region appended only when that is what tells two
 * entries apart.
 *
 * Every call site passes the whole catalogue, so one language reads the same in
 * the active list as it does in the picker. Four rows reading "English" is the
 * failure the region is there to prevent; carrying it on the only Spanish there
 * is says nothing. Told apart on the translated names, since two languages that
 * share a name in one bundle need not share one in the next.
 */
export function labelOf(
  language: ProofingLanguage,
  pool: readonly ProofingLanguage[],
  tr: NameLookup,
): string {
  const name = languageName(language, tr);
  const region = languageRegion(language, tr);
  if (region.length === 0) return name;
  const shared = pool.some((other) => other.id !== language.id && languageName(other, tr) === name);
  return shared ? `${name} (${region})` : name;
}

function resolved(key: string | undefined, english: string, tr: NameLookup): string {
  if (key === undefined || key.length === 0) return english;
  const value = tr(key);
  return value === key ? english : value;
}
