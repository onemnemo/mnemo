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

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { onShutdown } from '@/app/shutdown';
import type { SaveState } from '../authority/authority';
import { createNoteSession, type NoteSessionOptions } from './session';

export type UseNoteSessionOptions = Omit<NoteSessionOptions, 'mount'>;

export interface UseNoteSessionResult {
  /** Attach to the element the editor should mount into. */
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly saveState: SaveState;
}

export function useNoteSession(options: UseNoteSessionOptions): UseNoteSessionResult {
  const ref = useRef<HTMLDivElement | null>(null);
  // Only the save state, not the whole snapshot: this is set on every
  // notification, and a snapshot object is new every time, so subscribing to it
  // would re-render the note on every keystroke. The state is a string that
  // usually does not change, and React drops a set to an equal value.
  const [saveState, setSaveState] = useState<SaveState>('loading');

  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const session = createNoteSession({ mount: element, ...latest.current });
    setSaveState(session.authority.snapshot().saveState);
    const unsubscribe = session.subscribe((snapshot) => {
      setSaveState(snapshot.saveState);
    });
    // Closing the window is the one exit that unmounts nothing, so cleanup never
    // runs and the debounce never fires. The host holds the close open for this.
    const unregister = onShutdown(() => session.flush());

    return () => {
      unregister();
      unsubscribe();
      // Not awaited, because a React cleanup cannot wait. The session keeps
      // itself alive until the final save settles; what is released here is
      // this component's interest in it.
      void session.close();
    };
  }, [options.noteId]);

  return { ref, saveState };
}
