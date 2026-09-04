import { describe, expect, it } from 'vitest';

import type { NoteProofingChoice, ProofingLanguage, ProofingStatus } from '../proofing/types';

import {
  activeLanguagesLabel,
  effectiveLanguageIds,
  installedLanguages,
  languageLabel,
  languageSummary,
  noteLanguageChoice,
  noteLanguageIds,
  noteLanguageState,
  storedChoice,
  type NoteLanguageState,
} from './note-language-menu';

const COPY = { off: 'off', none: 'none' };

function language(id: string, name: string, region: string, installed = true): ProofingLanguage {
  return {
    id,
    name,
    region,
    installed,
    bundled: installed,
    state: installed ? 'ready' : 'absent',
    license: { name: 'MIT', url: 'https://example.invalid' },
  };
}

const ENGLISH = language('en-US', 'English', 'United States');
const SPANISH = language('es-ES', 'Spanish', 'Spain');
const BRITISH = language('en-GB', 'English', 'United Kingdom');
const BRITISH_ABSENT = language('en-GB', 'English', 'United Kingdom', false);
const NORWEGIAN = language('nb-NO', 'Norwegian', 'Norway', false);

const CATALOGUE = [ENGLISH, SPANISH, NORWEGIAN];

function state(
  choice: NoteProofingChoice,
  active: readonly string[] = ['en-US'],
  catalogue: readonly ProofingLanguage[] = CATALOGUE,
): NoteLanguageState {
  return { choice, active, catalogue };
}

describe('the state the menu draws', () => {
  it('reads a note with no override as following the defaults', () => {
    expect(storedChoice(undefined)).toEqual({ mode: 'default' });
    expect(storedChoice({ mode: 'default', languages: [], effective: ['en-US'] })).toEqual({
      mode: 'default',
    });
  });

  it("carries a note's own list through", () => {
    expect(storedChoice({ mode: 'custom', languages: ['es-ES'], effective: ['es-ES'] })).toEqual({
      mode: 'custom',
      languages: ['es-ES'],
    });
  });

  it('takes the choice the menu is holding over the stored one', () => {
    const status: ProofingStatus = {
      enabled: true,
      active: ['en-US'],
      languages: CATALOGUE,
      personalWordCount: 0,
      note: { mode: 'default', languages: [], effective: ['en-US'] },
    };
    expect(noteLanguageState(status).choice).toEqual({ mode: 'default' });
    expect(noteLanguageState(status, { mode: 'off' }).choice).toEqual({ mode: 'off' });
  });

  it('has nothing to offer before the status arrives', () => {
    const empty = noteLanguageState(undefined);
    expect(installedLanguages(empty)).toEqual([]);
    expect(empty.active).toEqual([]);
    expect(empty.choice).toEqual({ mode: 'default' });
  });
});

describe('the languages the menu offers', () => {
  it('lists what is installed and leaves out what is not', () => {
    expect(installedLanguages(state({ mode: 'default' })).map((entry) => entry.id)).toEqual([
      'en-US',
      'es-ES',
    ]);
  });
});

describe('naming a language', () => {
  it('leaves the region off when the name is already unambiguous', () => {
    expect(languageLabel('en-US', [ENGLISH, SPANISH])).toBe('English');
  });

  it('adds the region once a second entry shares the name', () => {
    expect(languageLabel('en-US', [ENGLISH, BRITISH])).toBe('English (United States)');
    expect(languageLabel('en-GB', [ENGLISH, BRITISH])).toBe('English (United Kingdom)');
  });

  it('counts a twin the catalogue carries but has not installed', () => {
    expect(languageLabel('en-US', [ENGLISH, BRITISH_ABSENT])).toBe('English (United States)');
  });

  it('falls back to the id for a language the catalogue does not carry', () => {
    expect(languageLabel('fr-FR', [ENGLISH, SPANISH])).toBe('fr-FR');
  });
});

