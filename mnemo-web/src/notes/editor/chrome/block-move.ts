/**
 * The mutations a block drag makes: move a top-level block from one child index
 * to another, extract a nested block out of its container to a top-level gap, or
 * move a block into a column cell, each as a single transaction.
 *
 * Single is the whole point. A delete and an insert in one transaction is one
 * history step, so a drop undoes in one press and saves once, and the moved
 * node is carried across verbatim, so its `sid` - the identifier the AI quotes -
 * survives the move rather than being re-minted at the new slot.
 *
 * `moveTo` and `childIndex` are destination indexes *after* the block is
 * removed, which is what the resolver already computes: a forward move past the
 * block's own slot has shifted down by one because the block left first.
 */

import { Fragment, type Node as PMNode } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';

import { blockChildrenOf, lineOf } from '../blocks/shared';

/**
 * A transaction moving the block at `sourceIndex` to `moveTo`, or null when the
 * move is out of range or a no-op. The caller dispatches it through the view so
 * it runs the invariant and autosave path exactly as a typed edit would.
 */
export function moveBlockTransaction(
  state: EditorState,
  sourceIndex: number,
  moveTo: number,
): Transaction | null {
  const doc = state.doc;
  const count = doc.childCount;
  if (sourceIndex < 0 || sourceIndex >= count) return null;
  // After the block is removed there are count-1 slots; moveTo indexes those,
  // so its last valid value is count-1 (append after the final remaining block).
  if (moveTo < 0 || moveTo > count - 1) return null;
  if (moveTo === sourceIndex) return null;

  let from = 0;
  for (let i = 0; i < sourceIndex; i++) from += doc.child(i).nodeSize;
  const node = doc.child(sourceIndex);
  const to = from + node.nodeSize;

  const tr = state.tr.delete(from, to);

  // Insert position is read from the post-deletion document, whose children have
  // already reindexed, so `moveTo` lands where the resolver meant it to.
  let insertPos = 0;
  for (let i = 0; i < moveTo; i++) insertPos += tr.doc.child(i).nodeSize;
  tr.insert(insertPos, node);

  return tr;
}

/**
 * The block at `pos`, or null when the drag's own record of it is stale: the
 * drop verifies by sid so an old position can never move the wrong content.
 */
function draggedBlockAt(doc: PMNode, pos: number, sid: string): PMNode | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const node = doc.nodeAt(pos);
  return node && String(node.attrs.sid ?? '') === sid ? node : null;
}

/**
 * A transaction moving the nested block at `pos` out of its container to the
 * top-level gap `insertIndex`, or null when the block is not where the drag
 * left it. The node is carried verbatim, so its sid survives; the column-repair
 * invariant reseeds a cell this empties, in the same undo step.
 *
 * Removing a nested block changes no top-level indexes, only the size of the
 * ancestor it leaves, so `insertIndex` maps onto the post-deletion document's
 * children unshifted.
 */
export function extractBlockTransaction(
  state: EditorState,
  pos: number,
  sid: string,
  insertIndex: number,
): Transaction | null {
  const doc = state.doc;
  const node = draggedBlockAt(doc, pos, sid);
  if (!node) return null;
  // A top-level block is moveBlockTransaction's job; extracting it would be an
  // unsuppressed-no-op path around the resolver's own guard.
  if (doc.resolve(pos).depth === 0) return null;
  if (insertIndex < 0 || insertIndex > doc.childCount) return null;

  const tr = state.tr.delete(pos, pos + node.nodeSize);
  let insertPos = 0;
  for (let i = 0; i < insertIndex; i++) insertPos += tr.doc.child(i).nodeSize;
  tr.insert(insertPos, node);

  return tr;
}

/**
 * A transaction moving the block at `pos` into the column cell at `cellPos`, as
 * block child `childIndex` of the cell once the block has left wherever it was.
 * Null when either end is not where the drag left it (both are verified by
 * sid), when the block would land on its own slot, when the cell sits inside
 * the block, or when the cell's content expression refuses the block.
 *
 * Works for a block from the page, from another cell, and from the same cell,
 * so a drop has one shape whatever it came from. The cell's position is mapped
 * through the deletion rather than recomputed, and a cell the block leaves empty
 * is reseeded by the column-repair invariant in the same undo step.
 */
export function moveBlockIntoCellTransaction(
  state: EditorState,
  pos: number,
  sid: string,
  cellPos: number,
  cellSid: string,
  childIndex: number,
): Transaction | null {
  const doc = state.doc;
  const node = draggedBlockAt(doc, pos, sid);
  if (!node) return null;
  const end = pos + node.nodeSize;
  if (cellPos >= pos && cellPos < end) return null;

  const cell = doc.nodeAt(cellPos);
  if (!cell || cell.type.name !== 'columnGroup' || String(cell.attrs.sid ?? '') !== cellSid) return null;

  const $pos = doc.resolve(pos);
  const ownCell = $pos.depth > 0 && $pos.before($pos.depth) === cellPos;
  // The cell's line sits at node index 0, so its block-child index is one less.
  if (ownCell && $pos.index($pos.depth) - 1 === childIndex) return null;

  const tr = state.tr.delete(pos, end);
  const at = tr.mapping.map(cellPos, -1);
  const live = tr.doc.nodeAt(at);
  if (!live || live.type.name !== 'columnGroup') return null;
  const line = lineOf(live);
  const children = blockChildrenOf(live);
  if (!line || childIndex < 0 || childIndex > children.length) return null;
  if (!live.canReplace(childIndex + 1, childIndex + 1, Fragment.from(node))) return null;

  let insertPos = at + 1 + line.nodeSize;
  for (let i = 0; i < childIndex; i++) insertPos += children[i].nodeSize;
  tr.insert(insertPos, node);

  return tr;
}
