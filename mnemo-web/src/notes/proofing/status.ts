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

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { createProofingClient, type ProofingClient } from './client';
import type { ProofingStatus } from './types';

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
