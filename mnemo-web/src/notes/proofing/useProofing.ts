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
import type { Rect } from '../editor/floating/position';
import { createProofingCard, type ProofingCardHandle } from './issue-card';
import { dispatchProofing, issueAt, subscribeProofingEdits } from './proofing-plugin';
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
}

function markUnder(view: EditorView, target: EventTarget | null): { pos: number; rect: Rect } | null {
  if (!(target instanceof HTMLElement)) return null;
  const mark = target.closest('.proof-mark');
  if (!(mark instanceof HTMLElement)) return null;
  return { pos: view.posAtDOM(mark, 0), rect: mark.getBoundingClientRect() };
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
  const cardRef = useRef<ProofingCardHandle | null>(null);
  cardRef.current = card;

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

    const unsubscribe = subscribeProofingEdits(view, () => scheduler.noteEdit());
    scheduler.start();

    return () => {
      unsubscribe();
      scheduler.destroy();
      handle.destroy();
      setCard(null);
      if (!view.isDestroyed) dispatchProofing(view, { type: 'clear' });
    };
  }, [view, registry, noteId, language, active, client, schedule]);

  // The card opens from the document rather than from the plugin, because it
  // needs the network and the plugin is not allowed to.
  useEffect(() => {
    if (!view || !card) return;

    const open = (event: MouseEvent) => {
      const hit = markUnder(view, event.target);
      if (!hit) return false;
      const issue = issueAt(view.state, hit.pos);
      if (!issue) return false;
      card.openFor(issue, hit.rect);
      return true;
    };

    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      open(event);
    };
    const onContextMenu = (event: MouseEvent) => {
      // Claimed before the editor's own context menu sees it: a right click on
      // a marked word is a question about the word, not about the block.
      if (!open(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    view.dom.addEventListener('click', onClick);
    view.dom.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      view.dom.removeEventListener('click', onClick);
      view.dom.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [view, card]);

  return useMemo(() => ({ active }), [active]);
}
