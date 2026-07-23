/**
 * The structural editing a two-column block needs beyond the generic commands:
 * what Backspace does at the very start of a column cell, and the dissolve that
 * collapses a split back into plain top-level blocks once a cell is emptied.
 *
 * These port the desktop's `OnMergeWithPreviousRequested` and
 * `UnwrapTwoColumnPromotingFilledColumn`. The desktop merges the caret block's
 * content into the previous block in *document order*, and because the wire
 * format walks a split as its left cell top-to-bottom then its right cell, with
 * the container itself skipped, that order is exactly ProseMirror's own position
 * order. So the merge target is just the previous content block by position: for
 * a first-right-cell block that is the last left-cell block; for a first-left-cell
 * block it is whatever sits above the whole split.
 *
 * Emptying a cell dissolves the split rather than leaving an empty column,
 * because the other cell's blocks were only ever grouped for layout. The
 * `column.neverEmpty` invariant is the universal net that re-seeds an emptied
 * cell; the dissolve runs inside the same transaction, so the invariant never
 * sees the transient empty cell it would otherwise refill.
 */

import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { blockChildrenOf, containerBlockNames, lineOf } from '../blocks/shared';
import { asOwnUndoStep } from '../history';
import { stripMarks, type BlockContext } from './structure';

export interface CellStart {
  /** The two-column container the caret's cell belongs to. */
  readonly twoColumn: PMNode;
  /** Position immediately before the two-column. */
  readonly twoColumnPos: number;
  /** True when the caret sits in the left cell. */
  readonly leftCell: boolean;
  /** Block children in the caret's cell, its mandatory line aside. */
  readonly cellBlockCount: number;
}

/**
 * The two-column coordinates when the caret is at the first block of a cell, or
 * null otherwise. Only the first block matters: Backspace deeper in a cell has an
 * ordinary previous block to merge into and never touches the split.
 */
export function cellStartContext(state: Parameters<Command>[0]): CellStart | null {
  const { $from } = state.selection;
  // blockContext resolves the caret's block one level above its line.
  const blockDepth = $from.depth - 1;
  if (blockDepth < 1) return null;
  const cell = $from.node(blockDepth - 1);
  if (cell.type.name !== 'columnGroup') return null;
  // Index 0 in a cell is its mandatory line, so index 1 is the first block.
  if ($from.index(blockDepth - 1) !== 1) return null;
  // A columnGroup only ever sits directly under a twoColumn, so the grandparent
  // exists and is that container.
  const twoColumn = $from.node(blockDepth - 2);
  if (twoColumn.type.name !== 'twoColumn') return null;
  return {
    twoColumn,
    twoColumnPos: $from.before(blockDepth - 2),
    // Index 0 in a twoColumn is its own line; 1 is the left cell, 2 the right.
    leftCell: $from.index(blockDepth - 2) === 1,
    cellBlockCount: cell.childCount - 1,
  };
}

/** The previous content block by position: the nearest non-container block ending at or before `before`. */
function previousContentBlock(doc: PMNode, before: number): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  doc.nodesBetween(0, before, (node, pos) => {
    // A line holds inline content, never a block to merge into: do not descend.
    if (node.isTextblock) return false;
    if (containerBlockNames.has(node.type.name)) return true;
    if (node.type.isBlock && lineOf(node)) {
      if (pos + node.nodeSize <= before) found = { node, pos };
      // A content block's own children are not separate merge targets here,
      // matching the desktop's flat document order.
      return false;
    }
    return true;
  });
  return found;
}

/** A copy of `block` with `content` appended to its line, marks dropped when the line is source. */
function withMergedContent(block: PMNode, content: Fragment): PMNode {
  const line = lineOf(block)!;
  const tail = line.type.name === 'codeLine' ? stripMarks(content) : content;
  const newLine = line.type.create(line.attrs, line.content.append(tail));
  return block.type.create(block.attrs, [newLine, ...blockChildrenOf(block)]);
}

