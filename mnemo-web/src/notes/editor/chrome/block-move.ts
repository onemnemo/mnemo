/**
 * The mutations a vertical block reorder makes: move a top-level block from one
 * child index to another, or extract a nested block out of its container to a
 * top-level gap, each as a single transaction.
 *
 * Single is the whole point. A delete and an insert in one transaction is one
 * history step, so a drop undoes in one press and saves once, and the moved
 * node is carried across verbatim, so its `sid` - the identifier the AI quotes -
 * survives the move rather than being re-minted at the new slot.
 *
 * `moveTo` is the destination child index *after* the block is removed, which is
 * what the resolver already computes: a forward move past the block's own slot
 * has shifted down by one because the block left first.
 */

import type { EditorState, Transaction } from 'prosemirror-state';

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
 * A transaction moving the nested block at `pos` out of its container to the
 * top-level gap `insertIndex`, or null when the block is not where the drag
 * left it (the drop verifies by sid so a stale position can never move the
 * wrong content). The node is carried verbatim, so its sid survives; the
 * column-repair invariant reseeds a cell this empties, in the same undo step.
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
  if (pos < 0 || pos > doc.content.size) return null;
  const node = doc.nodeAt(pos);
  if (!node || String(node.attrs.sid ?? '') !== sid) return null;
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
