/**
 * One editing session: the mounted view, the authority that owns its document,
 * and the autosave that writes it.
 *
 * These three have to be assembled together because they refer to each other in
 * a ring — the authority drives the view through its handle, and the view's
 * dispatch goes back through the authority — and because they have to be torn
 * down in one order: save what is unsaved, *then* destroy the thing holding it.
 * Left to callers, both would be got right most of the time.
 *
 * The ring is closed after construction rather than during it. `mountEditor`
 * builds the view, the view yields the handle, the handle completes the
 * authority, and only then is the view told to dispatch through it. Anything a
 * plugin dispatches while the view is still being constructed therefore applies
 * directly, which is correct: the document is still the one it was loaded with,
 * and there is no revision to count for a change it was born with.
 */

import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import {
  createNoteAuthority,
  type NoteAuthority,
  type NoteSnapshot,
  type Persist,
  type SaveResult,
} from '../authority/authority';
import type { BlockRegistry } from '../editor/registry/build';
import type { EditorServices } from '../editor/registry/types';
import { mountEditor } from '../editor/view/mount';
import { startAutosave, type AutosaveOptions } from '../save/autosave';

export interface NoteSessionOptions {
  /** The element the editor attaches to. */
  readonly mount: HTMLElement;
  readonly noteId: string;
  readonly sid: string;
  /** The stored version these blocks were loaded at. */
  readonly ver: number;
  readonly state: EditorState;
  readonly registry: BlockRegistry;
  readonly persist: Persist;
  readonly services?: Partial<EditorServices>;
  /** Timing overrides; the defaults are the ones the scheduler documents. */
  readonly autosave?: Omit<AutosaveOptions, 'authority' | 'persist'>;
}

export interface NoteSession {
  readonly authority: NoteAuthority;
  readonly view: EditorView;
  subscribe(listener: (snapshot: NoteSnapshot) => void): () => void;
  /** Saves now, waits for it, and releases everything. Idempotent. */
  close(): Promise<SaveResult>;
}

export function createNoteSession(options: NoteSessionOptions): NoteSession {
  const mounted = mountEditor({
    mount: options.mount,
    state: options.state,
    registry: options.registry,
    services: options.services,
    editable: true,
  });

  const authority = createNoteAuthority({
    noteId: options.noteId,
    sid: options.sid,
    ver: options.ver,
    state: options.state,
    handle: mounted.handle,
  });

  mounted.view.setProps({
    dispatchTransaction: (tr) => {
      // Synchronously, and deliberately outside the authority's queue — see
      // `dispatchLocal`. A deferred `updateState` desynchronizes the view from
      // the DOM the browser has already changed.
      authority.dispatchLocal(tr);
    },
  });

  const autosave = startAutosave({ authority, persist: options.persist, ...options.autosave });

  let closing: Promise<SaveResult> | null = null;

  return {
    authority,
    view: mounted.view,
    subscribe: (listener) => authority.subscribe(listener),

    close(): Promise<SaveResult> {
      // A second call joins the first rather than starting a save against an
      // authority the first one is about to destroy. React's StrictMode makes
      // that a real sequence, not a hypothetical one.
      closing ??= (() => {
        // Started before the scheduler is destroyed, since `flush` refuses once
        // it is — and this last write is the entire point of closing.
        const saved = autosave.flush();
        autosave.destroy();
        // The editor leaves the DOM now, not when the network answers. Teardown
        // that waits leaves a live view behind across a note switch, and
        // StrictMode's remount turns that into two views on one mount point.
        // The handle keeps the last document readable so the save in flight can
        // still commit it.
        mounted.destroy();
        return saved.then((result) => {
          authority.destroy();
          return result;
        });
      })();
      return closing;
    },
  };
}
