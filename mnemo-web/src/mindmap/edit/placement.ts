/**
 * Where a newly created node goes.
 *
 * The desktop never needs this: it runs a layout engine after every edit, so a new child has no
 * position of its own until the engine gives it one. This port is freeform until Arrange, which is
 * what makes a map you can actually arrange by hand, and the price is that every new node has to be
 * put somewhere deliberately. Nothing puts it anywhere and it lands at the origin, on top of the
 * root, which is exactly what a map full of nodes stacked at one point looks like.
 *
 * The rules are the smallest ones that read as a mindmap rather than as a pile: a child sits beside
 * its parent on the side that branch is already growing, and a new sibling sits under the last one.
 */

import type { Point } from "../model/scene"

export interface PlacedBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

/** Clear of the parent's box, wide enough for a branch to be legible between them. */
const GAP_X = 72

/** Between siblings, tight enough that a branch reads as one group. */
const GAP_Y = 18

/**
 * A child of `parent`, given where the parent's own parent is and what children it already has.
 *
 * `grandparent` decides the side. A branch that grew leftward keeps growing leftward, because a
 * child that jumps to the other side of its parent crosses every line in the branch to get there.
 */
export function placeChild(
  parent: PlacedBox,
  grandparent: PlacedBox | null,
  siblings: readonly PlacedBox[],
  size: Size,
): Point {
  const direction = growthDirection(parent, grandparent)
  const x =
    direction > 0 ? parent.x + parent.width + GAP_X : parent.x - GAP_X - size.width

  if (siblings.length === 0) {
    // First child: level with the middle of the parent, so a single child sits on the branch rather
    // than under it.
    return { x, y: Math.round(parent.y + parent.height / 2 - size.height / 2) }
  }

  let lowest = -Infinity
  for (const sibling of siblings) {
    lowest = Math.max(lowest, sibling.y + sibling.height)
  }
  return { x, y: Math.round(lowest + GAP_Y) }
}

/**
 * Which way this branch grows: away from the grandparent, or rightward when there is none.
 *
 * Zero would mean the parent sits exactly above or below its own parent, which a hand-arranged map
 * does have; rightward is the answer there for the same reason it is the answer at the root.
 */
function growthDirection(parent: PlacedBox, grandparent: PlacedBox | null): number {
  if (!grandparent) {
    return 1
  }
  const centre = parent.x + parent.width / 2
  const from = grandparent.x + grandparent.width / 2
  return centre < from ? -1 : 1
}

/** Somewhere clear of everything, for a node with no parent to hang off. */
export function placeLoose(existing: readonly PlacedBox[]): Point {
  if (existing.length === 0) {
    return { x: 0, y: 0 }
  }
  let right = -Infinity
  let top = Infinity
  for (const box of existing) {
    right = Math.max(right, box.x + box.width)
    top = Math.min(top, box.y)
  }
  return { x: Math.round(right + GAP_X), y: Math.round(top) }
}

export { GAP_X as PLACEMENT_GAP_X, GAP_Y as PLACEMENT_GAP_Y }
