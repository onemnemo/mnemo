/**
 * Where a pasted run of whole blocks lands.
 *
 * ProseMirror's own `replaceSelection` is wrong for this: a single closed block
 * dropped at a text caret has its content merged into the current line, so
 * pasting one copied paragraph into another would join them instead of making a
 * new block. A block editor wants the opposite, so placement is explicit and
 * mirrors the split the Enter key already does: the current block keeps the text
 * before the caret, the pasted blocks follow as its siblings, and the text after
 * the caret trails them in a fresh block.
 *
 * The common shapes are handled precisely and the rest degrade to
 * `replaceSelection`, which still inserts the identity-cleared slice (so nothing
 * collides) even where the placement is only approximate:
 *
 *  - caret in an empty paragraph: the blocks replace it, so a paste onto a blank
 *    line fills it rather than pushing an empty block around;
 *  - caret at the start or end of a block: the blocks go before or after it whole;
 *  - caret in the middle, or a selection within one line: the block splits and the
 *    run lands in the gap, the selected text (if any) dropped;
 *  - anything else (a node selection, a selection spanning blocks, a container's
 *    own line): `replaceSelection`, refined by the placement pass.
 *
 * The caret ends at the end of the last pasted block, where typing continues.
 */

import type { Node as PMNode, Slice } from 'prosemirror-model';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';

import { containerBlockNames } from '../editor/blocks/shared';
import { blockContext, isContentVisuallyEmpty } from '../editor/commands/structure';

/** Insert `slice`'s top-level blocks at the selection, returning the transaction. */
export function placeBlockRun(state: EditorState, slice: Slice): Transaction {
  const nodes: PMNode[] = [];
  slice.content.forEach((node) => nodes.push(node));
  if (nodes.length === 0) return state.tr;

  const ctx = blockContext(state);
  const sel = state.selection;
  const spansBlocks = !sel.empty && !sel.$from.sameParent(sel.$to);
  if (!ctx || spansBlocks || containerBlockNames.has(ctx.block.type.name)) {
    return state.tr.replaceSelection(slice);
  }

  const { block, blockPos, line } = ctx;
  const fromOff = sel.$from.parentOffset;
  const toOff = sel.empty ? fromOff : sel.$to.parentOffset;
  const before = line.content.cut(0, fromOff);
  const after = line.content.cut(toOff);
  const collapsed = sel.empty;

  // A blank line: the run takes its place.
  if (collapsed && isContentVisuallyEmpty(line.content) && block.type.name === 'paragraph') {
    const tr = state.tr.replaceWith(blockPos, blockPos + block.nodeSize, nodes);
    return caretAfterRun(tr, blockPos, nodes);
  }

  // Collapsed at the very start of a non-empty block: the run goes above it whole.
  if (collapsed && fromOff === 0) {
    const tr = state.tr.insert(blockPos, nodes);
    return caretAfterRun(tr, blockPos, nodes);
  }

  // Collapsed at the very end: the run goes below it whole.
  if (collapsed && fromOff === line.content.size) {
    const at = blockPos + block.nodeSize;
    const tr = state.tr.insert(at, nodes);
    return caretAfterRun(tr, at, nodes);
  }

  // In the middle, or replacing a selection within the line: split at the caret,
  // the run lands in the gap, and any text after the caret trails it in a new block.
  const schema = state.schema;
  const lineContentStart = blockPos + 2;
  const lineContentEnd = lineContentStart + line.content.size;
  const blockEnd = blockPos + block.nodeSize;

  const tr = state.tr.replaceWith(lineContentStart, lineContentEnd, before);
  const gap = blockEnd - (line.content.size - before.size);
  const trailing = isContentVisuallyEmpty(after)
    ? []
    : [schema.nodes.paragraph.create(null, schema.nodes.line.create(null, after))];
  tr.insert(gap, [...nodes, ...trailing]);
  return caretAfterRun(tr, gap, nodes);
}

/** Puts the caret at the end of the last node of a run inserted at `runStart`. */
function caretAfterRun(tr: Transaction, runStart: number, nodes: readonly PMNode[]): Transaction {
  const runEnd = runStart + nodes.reduce((size, node) => size + node.nodeSize, 0);
  return tr.setSelection(TextSelection.near(tr.doc.resolve(runEnd), -1));
}
