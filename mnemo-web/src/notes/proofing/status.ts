/**
 * The proofing status, shared by the editor and the settings page.
 *
 * The active set is the host's answer, not a setting the client reads back: it
 * is resolved from the stored preference, the older spellcheck setting and what
 * is actually installed, and only the host can see all three. So every surface
 * reads `status.active`, and a write goes through the generic settings PUT
 * followed by an invalidation of this key.
 *
 * A note may override the set, so the status is asked per note and cached under
 * a key that carries the note id. The invalidation is deliberately the shared
 * prefix: the settings page and every open note hold their own entry, and a
 * change to the global set moves all of them.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createProofingClient, type ProofingClient } from './client';
import type { NoteIgnores, PersonalWords, ProofingStatus } from './types';

export const PROOFING_STATUS_KEY = ['proofing', 'status'] as const;
export const PROOFING_PERSONAL_KEY = ['proofing', 'personal'] as const;
export const PROOFING_IGNORES_KEY = ['proofing', 'ignores'] as const;

/** The app's one client. Tests build their own rather than reaching for this. */
export const proofingClient: ProofingClient = createProofingClient();

const NO_LANGUAGES: readonly string[] = [];

export function useProofingStatus(noteId?: string) {
  return useQuery({
    queryKey: [...PROOFING_STATUS_KEY, noteId ?? 'global'],
    queryFn: ({ signal }) => proofingClient.status(noteId ?? null, signal),
    // A dictionary that is still loading becomes ready without anything the
    // user does, so the editor needs to hear about it without a reload.
    refetchInterval: (query) =>
      query.state.data?.languages.some((language) => language.state === 'loading') ? 2000 : false,
  });
}

export function useProofingPersonalWords(enabled = true) {
  return useQuery({
    queryKey: PROOFING_PERSONAL_KEY,
    queryFn: ({ signal }) => proofingClient.personal(signal),
    enabled,
  });
}

/**
 * What this note is meant to be checked in: its own list when it overrides the
 * defaults, and the global active set otherwise. Unfiltered, so a language that
 * is installed but still being read is still in it.
 */
export function effectiveLanguages(status: ProofingStatus | undefined): readonly string[] {
  if (!status) return NO_LANGUAGES;
  return status.note?.effective ?? status.active;
}

/**
 * The languages the editor can check in right now, in order.
 *
 * Says nothing about whether the user wants checking: that is the stored
 * `Proofing.Enabled` toggle, which the editor reads live so turning it off
 * takes effect on the keystroke rather than on the next status fetch.
 */
export function readyLanguages(status: ProofingStatus | undefined): readonly string[] {
  if (!status) return NO_LANGUAGES;
  const ready = new Set(
    status.languages.filter((language) => language.state === 'ready').map((language) => language.id),
  );
  return effectiveLanguages(status).filter((id) => ready.has(id));
}

/**
 * The words one note accepts that the dictionary does not.
 *
 * Kept per note rather than folded into the status, because it is read by the
 * one surface that manages them and by the editor that has to un-mark a word the
 * moment it is ignored, and neither wants the whole catalogue with it.
 */
export function useProofingNoteIgnores(noteId: string | undefined) {
  return useQuery({
    queryKey: [...PROOFING_IGNORES_KEY, noteId ?? ''],
    queryFn: ({ signal }) => proofingClient.noteIgnores(noteId ?? '', signal),
    enabled: noteId !== undefined && noteId.length > 0,
  });
}

export function useInvalidateProofing(): () => void {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: PROOFING_STATUS_KEY });
    void client.invalidateQueries({ queryKey: PROOFING_PERSONAL_KEY });
  };
}

/**
 * What a caller wants to hear about one write, by the variables it was made with.
 *
 * These ride on the mutation itself rather than on the `mutate` call. A hook's
 * observer follows only its latest call, so options handed to `mutate` are
 * dropped the moment a second write starts, and a list where two rows can be
 * acted on in quick succession would lose the first row's receipt. The mutation
 * keeps its own options and fires them for every write it made.
 */
export interface WriteCallbacks<TData, TVariables> {
  readonly onSuccess?: (data: TData, variables: TVariables) => void;
  readonly onError?: (error: unknown, variables: TVariables) => void;
  readonly onSettled?: (variables: TVariables) => void;
}

