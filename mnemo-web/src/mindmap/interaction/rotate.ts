/** Degrees are clockwise on screen, matching CSS rotation. */

import type { Point } from "../model/scene"
import { centreOf, rotateVector } from "../scene/element-geometry"
import { resizeBox, type ResizeBox, type ResizeDir } from "./resize"

export { centreOf, rotatedBounds, rotateVector } from "../scene/element-geometry"

export function angleAt(centre: Point, point: Point): number {
  return (Math.atan2(point.y - centre.y, point.x - centre.x) * 180) / Math.PI
}

export function normalizeDeg(degrees: number): number {
  // Avoid persisting JavaScript's negative zero.
  const wrapped = degrees % 360
  return (wrapped < 0 ? wrapped + 360 : wrapped) + 0
}

export function snapDeg(degrees: number, step = 15): number {
  return normalizeDeg(Math.round(degrees / step) * step)
}

/** Resizes in local axes, then restores the opposite anchor in canvas space. */
export function resizeRotated(
  origin: ResizeBox,
  dir: ResizeDir,
  dx: number,
  dy: number,
  degrees: number,
  lockAspect = false,
): ResizeBox {
  if (!degrees) {
    return resizeBox(origin, dir, dx, dy, lockAspect)
  }
  const local = rotateVector(dx, dy, -degrees)
  const resized = resizeBox(origin, dir, local.x, local.y, lockAspect)

  const ax = dir.endsWith("w") ? 1 : dir.endsWith("e") ? 0 : 0.5
  const ay = dir.startsWith("n") ? 1 : dir.startsWith("s") ? 0 : 0.5

  const before = cornerInCanvas(origin, ax, ay, degrees)
  const after = cornerInCanvas(resized, ax, ay, degrees)
  return {
    ...resized,
    x: resized.x + before.x - after.x,
    y: resized.y + before.y - after.y,
  }
}

export function cornerInCanvas(box: ResizeBox, fx: number, fy: number, degrees: number): Point {
  const centre = centreOf(box)
  const turned = rotateVector((fx - 0.5) * box.width, (fy - 0.5) * box.height, degrees)
  return { x: centre.x + turned.x, y: centre.y + turned.y }
}
