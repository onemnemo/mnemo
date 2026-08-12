/**
 * Aligning and distributing a handful of free elements, as geometry alone.
 *
 * Nothing here knows about the document, the scene or React: it takes boxes and returns the new
 * top-left of the ones that actually move. That is what lets the caller turn the answer straight into
 * a batch of `move` ops, and it is why re-pressing the same button is a no-op rather than a second
 * undo step with nothing in it.
 *
 * Align snaps an edge or a centre to the extent of the whole selection. Distribute equalises the gaps
 * between the sorted boxes with the outer two held where they are, which is the only reading of
 * "spread these out evenly" that does not also move the thing you lined them up against.
 */

export type AlignOp =
  | "left"
  | "centerHorizontal"
  | "right"
  | "top"
  | "middleVertical"
  | "bottom"
  | "distributeHorizontal"
  | "distributeVertical"

/** An element's axis-aligned box, which is the only thing the maths needs to know about it. */
export interface AlignBox {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Where an element the operation moved should end up. */
export interface AlignMove {
  readonly id: string
  readonly x: number
  readonly y: number
}

/** Below this a box counts as already in place, so floating-point noise does not become an edit. */
const EPSILON = 1e-6

/** Nothing to line up against with fewer than two. */
export const ALIGN_MIN = 2

/** With two there is nothing between the anchors to space out. */
export const DISTRIBUTE_MIN = 3

export function computeAlign(op: AlignOp, boxes: readonly AlignBox[]): AlignMove[] {
  if (boxes.length < ALIGN_MIN) {
    return []
  }

  switch (op) {
    case "left": {
      const edge = min(boxes, (box) => box.x)
      return alignHorizontal(boxes, () => edge)
    }
    case "right": {
      const edge = max(boxes, (box) => box.x + box.width)
      return alignHorizontal(boxes, (box) => edge - box.width)
    }
    case "centerHorizontal": {
      const centre = (min(boxes, (box) => box.x) + max(boxes, (box) => box.x + box.width)) / 2
      return alignHorizontal(boxes, (box) => centre - box.width / 2)
    }
    case "top": {
      const edge = min(boxes, (box) => box.y)
      return alignVertical(boxes, () => edge)
    }
    case "bottom": {
      const edge = max(boxes, (box) => box.y + box.height)
      return alignVertical(boxes, (box) => edge - box.height)
    }
    case "middleVertical": {
      const centre = (min(boxes, (box) => box.y) + max(boxes, (box) => box.y + box.height)) / 2
      return alignVertical(boxes, (box) => centre - box.height / 2)
    }
    case "distributeHorizontal":
      return distribute(boxes, HORIZONTAL)
    case "distributeVertical":
      return distribute(boxes, VERTICAL)
  }
}

function alignHorizontal(boxes: readonly AlignBox[], to: (box: AlignBox) => number): AlignMove[] {
  const moves: AlignMove[] = []
  for (const box of boxes) {
    const x = to(box)
    if (Math.abs(x - box.x) > EPSILON) {
      moves.push({ id: box.id, x, y: box.y })
    }
  }
  return moves
}

function alignVertical(boxes: readonly AlignBox[], to: (box: AlignBox) => number): AlignMove[] {
  const moves: AlignMove[] = []
  for (const box of boxes) {
    const y = to(box)
    if (Math.abs(y - box.y) > EPSILON) {
      moves.push({ id: box.id, x: box.x, y })
    }
  }
  return moves
}

/**
 * The one axis a distribute works along, so the horizontal and vertical cases are the same walk.
 *
 * They differ only in which coordinate is the one being spread and which is left alone, and writing
 * that walk twice is how the two versions end up disagreeing about a tie.
 */
interface Axis {
  readonly start: (box: AlignBox) => number
  readonly extent: (box: AlignBox) => number
  readonly moved: (box: AlignBox, position: number) => AlignMove
}

const HORIZONTAL: Axis = {
  start: (box) => box.x,
  extent: (box) => box.width,
  moved: (box, position) => ({ id: box.id, x: position, y: box.y }),
}

const VERTICAL: Axis = {
  start: (box) => box.y,
  extent: (box) => box.height,
  moved: (box, position) => ({ id: box.id, x: box.x, y: position }),
}

/**
 * Even gaps between the sorted boxes, with the first and last left where they are.
 *
 * The gap can come out negative when the middle boxes are wider than the space between the anchors.
 * That is allowed: overlapping them evenly is still the answer to what was asked, and refusing would
 * leave the button dead for a selection that looks no different from one it works on.
 */
function distribute(boxes: readonly AlignBox[], axis: Axis): AlignMove[] {
  if (boxes.length < DISTRIBUTE_MIN) {
    return []
  }

  // The tie-break is by id so that two boxes at the same coordinate order the same way every time.
  // Without it the result would depend on the selection order, and pressing twice could shuffle them.
  const sorted = [...boxes].sort((a, b) => axis.start(a) - axis.start(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]

  let interior = 0
  for (let i = 1; i < sorted.length - 1; i += 1) {
    interior += axis.extent(sorted[i])
  }

  const free = axis.start(last) - (axis.start(first) + axis.extent(first))
  const gap = (free - interior) / (sorted.length - 1)

  const moves: AlignMove[] = []
  let cursor = axis.start(first) + axis.extent(first)
  for (let i = 1; i < sorted.length - 1; i += 1) {
    cursor += gap
    if (Math.abs(cursor - axis.start(sorted[i])) > EPSILON) {
      moves.push(axis.moved(sorted[i], cursor))
    }
    cursor += axis.extent(sorted[i])
  }
  return moves
}

function min(boxes: readonly AlignBox[], of: (box: AlignBox) => number): number {
  let found = Infinity
  for (const box of boxes) {
    const value = of(box)
    if (value < found) found = value
  }
  return found
}

function max(boxes: readonly AlignBox[], of: (box: AlignBox) => number): number {
  let found = -Infinity
  for (const box of boxes) {
    const value = of(box)
    if (value > found) found = value
  }
  return found
}
