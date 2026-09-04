/**
 * The card builds its own DOM and translates through `translate(key)`, a local
 * helper pinned to the NotesEditor namespace. Nothing connects that helper's
 * argument to whether the key exists, so a card shipped without its strings
 * renders `ProofingAddToDictionary` as a button label. This enumerates every
 * key the file can ask for and pins it against the real bundle.
 */

import { describe, expect, it } from 'vitest';

import { mergedEnglishBundle, readRepoText, resolves } from '@/i18n/test-bundle';

const SOURCE = readRepoText('mnemo-web', 'src', 'notes', 'proofing', 'issue-card.ts');
const SURFACE = readRepoText('mnemo-web', 'src', 'notes', 'workspace', 'NoteSurface.tsx');

/**
 * Every key the card names, by their shared prefix rather than by the call
 * shape: one of them is chosen inside a conditional and a scan of
 * `translate('...')` would miss exactly the one that decides the card's title.
 * A key the host supplies at runtime (`titleKey`, `messageKey`) cannot be
 * enumerated here and is the host's own coverage.
 */
function keysIn(source: string): string[] {
  return [...new Set([...source.matchAll(/'(Proofing[A-Za-z0-9_.]*)'/g)].map((match) => match[1]))];
}

/** The one in-editor proofing string that is not the card's: the paused notice. */
function surfaceKeys(source: string): string[] {
  return [...source.matchAll(/t\('NotesEditor', '([A-Za-z0-9_.]+)'\)/g)].map((match) => match[1]);
}

describe('the suggestion card translations', () => {
  const bundle = mergedEnglishBundle();
  const keys = [...keysIn(SOURCE), ...surfaceKeys(SURFACE)];

  it('resolves the one shared string it borrows', () => {
    // The card's Close control is the neutral place a keyboard open parks
    // focus, so it is on the path every keyboard user takes.
    expect(SOURCE).toMatch(/common\('Close'\)/);
    expect(resolves(bundle, 'Common', 'Close')).toBe(true);
  });

  it('reads its strings from the NotesEditor namespace', () => {
    expect(SOURCE).toMatch(/createTranslate\(useI18nStore\.getState\(\)\.bundle\)\('NotesEditor', key\)/);
  });

  it('finds every key the card can render', () => {
    // A parsing regression matching nothing would make the case below pass
    // without checking a single key.
    expect(keys.length).toBeGreaterThanOrEqual(8);
    expect(keys).toContain('ProofingPausedNotice');
  });

  it.each([...keysIn(SOURCE), ...surfaceKeys(SURFACE)])('resolves NotesEditor/%s', (key) => {
    expect(resolves(bundle, 'NotesEditor', key), `NotesEditor/${key} is missing from the merged bundle`).toBe(true);
  });
});
