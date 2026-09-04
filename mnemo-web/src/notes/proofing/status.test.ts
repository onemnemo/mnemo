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

import { effectiveLanguages, readyLanguages } from './status';
import type { NoteProofing, ProofingLanguage, ProofingStatus } from './types';

function language(id: string, state: ProofingLanguage['state']): ProofingLanguage {
  return {
    id,
    name: id,
    region: '',
    installed: state !== 'absent',
    bundled: state !== 'absent',
    state,
    license: { name: 'SCOWL', url: 'https://example.com' },
  };
}

function statusOf(active: string[], note?: NoteProofing): ProofingStatus {
  return {
    enabled: true,
    active,
    languages: [language('en-US', 'ready'), language('es-ES', 'loading'), language('de-DE', 'absent')],
    personalWordCount: 0,
    note,
  };
}

describe('the effective set', () => {
  it('is the global active set when the note says nothing', () => {
    expect(effectiveLanguages(statusOf(['en-US', 'es-ES']))).toEqual(['en-US', 'es-ES']);
  });

  it("is the note's own answer whenever it has one, empty included", () => {
    const note: NoteProofing = { mode: 'off', languages: [], effective: [] };
    expect(effectiveLanguages(statusOf(['en-US'], note))).toEqual([]);
  });

  it('is empty before the status arrives', () => {
    expect(effectiveLanguages(undefined)).toEqual([]);
  });
});

describe('the ready set', () => {
  it('keeps the chosen order rather than the catalogue order', () => {
    const status: ProofingStatus = {
      ...statusOf(['es-ES', 'en-US']),
      languages: [language('en-US', 'ready'), language('es-ES', 'ready')],
    };
    expect(readyLanguages(status)).toEqual(['es-ES', 'en-US']);
  });

  it('leaves out a dictionary that is still being read', () => {
    expect(readyLanguages(statusOf(['en-US', 'es-ES']))).toEqual(['en-US']);
  });

  it('leaves out a language the catalogue does not know at all', () => {
    expect(readyLanguages(statusOf(['en-US', 'fr-FR']))).toEqual(['en-US']);
  });
});
