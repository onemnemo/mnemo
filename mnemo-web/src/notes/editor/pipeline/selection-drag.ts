/**
 * Prevents native text drag and drop from moving or copying marked prose.
 *
 * Browsers treat a drag that starts inside a text selection as a content drag.
 * Dropping moves the selection, while holding Control copies it. Mnemo reserves
 * pointer drags for selecting text, so a marked text range never starts native
 * drag and drop. Node selections remain available to block types that provide
 * their own drag behavior.
 */

import { Plugin, TextSelection, type Selection } from 'prosemirror-state';

export function blocksNativeTextDrag(selection: Selection): boolean {
  return selection instanceof TextSelection && !selection.empty;
}

export function selectionDragPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        dragstart(view, event) {
          if (!blocksNativeTextDrag(view.state.selection)) return false;
          event.preventDefault();
          return true;
        },
      },
    },
  });
}
