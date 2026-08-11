/**
 * The rubber-band rectangle, in canvas space.
 *
 * It catches anything it touches rather than only what it fully contains. Containment reads as the
 * stricter rule but it is the one that fails on the case people actually use a marquee for, which is
 * sweeping across a row of siblings: the sweep has to be taller than every node in it or the row
 * comes back empty, and nothing on screen says why.
 */

import type { Point } from "../model/scene"

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Normalized, so dragging up and left is the same rectangle as dragging down and right. */
export function rectBetween(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

export function intersects(rect: Rect, box: Rect): boolean {
  return (
    rect.x < box.x + box.width &&
    box.x < rect.x + rect.width &&
    rect.y < box.y + box.height &&
    box.y < rect.y + rect.height
  )
}

export function elementsInRect(
  rect: Rect,
  elements: readonly { readonly id: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number }[],
): string[] {
  const hits: string[] = []
  for (const element of elements) {
    if (intersects(rect, element)) {
      hits.push(element.id)
    }
  }
  return hits
}
