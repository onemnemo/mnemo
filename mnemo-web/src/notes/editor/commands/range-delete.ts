/**
 * Deleting a text range that runs from one block into another.
 *
 * ProseMirror's own range replace knows only the schema, and this schema says
 * every block is `line block*`. So when a generic delete cuts a `twoColumn` or a
 * `table` open, the survivors are legal children of the block the range started
 * in and get re-parented into it: rows inside a heading, a column cell inside a
 * paragraph. The document passes `check()`, saves, reloads, and cannot be
 * selected or drawn as anything the product can author. When the range starts in
 * source instead, the two open ends are a `codeLine` and a `line`, which cannot
 * be joined at all, and the keystroke dies with a `TransformError`.
 *
 * Both come from delegating a decision this schema has to make itself, so the
 * delete is owned here: every cut is either whole nodes or text inside one line,
 * and nothing is ever left to a fit across a container boundary.
 *
 * The rule for what a range may take is the one the block-selection delete
 * already draws. A block the range covers goes whole, unless it is a parent's own
 * structure (a table's rows, a row's cells, a split's two columns), in which case
 * its interior is cleared and the structure stays: a row a cell short is not a
 * table any more, and lifting the cells out is the defect this module exists to
 * stop.
 */

import {
  Plugin,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import { keydownHandler } from 'prosemirror-keymap';
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';
import { containerBlockNames, lineIsCaretTarget } from '../blocks/shared';
import { asOwnUndoStep } from '../history';

/**
 * Blocks that are their parent's structure rather than content somebody put
 * there. A range never removes one of these on its own; it empties it instead.
 */
const NEVER_BARE: ReadonlySet<string> = new Set(['columnGroup', 'tableRow', 'tableCell']);

interface Cut {
  readonly from: number;
  readonly to: number;
}

/**
 * The cuts that take `[from, to)` out of `node`, appended in document order.
 *
 * Every cut is either a whole node or a run of text inside one line, so each is
 * a replacement ProseMirror has no fitting to do for. A block the range covers
 * whole is removed, a structural one is descended into and emptied, and a block
 * the range only reaches into is descended into so that only its covered parts
 * go.
 */
function planCuts(node: PMNode, nodePos: number, from: number, to: number, out: Cut[]): void {
  node.forEach((child, offset) => {
    const start = nodePos + 1 + offset;
    const end = start + child.nodeSize;
    if (end <= from || start >= to) return;

    if (child.isTextblock) {
      const cutFrom = Math.max(from, start + 1);
      const cutTo = Math.min(to, end - 1);
      if (cutTo > cutFrom) out.push({ from: cutFrom, to: cutTo });
      return;
    }

    const covered = from <= start && end <= to;
    if (covered && !NEVER_BARE.has(child.type.name)) {
      out.push({ from: start, to: end });
      return;
    }
    planCuts(child, start, from, to, out);
  });
}

/**
 * Whether the two ends can come out as one block.
 *
 * They can when they are siblings under a parent holding ordinary blocks, hold
 * the same kind of line, and both draw a caret. That is the one shape
 * ProseMirror's own replace gets right, and it is the one the user means by
 * selecting across a paragraph boundary: what is left of the two ends ends up in
 * one block. Everything else (a cell, a grid, source against prose) has no join
 * to make, and asking for one is what tears a container open or throws.
 */
function endsCanJoin($from: ResolvedPos, $to: ResolvedPos): boolean {
  if ($from.depth !== $to.depth || $from.depth < 2) return false;
  if ($from.node($from.depth - 2) !== $to.node($to.depth - 2)) return false;
  const head = $from.node($from.depth - 1);
  const tail = $to.node($to.depth - 1);
  for (const block of [head, tail]) {
    if (NEVER_BARE.has(block.type.name)) return false;
    if (containerBlockNames.has(block.type.name)) return false;
    if (!lineIsCaretTarget(block.type)) return false;
  }
  return $from.parent.type === $to.parent.type;
}

export interface CrossBlockDelete {
  readonly tr: Transaction;
  /**
   * Whether the two ends came out in one block. A caller adding a break of its
   * own (Enter over the range) still has to split when they did, and must not
   * when they did not: the boundary it wanted is already there.
   */
  readonly joined: boolean;
}

/**
 * The transaction that deletes a range spanning two blocks, or null when the
 * selection is not one: a caret, a node selection, or a range inside a single
 * line, all of which ProseMirror already handles correctly.
 */
export function buildCrossBlockDelete(state: EditorState): CrossBlockDelete | null {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || sel.empty) return null;
  const { $from, $to } = sel;
  if (!$from.parent.isTextblock || !$to.parent.isTextblock) return null;
  if ($from.sameParent($to)) return null;

  if (endsCanJoin($from, $to)) {
    return { tr: state.tr.delete(sel.from, sel.to), joined: true };
  }

  const cuts: Cut[] = [];
  planCuts(state.doc, -1, sel.from, sel.to, cuts);
  const tr = state.tr;
  // Back to front: the cuts are disjoint and ascending, so an earlier one's
  // positions are untouched by a later deletion.
  for (let i = cuts.length - 1; i >= 0; i--) tr.delete(cuts[i].from, cuts[i].to);
  // The head keeps everything before the range, so the range's own start is
  // still a position in it, and it is where the text went from.
  tr.setSelection(TextSelection.create(tr.doc, sel.from));
  return { tr, joined: false };
}

/** Backspace and Delete over a range that spans blocks. */
export const deleteCrossBlockRange: Command = (state, dispatch) => {
  const result = buildCrossBlockDelete(state);
  if (!result) return false;
  if (dispatch) dispatch(asOwnUndoStep(result.tr.scrollIntoView()));
  return true;
};

/**
 * The plugin that owns those two keys and typing over the same range.
 *
 * Typing is here rather than in a keymap because a typed character reaches the
 * editor as text input, and the replace ProseMirror would do for it is the same
 * generic one the keys were falling through to.
 */
export function crossBlockRangePlugin(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown: keydownHandler({
        Backspace: deleteCrossBlockRange,
        Delete: deleteCrossBlockRange,
      }),
      handleTextInput(view, from, to, text) {
        const sel = view.state.selection;
        // Composition and the input rules can offer a range of their own; only
        // the selection this module reasoned about is ours to replace.
        if (from !== sel.from || to !== sel.to) return false;
        const result = buildCrossBlockDelete(view.state);
        if (!result) return false;
        const tr = result.tr;
        tr.insertText(text, tr.selection.from);
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    },
  });
}
