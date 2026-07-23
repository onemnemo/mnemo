/**
 * The one mutation a vertical block reorder makes: move a top-level block from
 * one child index to another, as a single transaction.
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
