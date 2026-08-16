/**
 * What a click on the gutter grip does to the block selection.
 *
 * The modifier map is the desktop's SelectBlockFromDragHandle, verbatim: a
 * plain click selects the block alone, Ctrl/Cmd toggles it, Shift ranges from
 * the anchor, Ctrl+Shift adds the range. The port's grip also opens the block
 * action menu on the plain click - that part is the caller's, this module owns
 * only the selection algebra. The grip points at one located block, so the unit
 * it selects is that block's leaves: itself for a leaf, every cell child for a
 * two-column row.
 */

import type { Node as PMNode } from 'prosemirror-model';

import type { BlockRegistry } from '../editor/registry/build';
import { orderedSids, selectRange, sidsWithin, type BlockSelection } from './block-selection';

export type GripIntent = 'select' | 'toggle' | 'range' | 'range-add';

export function gripIntent(event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): GripIntent {
  const primary = event.ctrlKey || event.metaKey;
  if (primary && event.shiftKey) return 'range-add';
  if (event.shiftKey) return 'range';
  if (primary) return 'toggle';
  return 'select';
}

/**
 * The selection after a grip click.
 *
 * Select replaces the set with the clicked block - except when the block is
 * already inside a multi-selection, which is kept whole so the menu the click
 * opens can act on all of it (clicking into your own selection must not
 * collapse it). Toggle flips the whole block: if all its leaves are selected it
 * removes them, otherwise it adds them, so a second Ctrl-click on the same
 * block deselects it. Range and range-add extend from the current anchor to the
 * block's last leaf; with no anchor yet they select the block itself, additive
 * keeping the rest.
 */
export function applyGrip(
  doc: PMNode,
  registry: BlockRegistry,
  current: BlockSelection,
  blockPos: number,
  blockNode: PMNode,
  intent: GripIntent,
): BlockSelection {
  const leaves = sidsWithin(doc, registry, blockPos, blockNode);
  if (leaves.length === 0) return current;

  if (intent === 'select') {
    if (leaves.every((sid) => current.selected.has(sid))) return current;
    return { selected: new Set(leaves), anchorSid: leaves[0] };
  }

  if (intent === 'toggle') {
    const allSelected = leaves.every((sid) => current.selected.has(sid));
    const next = new Set(current.selected);
    for (const sid of leaves) {
      if (allSelected) next.delete(sid);
      else next.add(sid);
    }
    return { selected: next, anchorSid: leaves[0] };
  }

  // Range with nothing to extend from selects the block itself.
  if (current.anchorSid === null) {
    const base = intent === 'range-add' ? current.selected : [];
    return { selected: new Set([...base, ...leaves]), anchorSid: leaves[0] };
  }

  const order = orderedSids(doc, registry);
  return selectRange(order, current, leaves[leaves.length - 1], intent === 'range-add');
}
