/**
 * Proofing, wired to one note's live view.
 *
 * Everything that needs a clock, a network or a DOM event lives here, and it
 * reaches the editor only through `view`. It is handed the view rather than the
 * session or the editor handle on purpose: reading the handle's state drains a
 * chunked mount on the spot, so a hook that could see it would freeze the
 * opening of every large note.
 *
 * A language change, a note change or the toggle going off tears the whole
 * arrangement down and clears the marks, rather than trying to reconcile
 * answers about one language against a document being checked in another.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';

import { useSettingValue } from '@/settings/store';
import type { BlockRegistry } from '../editor/registry/build';
import { installCardTriggers } from './card-triggers';
import { createProofingCard, type ProofingCardHandle } from './issue-card';
import { dispatchProofing, subscribeProofing } from './proofing-plugin';
import { createProofingScheduler, type ProofingSchedule } from './scheduler';
import { proofingClient, readyLanguage, useInvalidateProofing, useProofingStatus } from './status';
import type { ProofingClient } from './client';

export interface UseProofingOptions {
  readonly view: EditorView | null;
  readonly registry: BlockRegistry;
  readonly noteId: string;
  /** Read-only surfaces pass false and get nothing, marks included. */
  readonly editable?: boolean;
  /** Injected by tests; the app takes the defaults. */
  readonly client?: ProofingClient;
  readonly schedule?: ProofingSchedule;
}

export interface ProofingSurface {
  /** True while marks are live, which is also when the browser's own checker stands down. */
  readonly active: boolean;
  /** The note holds as many marks as one note may, so nothing more is checked. */
  readonly paused: boolean;
}

export function useProofing(options: UseProofingOptions): ProofingSurface {
  const { view, registry, noteId } = options;
  const editable = options.editable ?? true;
  const client = options.client ?? proofingClient;
  const invalidate = useInvalidateProofing();

  const { data: status } = useProofingStatus();
  const enabled = useSettingValue('Proofing.Enabled', true);
  const language = readyLanguage(status);
  const active = editable && enabled && language !== null;

  // Held in a ref so the effect below does not re-run whenever React Query
  // hands back a new status object with the same language in it.
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  const [card, setCard] = useState<ProofingCardHandle | null>(null);
  const [paused, setPaused] = useState(false);

  const schedule = options.schedule;
  const languageRef = useRef<string | null>(language);
  languageRef.current = language;

  useEffect(() => {
    if (!view || !active || language === null) return;

    const scheduler = createProofingScheduler({
      view,
      registry,
      noteId,
      language,
      client,
      schedule,
    });
    const handle = createProofingCard({
      view,
      client,
      noteId,
      language: () => languageRef.current ?? language,
      onWordResolved: () => invalidateRef.current(),
    });
    setCard(handle);
    setPaused(false);

    const unsubscribe = subscribeProofing(view, (state, docChanged) => {
      setPaused(state.paused);
      if (docChanged) scheduler.noteEdit();
    });
    scheduler.start();

    return () => {
      unsubscribe();
      scheduler.destroy();
      handle.destroy();
      setCard(null);
      setPaused(false);
      if (!view.isDestroyed) dispatchProofing(view, { type: 'clear' });
    };
  }, [view, registry, noteId, language, active, client, schedule]);

  // The triggers live on the document rather than in the plugin stack, because
  // opening the card needs the network and the plugin is not allowed to.
  useEffect(() => {
    if (!view || !card) return;
    return installCardTriggers(view, {
      isOpen: () => card.isOpen(),
      open: (hit) => card.openFor(hit.located, hit.rect, hit.trigger),
    });
  }, [view, card]);

  return useMemo(() => ({ active, paused: active && paused }), [active, paused]);
}