/**
 * The writes to the personal word list.
 *
 * Every host reply carries the whole list as it now stands, so success
 * reconciles PROOFING_PERSONAL_KEY straight from the answer with no follow-up
 * fetch. It deliberately never touches PROOFING_STATUS_KEY: the editor and the
 * language picker read that, and a personal word is not a language change. A
 * failure rereads the word list alone to settle the cache back to the host's
 * truth.
 *
 * Silent, because the caller says what went wrong. The host refuses a word the
 * checker could never ask about and a list that is full by name, and the app's
 * blanket "that change could not be saved" on top of that answer is the less
 * useful of the two.
 */
function usePersonalWordWrite<V>(
  run: (vars: V) => Promise<PersonalWords>,
  on: WriteCallbacks<PersonalWords, V> = {},
) {
  const client = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: run,
    onSuccess: (words, vars) => {
      client.setQueryData(PROOFING_PERSONAL_KEY, words);
      on.onSuccess?.(words, vars);
    },
    onError: (error, vars) => {
      void client.invalidateQueries({ queryKey: PROOFING_PERSONAL_KEY });
      on.onError?.(error, vars);
    },
    onSettled: (_data, _error, vars) => on.onSettled?.(vars),
  });
}

/**
 * The lists a word write touches, and nothing else.
 *
 * The editor's card writes straight through the client rather than through the
 * mutations below, so this is what settles the caches afterwards. It leaves the
 * status alone on purpose: a word is not a language change.
 */
export function useInvalidateProofingWords(noteId?: string): () => void {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: PROOFING_PERSONAL_KEY });
    if (noteId !== undefined && noteId.length > 0) {
      void client.invalidateQueries({ queryKey: [...PROOFING_IGNORES_KEY, noteId] });
    }
  };
}

export type AddPersonalWordVars = { word: string; language?: string | null };
export type RemovePersonalWordVars = { word: string; language: string | null };
export type RescopePersonalWordVars = { word: string; from: string | null; to: string | null };

export function useAddPersonalWord(on?: WriteCallbacks<PersonalWords, AddPersonalWordVars>) {
  return usePersonalWordWrite<AddPersonalWordVars>(
    ({ word, language }) => proofingClient.addPersonalWord(word, language),
    on,
  );
}

export function useRemovePersonalWord(on?: WriteCallbacks<PersonalWords, RemovePersonalWordVars>) {
  return usePersonalWordWrite<RemovePersonalWordVars>(
    ({ word, language }) => proofingClient.removePersonalWord(word, language),
    on,
  );
}

/**
 * A scope change, as the two calls the host actually offers: add at the new
 * scope, then drop the old. The order is load-bearing. A failure between them
 * leaves the word under both scopes rather than under neither, and the write's
 * own onError reread then settles the list.
 */
export function useRescopePersonalWord(on?: WriteCallbacks<PersonalWords, RescopePersonalWordVars>) {
  return usePersonalWordWrite<RescopePersonalWordVars>(async ({ word, from, to }) => {
    await proofingClient.addPersonalWord(word, to);
    return proofingClient.removePersonalWord(word, from);
  }, on);
}

/**
 * The writes to one note's ignore list, reconciled from the reply the way the
 * personal list is.
 */
function useNoteIgnoreWrite(
  noteId: string,
  run: (word: string) => Promise<NoteIgnores>,
  on: WriteCallbacks<NoteIgnores, string> = {},
) {
  const client = useQueryClient();
  const key = [...PROOFING_IGNORES_KEY, noteId];
  return useMutation({
    meta: { silentError: true },
    mutationFn: run,
    onSuccess: (words, word) => {
      client.setQueryData(key, words);
      on.onSuccess?.(words, word);
    },
    onError: (error, word) => {
      void client.invalidateQueries({ queryKey: key });
      on.onError?.(error, word);
    },
    onSettled: (_data, _error, word) => on.onSettled?.(word),
  });
}

export function useAddNoteIgnore(noteId: string, on?: WriteCallbacks<NoteIgnores, string>) {
  return useNoteIgnoreWrite(noteId, (word) => proofingClient.addNoteIgnore(noteId, word), on);
}

export function useRemoveNoteIgnore(noteId: string, on?: WriteCallbacks<NoteIgnores, string>) {
  return useNoteIgnoreWrite(noteId, (word) => proofingClient.removeNoteIgnore(noteId, word), on);
}
