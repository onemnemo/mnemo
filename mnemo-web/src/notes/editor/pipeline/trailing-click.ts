/**
 * A press below the last block puts the caret in a new one.
 *
 * Without this the end of a document is a dead end for any block you cannot
 * leave with Enter: a table swallows Enter to walk its cells, a code block turns
 * it into a newline, and neither of them ever splits. Land one of those at the
 * bottom of a note and there is no gesture left that adds a block after it, so
 * the empty space under the document is the escape hatch and has to work.
 *
 * It is written once, here, rather than per block type. The rule is about the
 * *document* (there is nothing after the last block, and you pressed after it),
 * not about whatever that last block happens to be, so a block type added later
 * gets this for free and cannot get it subtly wrong.
 *
 * ## Which presses count
 *
 * Only ones whose target is the editable root itself. A press on a block, or in
 * the few pixels of margin between two, hits that block's own DOM and belongs to
 * it; only the trailing space under the whole document is the root's. The extra
 * check against the last block's bottom edge is what separates that trailing
 * space from the inter-block gaps, which are also the root's but are not below
 * everything.
 *
 * The space itself is the editable root's bottom padding (`notes-editor.css`).
 * It cannot sit on the pane around the editor: it would look identical and be
 * unreachable, since a press there never enters the view at all.
 *
 * `mousedown` rather than `click`, because by the time a click has landed the
 * browser has already put the caret at the nearest position it could find, which
 * for a press under a table is inside one of its cells. Claiming the press
 * first is what stops the caret going somewhere it was never asked to go.
 */

import { Plugin, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

import { lineOf } from '../blocks/shared';
import { isContentVisuallyEmpty } from '../commands/structure';
import { asOwnUndoStep } from '../history';

/**
 * Whether the document already ends in a block this rule would have created, in
 * which case there is nothing to add and the press is only asking for the caret.
 * Appending anyway would leave a run of blank blocks behind a user who pressed
 * twice.
 */
function isSpareTextBlock(node: PMNode): boolean {
  if (node.type.name !== 'paragraph') return false;
  const line = lineOf(node);
  return line !== null && node.childCount === 1 && isContentVisuallyEmpty(line.content);
}

function pressedBelowEverything(view: EditorView, event: MouseEvent): boolean {
  if (event.target !== view.dom) return false;
  const last = view.dom.lastElementChild;
  if (!last) return false;
  return event.clientY > last.getBoundingClientRect().bottom;
}

/** Puts the caret at the end of the document, adding a block first if it needs one. */
function appendAndFocus(view: EditorView): void {
  const { state } = view;
  const last = state.doc.lastChild;

  if (last && isSpareTextBlock(last)) {
    const at = state.doc.content.size - last.nodeSize + 2;
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, at)).scrollIntoView());
    return;
  }

  const { paragraph, line } = state.schema.nodes;
  const at = state.doc.content.size;
  const tr = state.tr.insert(at, paragraph.create(null, line.create()));
  tr.setSelection(TextSelection.create(tr.doc, at + 2));
  view.dispatch(asOwnUndoStep(tr.scrollIntoView()));
}

export function trailingClickPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          if (!view.editable || event.button !== 0) return false;
          if (!pressedBelowEverything(view, event)) return false;
          // The browser would otherwise move focus and set a selection of its
          // own from the coordinates, both of which this is replacing.
          event.preventDefault();
          appendAndFocus(view);
          view.focus();
          return true;
        },
      },
    },
  });
}
