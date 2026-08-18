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

import type { BlockRegistry } from '../editor/registry/build';
import { containerBlockNames } from '../editor/blocks/shared';
import { blockContext, isContentVisuallyEmpty } from '../editor/commands/structure';
import { coveredBlockRanges } from '../selection/delete-selected';

/** Insert `slice`'s top-level blocks at the selection, returning the transaction. */
export function placeBlockRun(state: EditorState, slice: Slice): Transaction {
  const nodes: PMNode[] = [];
  slice.content.forEach((node) => nodes.push(node));
  if (nodes.length === 0) return state.tr;

  const ctx = blockContext(state);
  const sel = state.selection;
  const spansBlocks = !sel.empty && !sel.$from.sameParent(sel.$to);
  if (!ctx) return state.tr.replaceSelection(slice);

  // A text selection that runs across blocks is replaced explicitly so the pasted
  // types stay clean; only a shape this cannot handle falls back to the fitter.
  if (spansBlocks) {
    return replaceSpanningSelection(state, nodes) ?? state.tr.replaceSelection(slice);
  }
  // A table cell is not a container, but the raw-position inserts below would put
  // a block at the row level, which the row cannot hold, and the isolating table
  // tears open around it. Fit the paste inside the cell instead, the way the
  // external-HTML path already does; the isolating cell keeps the content in it.
  if (containerBlockNames.has(ctx.block.type.name) || ctx.block.type.name === 'tableCell') {
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

/**
 * Replace a text selection that runs across block boundaries with the pasted run.
 *
 * The first block keeps its type and the text before the selection, the pasted
 * blocks land in the middle as siblings, and any text after the selection trails
 * in a fresh Text block; an endpoint the selection emptied is dropped rather than
 * left blank. Returns null for anything but a run across top-level prose blocks
 * (a nested column cell, a source line, a container, an image), so the caller can
 * fit those with `replaceSelection` as before.
 *
 * Without this, ProseMirror's own fitting merges the first pasted block's content
 * into the block the selection opened in, so pasting into a selection that starts
 * in a heading makes the whole paste inherit the heading's size and bold.
 */
function replaceSpanningSelection(state: EditorState, nodes: readonly PMNode[]): Transaction | null {
  if (nodes.length === 0) return null;
  const { $from, $to } = state.selection;
  // Both ends must be a plain `line` one level under the doc; anything deeper (a
  // column cell) or of another kind (a code line) is out of scope.
  if ($from.depth !== 2 || $to.depth !== 2) return null;
  if ($from.parent.type.name !== 'line' || $to.parent.type.name !== 'line') return null;

  const fromBlock = $from.node(1);
  const toBlock = $to.node(1);
  const outOfScope = (name: string) => containerBlockNames.has(name) || name === 'image';
  if (outOfScope(fromBlock.type.name) || outOfScope(toBlock.type.name)) return null;

  const schema = state.schema;
  const fromBlockPos = $from.before(1);
  const toBlockEnd = $to.after(1);
  const head = $from.parent.content.cut(0, $from.parentOffset);
  const tail = $to.parent.content.cut($to.parentOffset);

  const rebuilt: PMNode[] = [];
  const keepHead = !isContentVisuallyEmpty(head);
  if (keepHead) {
    rebuilt.push(fromBlock.type.create(fromBlock.attrs, schema.nodes.line.create(null, head)));
  }
  rebuilt.push(...nodes);
  if (!isContentVisuallyEmpty(tail)) {
    rebuilt.push(schema.nodes.paragraph.create(null, schema.nodes.line.create(null, tail)));
  }

  const tr = state.tr.replaceWith(fromBlockPos, toBlockEnd, rebuilt);
  const runStart = keepHead ? fromBlockPos + rebuilt[0].nodeSize : fromBlockPos;
  return caretAfterRun(tr, runStart, nodes);
}

/**
 * Replace an active Mode A block selection with the pasted run.
 *
 * When whole blocks are selected, a paste takes their place rather than dropping
 * in beside the collapsed text caret the block selection leaves behind. The
 * covered blocks are removed by the same outermost-coverage rule delete uses and
 * the run lands where the first of them was. Falls back to {@link placeBlockRun}
 * when the set resolves to no coverable range, so an empty or stale selection
 * still pastes rather than doing nothing.
 */
export function replaceSelectedBlocks(
  state: EditorState,
  slice: Slice,
  registry: BlockRegistry,
  selected: ReadonlySet<string>,
): Transaction {
  const nodes: PMNode[] = [];
  slice.content.forEach((node) => nodes.push(node));
  if (nodes.length === 0) return state.tr;

  const ranges = coveredBlockRanges(state.doc, registry, selected);
  if (ranges.length === 0) return placeBlockRun(state, slice);

  const tr = state.tr;
  // Disjoint, ascending ranges, so later ones do not shift the first. Delete the
  // trailing ranges back to front, then swap the run in for the first range in one
  // step: replacing rather than delete-all-then-insert keeps a block in the
  // document throughout, so a full-document replace never trips the schema's
  // "at least one block" auto-fill and leaves a stray empty paragraph behind.
  for (let i = ranges.length - 1; i >= 1; i--) {
    tr.delete(ranges[i].from, ranges[i].to);
  }
  tr.replaceWith(ranges[0].from, ranges[0].to, nodes);
  return caretAfterRun(tr, ranges[0].from, nodes);
}
