/**
 * Locate the block a position sits in, at any nesting depth.
 *
 * `topLevelBlockAt` answers "which document child holds this position" and is
 * the right unit for the reorder, whose drop gaps are top-level boundaries. The
 * gutter, the grip selection and the marquee need a finer unit: inside a
 * two-column row, the hovered *cell child* is the block the user means, the same
 * unit the desktop editor gives its own grip (every EditableBlock in a column
 * has one) and its Mode-2 selection (BlockHierarchy enumerates cell children in
 * place of the row).
 *
 * The resolution walks the resolved position's ancestor path and keeps the
 * deepest node that is a registry block but not a structural container. A
 * position that sits only in containers (the row's padding, a cell's own line)
 * falls back to the top-level block, so hovering the scenery still offers the
 * row itself as the unit.
 */

import type { Node as PMNode } from 'prosemirror-model';

import type { BlockRegistry } from '../registry/build';
import { containerBlockNames } from '../blocks/shared';

export interface LocatedDeepBlock {
  /** Position just before the block node. */
  readonly pos: number;
  readonly node: PMNode;
  /** Resolve depth of the block; 1 is a top-level block. */
  readonly depth: number;
  /** The top-level ancestor: the block itself when `depth` is 1. */
  readonly topPos: number;
  readonly topIndex: number;
  readonly topNode: PMNode;
}

export function deepestBlockAt(doc: PMNode, registry: BlockRegistry, pos: number): LocatedDeepBlock | null {
  if (doc.childCount === 0) return null;

  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(clamped);

  // Same boundary rule as topLevelBlockAt: a position between blocks belongs to
  // the child after it, clamped so the document's tail maps to the last block.
  const topIndex = Math.min($pos.index(0), doc.childCount - 1);
  let topPos = 0;
  for (let i = 0; i < topIndex; i++) topPos += doc.child(i).nodeSize;
  const topNode = doc.child(topIndex);

  let found: { pos: number; node: PMNode; depth: number } | null = null;
  for (let depth = 1; depth <= $pos.depth; depth++) {
    const node = $pos.node(depth);
    if (!registry.byNodeName.has(node.type.name)) continue;
    if (containerBlockNames.has(node.type.name)) continue;
    found = { pos: $pos.before(depth), node, depth };
  }

  // A path of containers only means the position sits *between* a container's
  // children - `posAtDOM` answers exactly that for the non-editable face of a
  // NodeView, an image in a cell being the everyday case. The child the
  // position points at is the block meant, the same boundary rule the top
  // level applies through index().
  if (!found && $pos.depth > 0) {
    const parent = $pos.node($pos.depth);
    if (parent.childCount > 0) {
      const index = Math.min($pos.index($pos.depth), parent.childCount - 1);
      const child = parent.child(index);
      if (registry.byNodeName.has(child.type.name) && !containerBlockNames.has(child.type.name)) {
        found = { pos: $pos.posAtIndex(index, $pos.depth), node: child, depth: $pos.depth + 1 };
      }
    }
  }

  if (!found) return { pos: topPos, node: topNode, depth: 1, topPos, topIndex, topNode };
  return { ...found, topPos, topIndex, topNode };
}