/** Rebuilds a two-column cell around a new block list, keeping its own identity and line. */
function rebuildCell(cell: PMNode, blocks: readonly PMNode[]): PMNode {
  return cell.type.create(cell.attrs, [lineOf(cell)!, ...blocks]);
}

/** Rebuilds a two-column around new cells, keeping its attrs (split ratio, id, sid) and line. */
function rebuildTwoColumn(tc: PMNode, leftCell: PMNode, rightCell: PMNode): PMNode {
  return tc.type.create(tc.attrs, [lineOf(tc)!, leftCell, rightCell]);
}

/**
 * Backspace at the very start of a cell's first block. Merges that block's
 * content into the previous block in document order and, when doing so empties
 * the cell, dissolves the split by promoting the other cell's blocks to the
 * two-column's own place. With nothing before it in the whole document the key
 * is swallowed, exactly as the desktop does nothing there.
 */
export function backspaceAtCellStart(
  state: Parameters<Command>[0],
  ctx: BlockContext,
  cell: CellStart,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { blockPos, line } = ctx;
  const prev = previousContentBlock(state.doc, blockPos);
  if (!prev || !lineOf(prev.node)) return true;

  const tc = cell.twoColumn;
  const tcPos = cell.twoColumnPos;
  const tcEnd = tcPos + tc.nodeSize;
  const leftGroup = tc.child(1);
  const rightGroup = tc.child(2);
  const leftBlocks = blockChildrenOf(leftGroup);
  const rightBlocks = blockChildrenOf(rightGroup);
  // The caret block is the only one in its cell, so removing it empties the cell.
  const dissolving = cell.cellBlockCount === 1;

  // prev grows by the caret block's content; the caret lands at the seam, where
  // prev's own content used to end.
  const prev2 = withMergedContent(prev.node, line.content);
  const seamOffset = lineOf(prev.node)!.content.size;

  const tr = state.tr;
  let scanFrom: number;

  if (cell.leftCell) {
    // prev sits above the whole split; edit it and the split as two disjoint
    // spans so any structure between them (an adjacent split, say) is untouched.
    tr.replaceWith(prev.pos, prev.pos + prev.node.nodeSize, prev2);
    const at = tr.mapping.map(tcPos);
    const to = tr.mapping.map(tcEnd);
    const tcReplacement = dissolving
      ? Fragment.fromArray(rightBlocks)
      : Fragment.from(rebuildTwoColumn(tc, rebuildCell(leftGroup, leftBlocks.slice(1)), rightGroup));
    tr.replaceWith(at, to, tcReplacement);
    scanFrom = prev.pos;
  } else {
    // prev is the last left-cell block, so everything happens inside the split;
    // one replacement carries prev's new content and the split's new shape.
    const promotedLeft = [...leftBlocks.slice(0, -1), prev2];
    const replacement = dissolving
      ? Fragment.fromArray(promotedLeft)
      : Fragment.from(
          rebuildTwoColumn(
            tc,
            rebuildCell(leftGroup, promotedLeft),
            rebuildCell(rightGroup, rightBlocks.slice(1)),
          ),
        );
    tr.replaceWith(tcPos, tcEnd, replacement);
    scanFrom = tcPos;
  }

  // prev2 is inserted by reference, so finding that exact node fixes the caret
  // even when a dissolve replaced the whole two-column around it.
  let caret: number | null = null;
  tr.doc.nodesBetween(scanFrom, tr.doc.content.size, (node, pos) => {
    if (caret !== null) return false;
    if (node === prev2) {
      caret = pos + 2 + seamOffset; // into prev2, into its line, then to the seam
      return false;
    }
    return true;
  });
  if (caret !== null) tr.setSelection(TextSelection.create(tr.doc, caret));
  if (dispatch) dispatch(asOwnUndoStep(tr.scrollIntoView()));
  return true;
}
