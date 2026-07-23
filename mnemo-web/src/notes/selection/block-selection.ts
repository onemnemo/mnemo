/**
 * Block-level (Mode A) selection: a set of block sids, held as view state.
 *
 * This is the desktop's "Mode 2" selection - whole blocks marked selected, as
 * distinct from a text range inside them (which ProseMirror owns natively). The
 * set is a set of *sids* rather than positions so it survives a scroll, a
 * decoration remap, or a re-projection without being mapped: a sid names the
 * same block whatever position the block currently sits at.
 *
 * Everything here is a pure function of the document and the current set, so the
 * plugin that holds the set stays a thin state container and the algebra is
 * testable without a view. What can be selected is every block *except* the two
 * structural containers: a `columnGroup` cell wrapper is never a user block, and
 * a `twoColumn` row is represented by its leaves, so a container sid never enters
 * the set. Deleting turns the set back into ranges (see `delete-selected.ts`),
 * where a fully selected two-column is removed whole and a partly selected one
 * keeps its row and repairs the emptied cell.
 */

import type { Node as PMNode } from 'prosemirror-model';

import type { BlockRegistry } from '../editor/registry/build';
import { walkBlocks, type BlockEntry } from '../editor/projection/document';
import { containerBlockNames } from '../editor/blocks/shared';

export interface BlockSelection {
  /** The selected blocks, by sid. */
  readonly selected: ReadonlySet<string>;
  /**
   * The block a range extends from - the last block a plain or toggle click
   * touched. A shift-range runs from here to the clicked block.
   */
  readonly anchorSid: string | null;
}

export const EMPTY_SELECTION: BlockSelection = { selected: new Set<string>(), anchorSid: null };

export function isEmptySelection(selection: BlockSelection): boolean {
  return selection.selected.size === 0;
}

/**
 * The blocks a selection can hold, in document order.
 *
 * A container is excluded, not its contents: selecting a two-column means
 * selecting the blocks in its cells, so deleting the selection empties the
 * columns and the column-repair invariant unwraps the row - the same outcome as
 * deleting the row, reached without ever putting a container in the set. A block
 * with no sid yet (freshly split, identity not minted) is not selectable; it
 * gets a sid on the next append and becomes selectable then.
 */
export function selectableEntries(doc: PMNode, registry: BlockRegistry): BlockEntry[] {
  return walkBlocks(doc, registry).filter(
    (entry) => entry.sid !== '' && !containerBlockNames.has(entry.node.type.name),
  );
}

/** The selectable sids in document order, the index space shift-range walks. */
export function orderedSids(doc: PMNode, registry: BlockRegistry): string[] {
  return selectableEntries(doc, registry).map((entry) => entry.sid);
}

/** Replace the selection with one block; it becomes the range anchor. */
export function selectSingle(sid: string): BlockSelection {
  return { selected: new Set([sid]), anchorSid: sid };
}

/** Add or remove one block, leaving the rest; the toggled block becomes the anchor. */
export function toggleSid(current: BlockSelection, sid: string): BlockSelection {
  const next = new Set(current.selected);
  if (next.has(sid)) next.delete(sid);
  else next.add(sid);
  return { selected: next, anchorSid: sid };
}

/**
 * Select the inclusive run between the anchor and the target in document order.
 *
 * `additive` unions the run onto the current set (Ctrl+Shift), else it replaces
 * (Shift). With no usable anchor - the sid is gone, or nothing was selected yet -
 * this falls back to selecting the target alone, which is what a shift-click with
 * no prior selection should do. The anchor is preserved so a second shift-click
 * re-extends from the same origin rather than from the last target.
 */
export function selectRange(
  order: readonly string[],
  current: BlockSelection,
  targetSid: string,
  additive: boolean,
): BlockSelection {
  const anchorSid = current.anchorSid;
  const anchorIndex = anchorSid === null ? -1 : order.indexOf(anchorSid);
  const targetIndex = order.indexOf(targetSid);
  if (anchorIndex < 0 || targetIndex < 0) return selectSingle(targetSid);

  const lo = Math.min(anchorIndex, targetIndex);
  const hi = Math.max(anchorIndex, targetIndex);
  const run = order.slice(lo, hi + 1);
  const next = additive ? new Set([...current.selected, ...run]) : new Set(run);
  return { selected: next, anchorSid };
}

/** Select every selectable block; the first becomes the anchor. */
export function selectAll(order: readonly string[]): BlockSelection {
  return { selected: new Set(order), anchorSid: order[0] ?? null };
}

/**
 * The selectable leaves inside one block, by sid.
 *
 * For a normal block that is the block itself; for a two-column row it is the
 * blocks in both cells. This is what the gutter grip selects: the grip points at
 * a whole top-level block, and selecting it means selecting its content.
 */
export function sidsWithin(doc: PMNode, registry: BlockRegistry, blockPos: number, blockNode: PMNode): string[] {
  const from = blockPos;
  const to = blockPos + blockNode.nodeSize;
  return selectableEntries(doc, registry)
    .filter((entry) => entry.pos >= from && entry.pos < to)
    .map((entry) => entry.sid);
}
