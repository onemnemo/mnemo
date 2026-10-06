import type { ResizeDir } from "@/mindmap/interaction/resize"

import type { Box, Size } from "../geometry"

/** How close, in screen pixels, an edge or centre must be to snap. */
export const SNAP_PX = 6

const EPSILON = 1e-6

/** A line to draw while snapped. A vertical guide sits at `at` along x and runs from `from` to `to` in y. */
export interface Guide {
  axis: "x" | "y"
  at: number
  from: number
  to: number
}

export interface SnapMove {
  dx: number
  dy: number
  guides: Guide[]
}

function lines(start: number, extent: number): number[] {
  return [start, start + extent / 2, start + extent]
}

/** The smallest correction that brings any of `own` onto any of `targets` within the threshold. */
function nearest(own: readonly number[], targets: readonly number[], pixels: number, threshold: number): number | null {
  let best: number | null = null
  let bestPx = threshold + EPSILON
  for (const mine of own) {
    for (const theirs of targets) {
      const px = Math.abs(theirs - mine) * pixels
      if (px < bestPx) {
        bestPx = px
        best = theirs - mine
      }
    }
  }
  return best
}

function guidesFor(box: Box, others: readonly Box[], snappedX: boolean, snappedY: boolean): Guide[] {
  const guides: Guide[] = []
  const add = (guide: Guide) => {
    const key = `${guide.axis}:${Math.round(guide.at / EPSILON)}`
    const index = guides.findIndex((g) => `${g.axis}:${Math.round(g.at / EPSILON)}` === key)
    if (index >= 0) {
      guides[index] = { ...guides[index], from: Math.min(guides[index].from, guide.from), to: Math.max(guides[index].to, guide.to) }
    } else {
      guides.push(guide)
    }
  }

  for (const other of others) {
    if (snappedX) {
      for (const mine of lines(box.x, box.w)) {
        if (lines(other.x, other.w).some((theirs) => Math.abs(theirs - mine) < EPSILON)) {
          add({ axis: "x", at: mine, from: Math.min(box.y, other.y), to: Math.max(box.y + box.h, other.y + other.h) })
        }
      }
    }
    if (snappedY) {
      for (const mine of lines(box.y, box.h)) {
        if (lines(other.y, other.h).some((theirs) => Math.abs(theirs - mine) < EPSILON)) {
          add({ axis: "y", at: mine, from: Math.min(box.x, other.x), to: Math.max(box.x + box.w, other.x + other.w) })
        }
      }
    }
  }
  return guides
}

/**
 * Corrects a dragged box so its edges or centre land on other boxes', and returns the guides to
 * draw. Boxes are image fractions; `size` is the displayed image in pixels, the unit of the threshold.
 */
export function snapMove(box: Box, others: readonly Box[], size: Size, threshold = SNAP_PX): SnapMove {
  if (size.w <= 0 || size.h <= 0 || others.length === 0) return { dx: 0, dy: 0, guides: [] }

  const dx = nearest(lines(box.x, box.w), others.flatMap((o) => lines(o.x, o.w)), size.w, threshold)
  const dy = nearest(lines(box.y, box.h), others.flatMap((o) => lines(o.y, o.h)), size.h, threshold)
  const snapped = { x: box.x + (dx ?? 0), y: box.y + (dy ?? 0), w: box.w, h: box.h }
  return { dx: dx ?? 0, dy: dy ?? 0, guides: guidesFor(snapped, others, dx !== null, dy !== null) }
}

export interface SnapResize {
  box: Box
  guides: Guide[]
}

/** Snaps only the edges a resize handle is moving, leaving the opposite edges where they are. */
export function snapResize(box: Box, dir: ResizeDir, others: readonly Box[], size: Size, threshold = SNAP_PX): SnapResize {
  if (size.w <= 0 || size.h <= 0 || others.length === 0) return { box, guides: [] }

  let { x, y, w, h } = box
  let snappedX = false
  let snappedY = false
  const xTargets = others.flatMap((o) => lines(o.x, o.w))
  const yTargets = others.flatMap((o) => lines(o.y, o.h))

  if (dir.includes("e")) {
    const fix = nearest([x + w], xTargets, size.w, threshold)
    if (fix !== null) {
      w += fix
      snappedX = true
    }
  } else if (dir.includes("w")) {
    const fix = nearest([x], xTargets, size.w, threshold)
    if (fix !== null) {
      x += fix
      w -= fix
      snappedX = true
    }
  }
  if (dir.includes("s")) {
    const fix = nearest([y + h], yTargets, size.h, threshold)
    if (fix !== null) {
      h += fix
      snappedY = true
    }
  } else if (dir.includes("n")) {
    const fix = nearest([y], yTargets, size.h, threshold)
    if (fix !== null) {
      y += fix
      h -= fix
      snappedY = true
    }
  }

  const snapped = { x, y, w: Math.max(w, 0), h: Math.max(h, 0) }
  return { box: snapped, guides: guidesFor(snapped, others, snappedX, snappedY) }
}
