/**
 * How a language reads on a screen that is not in English.
 *
 * The catalogue's own words are English and the manifest can grow a language on
 * any build, so the rule that decides whether a region is worth showing has to
 * run on what the reader sees, not on what the host sent: two entries that share
 * a name in one bundle need not share one in the next.
 */

import { describe, expect, it } from 'vitest';

import { mergedEnglishBundle, resolves } from '@/i18n/test-bundle';

import { labelOf, languageName, languageRegion } from './language-names';
import type { ProofingLanguage } from './types';

function language(over: Partial<ProofingLanguage> = {}): ProofingLanguage {
  return {
    id: 'en-US',
    name: 'English',
    nameKey: 'proofing.language.name.en-US',
    region: 'United States',
    regionKey: 'proofing.language.region.en-US',
    installed: true,
    bundled: true,
    state: 'ready',
    license: { name: 'SCOWL', url: 'https://example.invalid' },
    ...over,
  };
}

const NORWEGIAN: Record<string, string> = {
  'proofing.language.name.en-US': 'Engelsk',
  'proofing.language.region.en-US': 'USA',
  'proofing.language.name.en-GB': 'Engelsk',
  'proofing.language.region.en-GB': 'Storbritannia',
  'proofing.language.name.es-ES': 'Spansk',
  'proofing.language.region.es-ES': 'Spania',
};

const nb = (key: string) => NORWEGIAN[key] ?? key;
const untranslated = (key: string) => key;

const ENGLISH = language();
const BRITISH = language({
  id: 'en-GB',
  nameKey: 'proofing.language.name.en-GB',
  region: 'United Kingdom',
  regionKey: 'proofing.language.region.en-GB',
});
const SPANISH = language({
  id: 'es-ES',
  name: 'Spanish',
  nameKey: 'proofing.language.name.es-ES',
  region: 'Spain',
  regionKey: 'proofing.language.region.es-ES',
});

describe('naming a language', () => {
  it('reads the name and the region out of the bundle', () => {
    expect(languageName(ENGLISH, nb)).toBe('Engelsk');
    expect(languageRegion(ENGLISH, nb)).toBe('USA');
  });

  it('prints the host English when the bundle has no entry for the key', () => {
    expect(languageName(ENGLISH, untranslated)).toBe('English');
    expect(languageRegion(ENGLISH, untranslated)).toBe('United States');
  });

  it('prints the host English for a language the host sent no key for', () => {
    const bare = language({ nameKey: undefined, regionKey: undefined });
    expect(languageName(bare, nb)).toBe('English');
    expect(languageRegion(bare, nb)).toBe('United States');
  });

  it('leaves out the region while the name tells it apart on its own', () => {
    expect(labelOf(ENGLISH, [ENGLISH, SPANISH], nb)).toBe('Engelsk');
    expect(labelOf(SPANISH, [ENGLISH, SPANISH], nb)).toBe('Spansk');
  });

  it('appends the region to both entries that share a translated name', () => {
    const pool = [ENGLISH, BRITISH, SPANISH];
    expect(labelOf(ENGLISH, pool, nb)).toBe('Engelsk (USA)');
    expect(labelOf(BRITISH, pool, nb)).toBe('Engelsk (Storbritannia)');
    expect(labelOf(SPANISH, pool, nb)).toBe('Spansk');
  });

  it('names an entry that carries no region by its name alone', () => {
    const bare = language({ id: 'eo', name: 'Esperanto', nameKey: undefined, region: '', regionKey: undefined });
    const twin = language({ id: 'eo-XX', name: 'Esperanto', nameKey: undefined, region: '', regionKey: undefined });
    expect(labelOf(bare, [bare, twin], nb)).toBe('Esperanto');
  });
});

/**
 * The catalogue chooses these key names off a language's tag, so they reach the
 * bundle through a variable and no scrape can find them. The list is the tags
 * the catalogue carries today, and a tag added there needs a line here.
 */
describe('the shipped catalogue names', () => {
  const bundle = mergedEnglishBundle();
  const tags = ['en-US', 'es-ES', 'de-DE', 'nb-NO', 'ja-JP'];

  it.each(tags)('resolves a name and a region for %s', (tag) => {
    expect(resolves(bundle, 'Common', `proofing.language.name.${tag}`)).toBe(true);
    expect(resolves(bundle, 'Common', `proofing.language.region.${tag}`)).toBe(true);
  });
});
