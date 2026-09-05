/**
 * Reaching the boundaries the caret cannot get to: the keys, the click and the
 * paint.
 *
 * Two behaviours, one subject. An arrow key that would otherwise die at the edge
 * of a divider or an equation lands on the gap beside it, where the caret is
 * drawn and typing makes the paragraph the gap stood for. And Backspace or
 * Delete aimed at a neighbour with no line to merge into puts that block in the
 * block selection instead of being swallowed, so a second press removes it:
 * until now the keyboard could make a divider, a table or a two-column and never
 * take it away again.
 *
 * The plugin sits below the block selection and above the structural keymap. A
 * live block selection therefore still owns Backspace and Delete, which is what
 * makes the second press a delete, while every caret case arrives here before
 * the structural ladder swallows it.
 */

import { keydownHandler } from 'prosemirror-keymap';
import type { Node as PMNode } from 'prosemirror-model';
import {
  Plugin,
  Selection,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

import { asOwnUndoStep } from '../editor/history';
import { containerBlockNames, lineIsCaretTarget } from '../editor/blocks/shared';
import {
  blockContext,
  followingLineBlock,
  precedingLineBlock,
} from '../editor/commands/structure';
import type { BlockRegistry } from '../editor/registry/build';
import { getBlockSelection, setBlockSelection } from './block-selection-plugin';
import { applyGrip } from './grip-selection';
import { GapCursor, findGapFrom, gapCursorValid, gapSearchStart } from './gap-cursor';

interface Neighbour {
  readonly node: PMNode;
  readonly pos: number;
}

/**
 * Whether the caret's own block is one whose Backspace or Delete reaches its
 * neighbour at all, which decides whether this plugin has anything to claim.
 *
 * The two ladders in the structural keymap differ here and are mirrored rather
 * than approximated. Backspace at column 0 de-formats every block that is not
 * already Text, so only a paragraph ever gets as far as the block above; a
 * second press, on the paragraph the de-format left, then does. Delete stops
 * short only for the three shapes that never join a neighbour in either
 * direction.
 */
function reachesNeighbour(block: PMNode, dir: 1 | -1): boolean {
  const name = block.type.name;
  if (dir < 0) return name === 'paragraph';
  return !containerBlockNames.has(name) && name !== 'tableCell' && name !== 'image';
}

/**
 * The neighbour a Backspace or a Delete runs into, when it has no line to merge
 * into.
 *
 * That is a divider or an equation, which hold no caret anywhere, and a table or
 * a two-column, whose own line is scenery and whose content is a level down.
 * Those are exactly the neighbours the structural ladder swallows the key for,
 * which is what left them impossible to remove from the keyboard.
 */
function linelessNeighbour(state: EditorState, dir: 1 | -1): Neighbour | null {
  const sel = state.selection;

  if (sel instanceof GapCursor) {
    const node = dir > 0 ? sel.$head.nodeAfter : sel.$head.nodeBefore;
    if (!node || lineIsCaretTarget(node.type)) return null;
    return { node, pos: dir > 0 ? sel.head : sel.head - node.nodeSize };
  }

  if (!(sel instanceof TextSelection) || !sel.empty) return null;
  const ctx = blockContext(state);
  if (!ctx || !reachesNeighbour(ctx.block, dir)) return null;
  if (dir > 0 && ctx.offset !== ctx.line.content.size) return null;
  if (dir < 0 && ctx.offset !== 0) return null;

  const target =
    dir > 0 ? followingLineBlock(state.doc, ctx) : precedingLineBlock(state.doc, ctx.blockPos);
  return target && !lineIsCaretTarget(target.node.type) ? target : null;
}

/**
 * Marks the neighbouring block, which is what makes the next Backspace or Delete
 * remove it: the block-selection plugin above this one claims both keys once its
 * set is not empty.
 *
 * Marked through the grip's own rule, so the unit is what a click on that
 * block's handle would select: itself for a divider, every cell's contents for a
 * table or a two-column, which is what the delete then removes whole.
 */
function selectNeighbour(registry: BlockRegistry, dir: 1 | -1): Command {
  return (state, dispatch, view) => {
    const target = linelessNeighbour(state, dir);
    if (!target) return false;
    const current = getBlockSelection(state);
    const next = applyGrip(state.doc, registry, current, target.pos, target.node, 'select');
    // Nothing in it carries a sid yet (identity is minted on the next append),
    // so there is nothing to mark and the key belongs to whoever is below.
    if (next.selected.size === 0) return false;
    if (dispatch && view) setBlockSelection(view, next);
    return true;
  };
}

/** The paragraph a gap stands for, carrying `text` if the key brought any. */
function fillGap(state: EditorState, at: number, text: string): Transaction {
  const { paragraph, line } = state.schema.nodes;
  const content = text.length > 0 ? state.schema.text(text) : null;
  const tr = state.tr.insert(at, paragraph.create(null, line.create(null, content)));
  // The block opens at `at`, its line one further in, and the line's content one
  // after that.
  tr.setSelection(TextSelection.create(tr.doc, at + 2 + text.length));
  return tr;
}

type Axis = 'horiz' | 'vert';

/**
 * An arrow key, for the two selections that have a gap in their future.
 *
 * From text: only at the edge of the line, and only when a gap lies that way.
 * Everything else is declined, so the image-caption arrows, the end-of-note
 * escape and the browser's own motion keep the keys they already own.
 *
 * From a gap: always claimed. The next gap if there is one, otherwise the
 * nearest real line, because a gap cursor is not a position any other handler
 * knows how to move away from.
 */
function gapArrow(axis: Axis, dir: 1 | -1): Command {
  const towards = axis === 'vert' ? (dir > 0 ? 'down' : 'up') : dir > 0 ? 'right' : 'left';
  return (state, dispatch, view) => {
    const sel = state.selection;

    if (sel instanceof GapCursor) {
      const $next = findGapFrom(sel.$head, dir, true);
      const found = $next ? new GapCursor($next) : Selection.findFrom(sel.$head, dir, true);
      if (found && dispatch) dispatch(state.tr.setSelection(found).scrollIntoView());
      return true;
    }

    if (!view || !(sel instanceof TextSelection) || !sel.empty || sel.$head.depth === 0) return false;
    // The document is asked first and the layout second: most presses have no
    // gap in their direction, and the edge test measures the DOM.
    const $gap = findGapFrom(gapSearchStart(sel.$head, dir), dir, false);
    if (!$gap || !view.endOfTextblock(towards)) return false;
    if (dispatch) dispatch(state.tr.setSelection(new GapCursor($gap)).scrollIntoView());
    return true;
  };
}

/** Enter at a gap: the paragraph appears and the caret goes into it. */
const enterAtGap: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!(sel instanceof GapCursor)) return false;
  if (dispatch) dispatch(asOwnUndoStep(fillGap(state, sel.head, '').scrollIntoView()));
  return true;
};

