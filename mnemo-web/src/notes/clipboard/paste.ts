/**
 * Paste of a slice copied inside the app.
 *
 * The read path hands back the exact slice a copy stashed; this clears the
 * blocks' identity so they are minted fresh, then drops them at the selection as
 * one undo step. A block copy is placed explicitly, because a block editor wants
 * a pasted block to become a new block rather than merge into the current line;
 * a text copy keeps ProseMirror's `replaceSelection`, which is exactly the inline
 * merge a mid-paragraph paste wants.
 *
 * Returning false leaves the event for the editor's default handling, which is
 * how an external or plain-text paste, or a copy from a previous run whose
 * stashed slice is gone, still pastes something reasonable.
 */

import type { EditorView } from 'prosemirror-view';

import type { BlockRegistry } from '../editor/registry/build';
import { asOwnUndoStep } from '../editor/history';
import { withFreshIdentity } from './clear-identity';
import { placeBlockRun } from './place-blocks';
import { readInternalSlice } from './read-clipboard';

export function handleInternalPaste(
  view: EditorView,
  data: DataTransfer | null,
  registry: BlockRegistry,
): boolean {
  if (!data) return false;

  const internal = readInternalSlice(data);
  if (!internal) return false;

  const slice = withFreshIdentity(internal.slice, registry);
  const tr =
    internal.mode === 'blocks'
      ? placeBlockRun(view.state, slice)
      : view.state.tr.replaceSelection(slice);
  if (!tr.docChanged) return false;

  view.dispatch(asOwnUndoStep(tr).scrollIntoView());
  return true;
}
