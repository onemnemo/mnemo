/**
 * Proofing, wired to one note's live view.
 *
 * Everything that needs a clock, a network or a DOM event lives here, and it
 * reaches the editor only through `view`. It is handed the view rather than the
 * session or the editor handle on purpose: reading the handle's state drains a
 * chunked mount on the spot, so a hook that could see it would freeze the
 * opening of every large note.
 *
 * A change to the set of languages, a note change or the toggle going off tears
 * the whole arrangement down and clears the marks, rather than trying to
 * reconcile answers about one set against a document being checked against
 * another.
 *
 * A word list changing is not that. The scheduler keeps the answer it was given
 * for every text it has asked about, so a word accepted or dropped in settings
 * would otherwise leave every open note showing the answer from before it, an
 * underline under a word the user has just added among them. The two lists are
 * watched here and the segments naming a changed word are handed back to the
 * scheduler to ask about again.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';

import { useSettingValue } from '@/settings/store';
import type { BlockRegistry } from '../editor/registry/build';
import { installCardTriggers } from './card-triggers';
import { createProofingCard, type ProofingCardHandle } from './issue-card';
import { dispatchProofing, subscribeProofing } from './proofing-plugin';
import { createProofingScheduler, type ProofingSchedule, type ProofingScheduler } from './scheduler';
import {
  effectiveLanguages,
  proofingClient,
  readyLanguages,
  useInvalidateProofingWords,
  useProofingNoteIgnores,
  useProofingPersonalWords,
  useProofingStatus,
} from './status';
import { changedWords } from './words';
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
  /**
   * The note is meant to go unchecked: either the reader asked for that, or
   * nothing is switched on to check it with. The browser's own checker stands
   * down too, so "do not check this note" is not answered by red underlines
   * from a dictionary this app does not own.
   */
  readonly suppressed: boolean;
  /**
   * What this note is written in, as the `lang` the container carries. The first
   * of the note's effective languages, because that is the one whose corrections
   * are offered first. Undefined until the host has answered, or when the note is
   * checked in nothing.
   */
  readonly language?: string;
}

export function useProofing(options: UseProofingOptions): ProofingSurface {
  const { view, registry, noteId } = options;
  const editable = options.editable ?? true;
  const client = options.client ?? proofingClient;
  const invalidate = useInvalidateProofingWords(noteId);

  const { data: status } = useProofingStatus(noteId);
  const enabled = useSettingValue('Proofing.Enabled', true);
  const ready = readyLanguages(status);
  const readyKey = ready.join(',');
  const active = editable && enabled && ready.length > 0;
  // Never before the status arrives: an unanswered note looks the same as one
  // with nothing switched on, and guessing would leave the opening seconds of
  // every note with no checker at all.
  const suppressed =
    status !== undefined && (status.note?.mode === 'off' || effectiveLanguages(status).length === 0);

  // Held in a ref so the effect below does not re-run whenever React Query
  // hands back a new status object with the same languages in it.
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  const [card, setCard] = useState<ProofingCardHandle | null>(null);
  const [paused, setPaused] = useState(false);
  const schedulerRef = useRef<ProofingScheduler | null>(null);

  const schedule = options.schedule;
  // A fresh array every render, so the arrangement below hangs off the contents
  // rather than the identity: otherwise every status poll would tear the
  // scheduler down and re-check the whole note.
  const languages = useMemo(() => (readyKey === '' ? [] : readyKey.split(',')), [readyKey]);
  const languagesRef = useRef<readonly string[]>(languages);
  languagesRef.current = languages;

  useEffect(() => {
    if (!view || !active) return;

    const scheduler = createProofingScheduler({
      view,
      registry,
      noteId,
      languages,
      client,
      schedule,
    });
    schedulerRef.current = scheduler;
    const handle = createProofingCard({
      view,
      client,
      noteId,
      languages: () => languagesRef.current,
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
      schedulerRef.current = null;
      scheduler.destroy();
      handle.destroy();
      setCard(null);
      setPaused(false);
      if (!view.isDestroyed) dispatchProofing(view, { type: 'clear' });
    };
  }, [view, registry, noteId, languages, active, client, schedule]);

  // Only while marks are live. A note nothing is checking has no answers on file
  // to go stale, so fetching the lists for it would be a request per open note
  // for a refresh that could never do anything.
  const personal = useProofingPersonalWords(active).data?.words;
  const ignored = useProofingNoteIgnores(active ? noteId : undefined).data?.words;
  const personalWords = useMemo(() => personal?.map((entry) => entry.word), [personal]);
  useWordListRefresh(schedulerRef, personalWords);
  useWordListRefresh(schedulerRef, ignored);

  // The triggers live on the document rather than in the plugin stack, because
  // opening the card needs the network and the plugin is not allowed to.
  useEffect(() => {
    if (!view || !card) return;
    return installCardTriggers(view, {
      isOpen: () => card.isOpen(),
      open: (hit) => card.openFor(hit.located, hit.rect, hit.trigger),
    });
  }, [view, card]);

  const language = effectiveLanguages(status)[0];

  return useMemo(
    () => ({ active, paused: active && paused, suppressed, language }),
    [active, paused, suppressed, language],
  );
}

/**
 * Hands the scheduler the words a list gained or lost since the last render.
 *
 * The first list to arrive is not a change: a scheduler built moments ago has
 * asked about nothing, so telling it to forget would be work with no answer to
 * replace.
 */
function useWordListRefresh(
  scheduler: { current: ProofingScheduler | null },
  words: readonly string[] | undefined,
): void {
  const seen = useRef<readonly string[] | null>(null);

  useEffect(() => {
    if (!words) return;
    const before = seen.current;
    seen.current = words;
    if (before) scheduler.current?.forgetWords(changedWords(before, words));
  }, [scheduler, words]);
}
