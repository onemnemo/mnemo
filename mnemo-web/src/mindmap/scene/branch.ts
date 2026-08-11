/**
 * Reading and writing a branch's colour.
 *
 * A branch is a position, not a field. Nothing in the document says "this node is on the green
 * branch": the hierarchy walk seeds one branch per depth-1 child and everything below inherits it,
 * and the cascade only falls back to that structural colour when the element has no stroke of its
 * own. So the two halves of a colour control are asymmetric, and both live here.
 *
 * Reading is done off the resolved scene rather than off the stored overrides, so the control lights
 * the hue that is on screen whether it came from the walk or from somebody choosing one.
 *
 * Writing is a push down a subtree, because there is no branch to write to. Recolouring "this
 * branch" means finding the depth-1 ancestor and giving its whole subtree an explicit stroke.
 */

import type { SceneElement } from "../model/scene"
import type { Hierarchy, HierarchyNode } from "./hierarchy"

/** Palette hues resolve to this, so this is how one is recognised again. */
const BRANCH_VAR = /^var\(--branch-([1-8])\)$/

/**
 * The depth-1 ancestor whose subtree owns this node's colour.
 *
 * Null for a root, which has no branch of its own, and for anything that is not a node in the tree.
 * Recolouring from a root would be recolouring every branch at once, which is not what one swatch
 * on one node reads as.
 */
export function branchRootOf(hierarchy: Hierarchy, id: string): string | null {
  let node: HierarchyNode | undefined = hierarchy.byId.get(id)
  if (!node || node.depth < 1) {
    return null
  }
  while (node.depth > 1) {
    node = node.parentId ? hierarchy.byId.get(node.parentId) : undefined
    if (!node) {
      return null
    }
  }
  return node.id
}

/**
 * Which of the eight this node is drawn in, or null when its colour is not one of them.
 *
 * Null is a real answer: a map can carry a hand-written hex, and a template can turn branch colouring
 * off entirely. A control that guessed a slot in those cases would show a hue nothing on screen has.
 */
export function branchSwatchOf(element: SceneElement): number | null {
  const css = element.branchColor ?? element.stroke
  const found = css ? BRANCH_VAR.exec(css) : null
  return found ? Number(found[1]) : null
}
