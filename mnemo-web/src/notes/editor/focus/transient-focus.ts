/**
 * The focus state machine: the contract every piece of transient editor UI
 * (the equation popover today, the formatting toolbar and the slash menu
 * next) uses to leave the document exactly as it found it.
 *
 * Opening a popover, a toolbar or a menu moves DOM focus off the ProseMirror
 * view. ProseMirror keeps `state.selection` untouched while unfocused, so in the
 * common case a plain `view.focus()` already shows the right thing again, which
 * is why the equation popover has gotten away with refocusing and nothing else.
 * That is an invariant of "nothing else touches selection while this is open",
 * not a guarantee, and a toolbar or slash menu that filters, previews or
 * navigates its own state while open is exactly the kind of thing that can
 * violate it. This module makes the restoration explicit and correct either
 * way, instead of relying on that invariant holding forever.
 *
 * A scope has exactly one resolution, matching how every piece of transient UI
 * already models its own close: an action taken *through* the UI (commit,
 * arrow-escape, a toolbar click that already leaves the selection somewhere
 * sensible) calls `release()`, standing down without touching the selection a
 * second time. Anything that abandons the UI without such an action (Escape,
 * clicking away) calls `restore()`, putting the selection and focus back to
 * what they were when the scope opened. Calling either after the first is a
 * no-op, so a stray event arriving after the transient UI has already closed
 * can never resolve the same scope twice.
 */

import { Selection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export interface TransientFocusScope {
  /**
   * The transient UI's own action already left the selection somewhere correct
   * (or moved focus on purpose); stand down without restoring anything.
   */
  release(): void;
  /** Put the selection and focus back to what they were when this scope opened. */
  restore(): void;
}

/** Minimal surface this module needs, so it can be unit-tested without a live EditorView. */
export interface FocusableEditor {
  readonly state: EditorView['state'];
  dispatch: EditorView['dispatch'];
  focus: EditorView['focus'];
}

/**
 * Captures the current selection and returns a scope that can put it back.
 * Call this the moment transient UI takes focus away from the editor.
 */
export function openTransientFocus(view: FocusableEditor): TransientFocusScope {
  const snapshot: unknown = view.state.selection.toJSON();
  let settled = false;

  return {
    release(): void {
      settled = true;
    },
    restore(): void {
      if (settled) return;
      settled = true;

      // The document can reshape while the transient UI is open (a remote
      // reconciliation remapping positions, for one), and the snapshot's
      // positions can stop resolving. When that happens there is no honest
      // reconstruction of "where it was", so the current selection is left
      // alone rather than guessed at; focus still moves back to the editor.
      try {
        const selection = Selection.fromJSON(view.state.doc, snapshot);
        // Nothing moved it, the common case: skip a selection-only transaction
        // that would just restate what dispatch already holds.
        if (!selection.eq(view.state.selection)) {
          view.dispatch(view.state.tr.setSelection(selection));
        }
      } catch {
        // fall through to focus() below
      }
      view.focus();
    },
  };
}
