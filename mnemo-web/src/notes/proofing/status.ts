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
import type { PersonalWords, ProofingStatus } from './types';

export const PROOFING_STATUS_KEY = ['proofing', 'status'] as const;
export const PROOFING_PERSONAL_KEY = ['proofing', 'personal'] as const;

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

export function useInvalidateProofing(): () => void {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: PROOFING_STATUS_KEY });
    void client.invalidateQueries({ queryKey: PROOFING_PERSONAL_KEY });
  };
}

/**
 * The writes to the personal word list.
 *
 * Every host reply carries the whole list as it now stands, so success
 * reconciles PROOFING_PERSONAL_KEY straight from the answer with no follow-up
 * fetch. It deliberately never touches PROOFING_STATUS_KEY: the editor and the
 * language picker read that, and a personal word is not a language change, so
 * the old code's full status refetch on every add was pure waste. A failure
 * rereads the word list alone to settle the cache back to the host's truth.
 */
function usePersonalWordWrite<V>(run: (vars: V) => Promise<PersonalWords>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (words) => client.setQueryData(PROOFING_PERSONAL_KEY, words),
    onError: () => {
      void client.invalidateQueries({ queryKey: PROOFING_PERSONAL_KEY });
    },
  });
}

export function useAddPersonalWord() {
  return usePersonalWordWrite<{ word: string; language?: string | null }>(({ word, language }) =>
    proofingClient.addPersonalWord(word, language),
  );
}

export function useRemovePersonalWord() {
  return usePersonalWordWrite<{ word: string; language: string | null }>(({ word, language }) =>
    proofingClient.removePersonalWord(word, language),
  );
}

/**
 * A scope change, as the two calls the host actually offers: add at the new
 * scope, then drop the old. The order is load-bearing. A failure between them
 * leaves the word under both scopes rather than under neither, and the write's
 * own onError reread then settles the list.
 */
export function useRescopePersonalWord() {
  return usePersonalWordWrite<{ word: string; from: string | null; to: string | null }>(
    async ({ word, from, to }) => {
      await proofingClient.addPersonalWord(word, to);
      return proofingClient.removePersonalWord(word, from);
    },
  );
}
