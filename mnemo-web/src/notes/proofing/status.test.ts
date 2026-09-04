/**
 * Which languages a note is meant to be checked in, and which of them can be
 * used right now.
 *
 * The two answers are deliberately different. The effective set is what the
 * user chose and is what the "not checked at all" decision is read from, so a
 * dictionary still being read must not empty it. The ready set is what the
 * editor may actually send, and it grows as each dictionary finishes.
 */

import { describe, expect, it } from 'vitest';

import { proofingLanguage, proofingStatusOf } from './fixtures';
import { effectiveLanguages, readyLanguages } from './status';
import type { NoteProofing } from './types';

describe('the effective set', () => {
  it('is the global active set when the note says nothing', () => {
    expect(effectiveLanguages(proofingStatusOf(['en-US', 'es-ES']))).toEqual(['en-US', 'es-ES']);
  });

  it("is the note's own answer whenever it has one, empty included", () => {
    const note: NoteProofing = { mode: 'off', languages: [], effective: [] };
    expect(effectiveLanguages(proofingStatusOf(['en-US'], { note }))).toEqual([]);
  });

  it('is empty before the status arrives', () => {
    expect(effectiveLanguages(undefined)).toEqual([]);
  });
});

describe('the ready set', () => {
  it('keeps the chosen order rather than the catalogue order', () => {
    const status = proofingStatusOf(['es-ES', 'en-US'], {
      languages: [proofingLanguage('en-US', 'ready'), proofingLanguage('es-ES', 'ready')],
    });
    expect(readyLanguages(status)).toEqual(['es-ES', 'en-US']);
  });

  it('leaves out a dictionary that is still being read', () => {
    expect(readyLanguages(proofingStatusOf(['en-US', 'es-ES']))).toEqual(['en-US']);
  });

  it('leaves out a language the catalogue does not know at all', () => {
    expect(readyLanguages(proofingStatusOf(['en-US', 'fr-FR']))).toEqual(['en-US']);
  });
});