describe('which rows are ticked', () => {
  it('follows the global set while the note is on the defaults', () => {
    expect(noteLanguageIds(state({ mode: 'default' }, ['en-US', 'es-ES']))).toEqual([
      'en-US',
      'es-ES',
    ]);
  });

  it("follows the note's own list once it has one", () => {
    expect(noteLanguageIds(state({ mode: 'custom', languages: ['es-ES'] }))).toEqual(['es-ES']);
  });

  it('ticks nothing on a note that is not checked', () => {
    expect(noteLanguageIds(state({ mode: 'off' }))).toEqual([]);
  });
});

describe('what a note is really checked in', () => {
  it('drops a stored language that is no longer installed', () => {
    expect(effectiveLanguageIds(state({ mode: 'custom', languages: ['es-ES', 'nb-NO'] }))).toEqual([
      'es-ES',
    ]);
  });

  it('is nothing at all for a note that is not checked', () => {
    expect(effectiveLanguageIds(state({ mode: 'off' }))).toEqual([]);
  });
});

describe('what a tick writes', () => {
  it('copies the global set before adding to it, so the first language is not lost', () => {
    expect(noteLanguageChoice(state({ mode: 'default' }), 'es-ES')).toEqual({
      mode: 'custom',
      languages: ['en-US', 'es-ES'],
    });
  });

  it('copies the global set before removing from it', () => {
    expect(noteLanguageChoice(state({ mode: 'default' }, ['en-US', 'es-ES']), 'en-US')).toEqual({
      mode: 'custom',
      languages: ['es-ES'],
    });
  });

  it("adds to the note's own list rather than to the global one", () => {
    expect(noteLanguageChoice(state({ mode: 'custom', languages: ['es-ES'] }), 'en-US')).toEqual({
      mode: 'custom',
      languages: ['es-ES', 'en-US'],
    });
  });

  it('composes on the tick before it rather than on the global set', () => {
    const first = noteLanguageChoice(state({ mode: 'default' }), 'es-ES');
    expect(noteLanguageChoice(state(first), 'en-US')).toEqual({
      mode: 'custom',
      languages: ['es-ES'],
    });
  });

  it('writes off rather than an empty list when the last language goes', () => {
    expect(noteLanguageChoice(state({ mode: 'custom', languages: ['es-ES'] }), 'es-ES')).toEqual({
      mode: 'off',
    });
  });

  it('starts an unchecked note from the global set again', () => {
    expect(noteLanguageChoice(state({ mode: 'off' }), 'es-ES')).toEqual({
      mode: 'custom',
      languages: ['en-US', 'es-ES'],
    });
  });

  it('never lists a language twice', () => {
    expect(noteLanguageChoice(state({ mode: 'default' }, ['en-US', 'en-US']), 'es-ES')).toEqual({
      mode: 'custom',
      languages: ['en-US', 'es-ES'],
    });
  });
});

describe('the summary on the submenu row', () => {
  it('says the note is not checked when nobody wants it checked', () => {
    expect(languageSummary(state({ mode: 'off' }), COPY)).toBe('off');
  });

  it('says none installed when nothing is there to check with', () => {
    expect(languageSummary(state({ mode: 'default' }, [], [NORWEGIAN]), COPY)).toBe('none');
  });

  it("says none installed when the note's own languages have all gone away", () => {
    expect(languageSummary(state({ mode: 'custom', languages: ['nb-NO'] }), COPY)).toBe('none');
  });

  it('names what the note is checked in, in order', () => {
    expect(languageSummary(state({ mode: 'custom', languages: ['es-ES', 'en-US'] }), COPY)).toBe(
      'Spanish, English',
    );
  });
});

describe('the defaults spelled out', () => {
  it('names the global set', () => {
    expect(activeLanguagesLabel(state({ mode: 'default' }, ['en-US', 'es-ES']), 'empty')).toBe(
      'English, Spanish',
    );
  });

  it('says so when nothing is switched on', () => {
    expect(activeLanguagesLabel(state({ mode: 'default' }, []), 'empty')).toBe('empty');
  });
});
