/**
 * What the note's Language submenu says and what each row writes.
 *
 * Apart from the menu because the interesting part is the arithmetic: which
 * rows are ticked, and what a tick turns into on the wire.
 *
 * Everything reads a choice rather than the status. The menu is allowed to run
 * ahead of what the host has stored, since a second tick lands long before the
 * first write has come back, and composing that tick against the status would
 * compose it against a choice already superseded.
 */

import { labelOf, type NameLookup } from '../proofing/language-names';
import type {
  NoteProofing,
  NoteProofingChoice,
  ProofingLanguage,
  ProofingStatus,
} from '../proofing/types';

const NO_IDS: readonly string[] = [];
const NO_LANGUAGES: readonly ProofingLanguage[] = [];

export interface NoteLanguageState {
  /** What the note is set to, which may be ahead of what the host has stored. */
  readonly choice: NoteProofingChoice;
  /** The global ordered set a note on the defaults follows. */
  readonly active: readonly string[];
  /** The whole catalogue. Names are told apart against all of it, installed or not. */
  readonly catalogue: readonly ProofingLanguage[];
}

export interface LanguageSummaryCopy {
  /** Shown when the note is not checked at all. */
  readonly off: string;
  /** Shown when nothing the note would be checked in is installed. */
  readonly none: string;
}

/** The choice a stored answer amounts to. A note with no entry follows the defaults. */
export function storedChoice(note: NoteProofing | null | undefined): NoteProofingChoice {
  if (note?.mode === 'custom') return { mode: 'custom', languages: note.languages };
  return { mode: note?.mode ?? 'default' };
}

/** What the menu draws, optionally from a choice it is holding ahead of the status. */
export function noteLanguageState(
  status: ProofingStatus | undefined,
  choice?: NoteProofingChoice | null,
): NoteLanguageState {
  return {
    choice: choice ?? storedChoice(status?.note),
    active: status?.active ?? NO_IDS,
    catalogue: status?.languages ?? NO_LANGUAGES,
  };
}

/** The catalogue entries a note can actually be checked in, in catalogue order. */
export function installedLanguages(state: NoteLanguageState): readonly ProofingLanguage[] {
  return state.catalogue.filter((language) => language.installed);
}

/**
 * How a language reads among its peers.
 *
 * Named against the whole catalogue rather than against what is installed, so a
 * name does not quietly grow a region the first time its twin is added, and so
 * this menu and the spelling settings call a language the same thing.
 */
export function languageLabel(
  id: string,
  catalogue: readonly ProofingLanguage[],
  tr: NameLookup,
): string {
  const language = catalogue.find((entry) => entry.id === id);
  return language ? labelOf(language, catalogue, tr) : id;
}

/** The ids ticked for this note: its own list when it has one, the global set otherwise. */
export function noteLanguageIds(state: NoteLanguageState): readonly string[] {
  const { choice } = state;
  if (choice.mode === 'off') return NO_IDS;
  if (choice.mode === 'custom') return choice.languages ?? NO_IDS;
  return state.active;
}

/** What the note is really checked in: its languages, less any that are not installed. */
export function effectiveLanguageIds(state: NoteLanguageState): readonly string[] {
  const installed = new Set(installedLanguages(state).map((language) => language.id));
  return noteLanguageIds(state).filter((id) => installed.has(id));
}

/**
 * What ticking or unticking one language writes.
 *
 * A note still on the defaults takes a copy of the global set before the tick
 * lands, so switching a second language on pins the first rather than silently
 * narrowing the note to one. Emptying the list writes "off" instead: a custom
 * list with nothing in it is the same state under a name that would leave every
 * row in the menu unticked.
 */
export function noteLanguageChoice(state: NoteLanguageState, id: string): NoteProofingChoice {
  const { choice } = state;
  const on = noteLanguageIds(state).includes(id);
  const base = choice.mode === 'custom' ? (choice.languages ?? NO_IDS) : state.active;
  const next = on ? base.filter((entry) => entry !== id) : [...new Set([...base, id])];
  return next.length > 0 ? { mode: 'custom', languages: next } : { mode: 'off' };
}

/** What this note is checked in, for the submenu row itself. */
export function languageSummary(
  state: NoteLanguageState,
  copy: LanguageSummaryCopy,
  tr: NameLookup,
): string {
  if (state.choice.mode === 'off') return copy.off;
  const effective = effectiveLanguageIds(state);
  if (effective.length === 0) return copy.none;
  return joinNames(effective, state.catalogue, tr);
}

/** The global set spelled out, for the row that follows it. */
export function activeLanguagesLabel(
  state: NoteLanguageState,
  empty: string,
  tr: NameLookup,
): string {
  if (state.active.length === 0) return empty;
  return joinNames(state.active, state.catalogue, tr);
}

function joinNames(
  ids: readonly string[],
  catalogue: readonly ProofingLanguage[],
  tr: NameLookup,
): string {
  return ids.map((id) => languageLabel(id, catalogue, tr)).join(', ');
}
