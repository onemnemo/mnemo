/**
 * Delete a Mode A block selection, as one undo/one save.
 *
 * The plan is by outermost coverage, not a flat list of the selected leaves.
 * That matters for two reasons the flat approach got wrong. A block fully
 * covered by the selection is removed as one unit, so a two-column row whose
 * cells are all selected is deleted whole (and "select all" then empties the
 * document, which the guard turns into one empty block) rather than leaving an
 * empty two-column scaffold. And because a covered block is never descended
 * into, a selected block that happens to contain another selected block - which
 * imported or pasted data can produce, since every block type may nest - deletes
 * once, from the outside, instead of deleting an inner range and then a stale
 * outer one.
 *
 * The resulting ranges are disjoint and in document order, so they delete back
 * to front with no position mapping. Deleting a leaf inside a partially selected
 * column empties its cell; that is left to the column-repair invariant, which
 * reseeds the cell after this transaction lands, inside the same undo step. The
 * transaction is fenced as its own undo step so a delete that abuts a typing run
 * is still one Ctrl+Z.
 */

import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import type { BlockRegistry } from '../editor/registry/build';
import { blockChildrenOf, containerBlockNames } from '../editor/blocks/shared';
import { asOwnUndoStep } from '../editor/history/boundaries';

interface Range {
  readonly from: number;
  readonly to: number;
}

/**
 * Whether the selection covers a whole block, so it can be deleted as one unit.
 *
 * A leaf is covered when its own sid is selected: deleting it takes its content
 * with it, which is what deleting a block means. A container is covered only
 * when every one of its block children is, so a two-column row is removed whole
 * exactly when everything in it is selected and is otherwise kept for its cells
 * to be repaired.
 */
function isFullyCovered(node: PMNode, selected: ReadonlySet<string>): boolean {
  if (containerBlockNames.has(node.type.name)) {
    const children = blockChildrenOf(node);
    return children.length > 0 && children.every((child) => isFullyCovered(child, selected));
  }
  const sid = String(node.attrs.sid ?? '');
  return sid !== '' && selected.has(sid);
}

/**
 * The outermost ranges to delete, in document order.
 *
 * A fully covered block is deleted whole; a partially covered one is descended
 * into so only its covered parts go. A `columnGroup` cell is never deleted on
 * its own - its parent row requires exactly two - so it is always descended into
 * and its covered leaves are removed individually.
 *
 * A table's own `tableRow` and `tableCell` get the same treatment, for a
 * stricter reason: shape there is not this module's to change at all. A table
 * cell holds no repair invariant the way an emptied two-column cell does, so a
 * lone covered cell deleted here would either leave its row short of its
 * neighbours or, at one cell wide, break the row's own "at least one cell"
 * shape outright; a lone covered row skirts `removeRow`'s refusal to take a
 * table below one row and drops its header flag without the splice that keeps
 * it aligned. Both are reachable from an ordinary selection that merely spans
 * past a table without ever meaning to touch it - the anchor or target can
 * land on a cell's own sid, since a cell is a real selectable leaf, and the
 * run between two such points can cover some of a table's cells without
 * covering the table. Recursing into a row or cell that turns up this way
 * finds no block children of its own and removes nothing, which is the
 * correct outcome: a table changes shape only through its own commands.
 */
function planDeletions(
  node: PMNode,
  nodePos: number,
  registry: BlockRegistry,
  selected: ReadonlySet<string>,
): Range[] {
  const out: Range[] = [];
  node.forEach((child, offset) => {
    if (!registry.byNodeName.has(child.type.name)) return; // skip the line and non-blocks
    const childPos = nodePos + 1 + offset;
    const neverBare =
      child.type.name === 'columnGroup' ||
      child.type.name === 'tableRow' ||
      child.type.name === 'tableCell';
    if (!neverBare && isFullyCovered(child, selected)) {
      out.push({ from: childPos, to: childPos + child.nodeSize });
    } else {
      out.push(...planDeletions(child, childPos, registry, selected));
    }
  });
  return out;
}

/**
 * The outermost covered block ranges for a selection, in document order.
 *
 * Shared with the clipboard: copy assembles its slice from exactly the ranges
 * delete would remove, so a whole two-column row is copied as one unit and a
 * partly-selected column contributes only its covered leaves, the same units the
 * desktop's document-order enumeration copies.
 */
export function coveredBlockRanges(
  doc: PMNode,
  registry: BlockRegistry,
  selected: ReadonlySet<string>,
): readonly Range[] {
  if (selected.size === 0) return [];
  return planDeletions(doc, -1, registry, selected);
}

export function buildDeleteSelected(
  state: EditorState,
  registry: BlockRegistry,
  selected: ReadonlySet<string>,
): Transaction | null {
  if (selected.size === 0) return null;
  const ranges = coveredBlockRanges(state.doc, registry, selected);
  if (ranges.length === 0) return null;

  const tr = state.tr;
  // Back to front: the ranges are disjoint and ascending, so an earlier range's
  // position is unchanged by a later deletion.
  for (let i = ranges.length - 1; i >= 0; i--) {
    tr.delete(ranges[i].from, ranges[i].to);
  }

  if (tr.doc.childCount === 0) {
    const paragraph = state.schema.nodes.paragraph;
    const filled = paragraph?.createAndFill();
    if (filled) tr.insert(0, filled);
  }

  // Drop the caret where the first removed block was, so focus lands next to the
  // deletion rather than jumping to the top of the document.
  const at = Math.max(0, Math.min(ranges[0].from, tr.doc.content.size));
  tr.setSelection(TextSelection.near(tr.doc.resolve(at)));
  return asOwnUndoStep(tr);
}
