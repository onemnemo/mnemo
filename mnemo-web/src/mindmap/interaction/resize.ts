/**
 * What a resize handle does to a box.
 *
 * Pure geometry, in canvas space, so the whole of "which edges move, what stops them and what the
 * modifier means" can be pinned down without a pointer or a DOM. The controller only feeds it a
 * delta and writes what comes back.
 *
 * The rule the whole file follows: the edges the handle names move, and the ones it does not name
 * stay exactly where they were. That is what makes a resize feel anchored, and it is why a handle
 * on the left has to change the position as well as the width.
 */

export type ResizeDir = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"

export interface ResizeBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * How small a box may be dragged.
 *
 * A floor rather than a flip: pulling the right edge past the left stops the box at this width
 * instead of turning it inside out. Flipping is a drawing tool's answer, and in a map an element
 * that suddenly mirrors under the pointer reads as a bug rather than as a feature.
 */
export const MIN_ELEMENT_SIZE = 24

export function resizeBox(
  origin: ResizeBox,
  dir: ResizeDir,
  dx: number,
  dy: number,
  lockAspect = false,
): ResizeBox {
  const west = dir.endsWith("w")
  const east = dir.endsWith("e")
  const north = dir.startsWith("n")
  const south = dir.startsWith("s")

  let width = origin.width + (east ? dx : west ? -dx : 0)
  let height = origin.height + (south ? dy : north ? -dy : 0)

  // Corners only. A side handle is a one-axis change by definition, and locking it would move an
  // edge nobody is touching, so the modifier is simply ignored there.
  if (lockAspect && (east || west) && (north || south)) {
    const scale = Math.max(
      // Whichever axis the pointer pulled harder decides, so the box follows the hand instead of
      // fighting it when a diagonal drag is not quite diagonal.
      Math.abs(width / origin.width - 1) >= Math.abs(height / origin.height - 1)
        ? width / origin.width
        : height / origin.height,
      MIN_ELEMENT_SIZE / origin.width,
      MIN_ELEMENT_SIZE / origin.height,
    )
    width = origin.width * scale
    height = origin.height * scale
  } else {
    width = Math.max(width, MIN_ELEMENT_SIZE)
    height = Math.max(height, MIN_ELEMENT_SIZE)
  }

  return {
    // The opposite edge is the anchor, which is the same statement as "the edges not named stay put".
    x: west ? origin.x + origin.width - width : origin.x,
    y: north ? origin.y + origin.height - height : origin.y,
    width,
    height,
  }
}

/** True when a committed box would say anything the stored one does not already say. */
export function boxChanged(before: ResizeBox, after: ResizeBox): boolean {
  return (
    Math.round(before.x) !== Math.round(after.x) ||
    Math.round(before.y) !== Math.round(after.y) ||
    Math.round(before.width) !== Math.round(after.width) ||
    Math.round(before.height) !== Math.round(after.height)
  )
}
