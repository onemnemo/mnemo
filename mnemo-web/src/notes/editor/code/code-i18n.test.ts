/**
 * The code block's strings, pinned against the real bundle.
 *
 * `translate` returns a miss as the bare key, so a typo here does not fail a
 * build, it ships a button labelled `CodeShowLess`. The C# bundle tests already
 * guard that every other language carries every key English does, so pinning
 * English pins all five.
 */
import { describe, expect, it } from 'vitest';

import { mergedEnglishBundle, resolves } from '@/i18n/test-bundle';

const CODE_KEYS = [
  'CodeLanguage',
  'CodeLanguageSearch',
  'CodeCopy',
  'CodeOptions',
  'CodeCaption',
  'CodeCaptionPlaceholder',
  'CodeWrap',
  'CodeLineNumbers',
  'CodeShowAll',
  'CodeShowLess',
] as const;

describe('code block translations', () => {
  const bundle = mergedEnglishBundle();

  it.each(CODE_KEYS)('resolves NotesEditor/%s', (key) => {
    expect(resolves(bundle, 'NotesEditor', key), `NotesEditor/${key} is missing`).toBe(true);
  });

  it('keeps the line count placeholder in the fold label', () => {
    expect(bundle.NotesEditor?.CodeShowAll ?? '').toContain('{0}');
  });
});
