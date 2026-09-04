/**
 * The proofing status, shared by the editor and the settings page.
 *
 * The effective language is the host's answer, not a setting the client reads
 * back: it is resolved from the stored preference, the older spellcheck
 * setting and what is actually installed, and only the host can see all three.
 * So every surface reads `status.language`, and a write goes through the
 * generic settings PUT followed by an invalidation of this key.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { createProofingClient, type ProofingClient } from './client';
import type { ProofingStatus } from './types';

export const PROOFING_STATUS_KEY = ['proofing', 'status'] as const;
export const PROOFING_PERSONAL_KEY = ['proofing', 'personal'] as const;

/** The app's one client. Tests build their own rather than reaching for this. */
export const proofingClient: ProofingClient = createProofingClient();

export function useProofingStatus() {
  return useQuery({
    queryKey: PROOFING_STATUS_KEY,
    queryFn: ({ signal }) => proofingClient.status(signal),
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
 * The language the editor should check in, or null when nothing is ready.
 *
 * Says nothing about whether the user wants checking: that is the stored
 * `Proofing.Enabled` toggle, which the editor reads live so turning it off
 * takes effect on the keystroke rather than on the next status fetch.
 */
export function readyLanguage(status: ProofingStatus | undefined): string | null {
  if (!status) return null;
  const entry = status.languages.find((language) => language.id === status.language);
  return entry?.state === 'ready' ? status.language : null;
}

export function useInvalidateProofing(): () => void {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: PROOFING_STATUS_KEY });
    void client.invalidateQueries({ queryKey: PROOFING_PERSONAL_KEY });
  };
}