/** The caret. A widget, because nothing in the document sits where it points. */
function drawGapCaret(): HTMLElement {
  const caret = document.createElement('div');
  caret.className = 'notes-gap-caret';
  caret.setAttribute('contenteditable', 'false');
  return caret;
}

export function gapCursorPlugin(registry: BlockRegistry): Plugin {
  const gapKeys = keydownHandler({
    ArrowLeft: gapArrow('horiz', -1),
    ArrowRight: gapArrow('horiz', 1),
    ArrowUp: gapArrow('vert', -1),
    ArrowDown: gapArrow('vert', 1),
    Enter: enterAtGap,
    Backspace: selectNeighbour(registry, -1),
    Delete: selectNeighbour(registry, 1),
  });

  return new Plugin({
    props: {
      decorations(state) {
        const sel = state.selection;
        if (!(sel instanceof GapCursor)) return null;
        return DecorationSet.create(state.doc, [
          Decoration.widget(sel.head, drawGapCaret, { key: 'notes-gap-caret' }),
        ]);
      },
      handleKeyDown: gapKeys,
      handleTextInput(view: EditorView, from: number, to: number, text: string) {
        const sel = view.state.selection;
        if (!(sel instanceof GapCursor)) return false;
        // Only the selection this module reasoned about: an input rule or a
        // composition can offer a range of its own.
        if (from !== sel.head || to !== sel.head) return false;
        view.dispatch(fillGap(view.state, sel.head, text).scrollIntoView());
        return true;
      },
      handleClick(view: EditorView, pos: number) {
        if (!view.editable) return false;
        const $pos = view.state.doc.resolve(pos);
        if (!gapCursorValid($pos)) return false;
        view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));
        return true;
      },
      createSelectionBetween(_view, $anchor, $head) {
        return $anchor.pos === $head.pos && gapCursorValid($head) ? new GapCursor($head) : null;
      },
      handleDOMEvents: {
        beforeinput(view, event) {
          const sel = view.state.selection;
          if (!(sel instanceof GapCursor)) return false;
          const input = event as InputEvent;
          // Plain typing is answered here, before the engine touches the DOM.
          // The gap's DOM selection sits between two block elements, and text
          // the browser drops there is read back as a change spanning the block
          // after it, which the parser then folds into the new paragraph as a
          // child. Making the paragraph first leaves it nothing to fold.
          if (input.inputType === 'insertText' && typeof input.data === 'string') {
            event.preventDefault();
            view.dispatch(fillGap(view.state, sel.head, input.data).scrollIntoView());
            return true;
          }
          // A composition needs a line to happen in before it starts. Without
          // one the browser moves the DOM selection itself and the composed
          // text is lost, so the paragraph is made first and the composition
          // continues into it.
          if (input.inputType !== 'insertCompositionText') return false;
          view.dispatch(fillGap(view.state, sel.head, ''));
          return false;
        },
      },
    },
  });
}
