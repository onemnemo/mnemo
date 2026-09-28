/**
 * The free-hand loop, in canvas space. It catches anything it touches, the same rule the rectangle
 * uses, and is closed from its last point back to its first for a let-go that falls short.
 */

import type { Point } from "../model/scene"
import type { Rect } from "./marquee"

/**
 * Nonzero winding rather than even-odd, so a node circled twice is inside twice rather than outside,
 * and so the hit test agrees with the loop as it is drawn.
 */
export function pointInLoop(point: Point, loop: readonly Point[]): boolean {
  let winding = 0
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % loop.length]
    const side = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y)
    if (a.y <= point.y) {
      if (b.y > point.y && side > 0) winding++
    } else if (b.y <= point.y && side < 0) {
      winding--
    }
  }
  return winding !== 0
}

const turn = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

const within = (value: number, a: number, b: number) => value >= Math.min(a, b) && value <= Math.max(a, b)

/** Touching counts, a shared end or a stretch run along the same line included. */
function segmentsMeet(p: Point, q: Point, r: Point, s: Point): boolean {
  const d1 = turn(r, s, p)
  const d2 = turn(r, s, q)
  const d3 = turn(p, q, r)
  const d4 = turn(p, q, s)
  if (d1 * d2 < 0 && d3 * d4 < 0) {
    return true
  }
  const on = (a: Point, b: Point, c: Point, d: number) => d === 0 && within(c.x, a.x, b.x) && within(c.y, a.y, b.y)
  return on(r, s, p, d1) || on(r, s, q, d2) || on(p, q, r, d3) || on(p, q, s, d4)
}

export function loopTouches(loop: readonly Point[], box: Rect): boolean {
  if (loop.length < 3) {
    return false
  }
  const corners: Point[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ]
  if (corners.some((corner) => pointInLoop(corner, loop))) {
    return true
  }
  const inBox = (p: Point) => within(p.x, box.x, box.x + box.width) && within(p.y, box.y, box.y + box.height)
  if (loop.some(inBox)) {
    return true
  }
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % loop.length]
    for (let k = 0; k < 4; k++) {
      if (segmentsMeet(a, b, corners[k], corners[(k + 1) % 4])) {
        return true
      }
    }
  }
  return false
}

export function loopBounds(loop: readonly Point[]): Rect {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const point of loop) {
    left = Math.min(left, point.x)
    top = Math.min(top, point.y)
    right = Math.max(right, point.x)
    bottom = Math.max(bottom, point.y)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function elementsInLoop<T extends { readonly id: string } & Rect>(
  loop: readonly Point[],
  elements: readonly T[],
  boundsOf: (element: T) => Rect = (element) => element,
): string[] {
  // Most of a large map is nowhere near the loop, and a box outside its bounds cannot touch it.
  const reach = loopBounds(loop)
  return elements
    .filter((element) => {
      const box = boundsOf(element)
      return (
        box.x <= reach.x + reach.width &&
        reach.x <= box.x + box.width &&
        box.y <= reach.y + reach.height &&
        reach.y <= box.y + box.height &&
        loopTouches(loop, box)
      )
    })
    .map((element) => element.id)
}
