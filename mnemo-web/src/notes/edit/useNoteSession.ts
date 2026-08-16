/**
 * The React seam over `createNoteSession`, mirroring `useEditorView`.
 *
 * The session is created in an effect and closed in cleanup, so unmount, note
 * switch and StrictMode's deliberate double-invoke all release it through the
 * same path, and closing *saves first*, which is what keeps navigating away
 * from being the way to lose the last few seconds of typing.
 *
 * `noteId` is the only dependency. Everything else is read from a ref at mount
 * time: a new `state` object arriving on a re-render must not tear the editor
 * down and rebuild it under the caret.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { EditorView } from 'prosemirror-view';
import { onShutdown } from '@/app/shutdown';
import type { SaveState } from '../authority/authority';
import { closeNoteAssetSession, openNoteAssetSession } from '../assets/api';
import { createNoteSession, type NoteSession, type NoteSessionOptions } from './session';

export type UseNoteSessionOptions = Omit<NoteSessionOptions, 'mount'>;

export interface UseNoteSessionResult {
  /** Attach to the element the editor should mount into. */
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly saveState: SaveState;
  /** The live view, once mounted, for chrome that reads geometry and dispatches. Null before mount and after teardown. */
  readonly view: EditorView | null;
  /**
   * Writes the note now, whatever autosave is doing.
   *
   * Stable across renders and safe to call at any time: before the session
   * exists, after it is gone, twice in a row, or while a save is already in
   * flight. The outcome is not returned because it is already visible, the
   * authority moves `saveState` through `saving` to `saved` or `save_failed`
   * and every reader of it sees the same answer.
   */
  readonly save: () => void;
}

export function useNoteSession(options: UseNoteSessionOptions): UseNoteSessionResult {
  const ref = useRef<HTMLDivElement | null>(null);
  // Only the save state, not the whole snapshot: this is set on every
  // notification, and a snapshot object is new every time, so subscribing to it
  // would re-render the note on every keystroke. The state is a string that
  // usually does not change, and React drops a set to an equal value.
  const [saveState, setSaveState] = useState<SaveState>('loading');
  // The mounted view, surfaced so gutter chrome can read block geometry and
  // dispatch. Held in state so a consumer re-renders once it exists; cleared on
  // teardown so the chrome unmounts with the view rather than reading a dead one.
  const [view, setView] = useState<EditorView | null>(null);

  const latest = useRef(options);
  latest.current = options;

  // Held in a ref rather than state so `save` can be a stable callback: it is
  // handed to a keyboard listener that must not be torn down and reinstalled on
  // every render of the surface.
  const sessionRef = useRef<NoteSession | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const session = createNoteSession({ mount: element, ...latest.current });
    sessionRef.current = session;
    setView(session.view);
    setSaveState(session.authority.snapshot().saveState);
    const unsubscribe = session.subscribe((snapshot) => {
      setSaveState(snapshot.saveState);
    });
    // Closing the window is the one exit that unmounts nothing, so cleanup never
    // runs and the debounce never fires. The host holds the close open for this.
    const unregister = onShutdown(() => session.flush());

    // While this session is open its undo history can resurrect image uploads no saved
    // note references, so the host's asset sweep stands down until it hears the close.
    // Registration failing is survivable: the sweep's grace window still protects fresh
    // uploads, and a session the host never heard of cannot block cleanup forever.
    let assetSession: string | null = null;
    let closed = false;
    openNoteAssetSession().then(
      (sessionId) => {
        if (closed) void closeNoteAssetSession(sessionId).catch(() => {});
        else assetSession = sessionId;
      },
      () => {},
    );

    return () => {
      unregister();
      unsubscribe();
      setView(null);
      // Cleared before the close so a save arriving during teardown joins that
      // close rather than starting a write against a session on its way out.
      if (sessionRef.current === session) sessionRef.current = null;
      closed = true;
      // Not awaited, because a React cleanup cannot wait. The session keeps
      // itself alive until the final save settles; what is released here is
      // this component's interest in it. The asset session closes only after
      // that final save, so the sweep it triggers reads the saved references.
      void session
        .close()
        .catch(() => undefined)
        .then(() => {
          if (assetSession) return closeNoteAssetSession(assetSession);
        })
        .catch(() => {});
    };
  }, [options.noteId]);

  // Rejection is swallowed rather than reported: `flush` resolves with the
  // outcome instead of throwing, so anything that lands here is the session
  // being destroyed mid-write, which the teardown path has already handled.
  const save = useCallback(() => {
    void sessionRef.current?.flush().catch(() => undefined);
  }, []);

  return { ref, saveState, view, save };
}
