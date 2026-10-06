import { roundCoordinate, type OcclusionMask } from "../../facts/occlusion"
import type { Box } from "../geometry"

export type Point = [number, number]

export function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

/** The bounding box of a set of points. */
export function boundsOf(points: readonly Point[]): Box {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** A polygon with its points moved and its box taken from them, rounded to the stored precision. */
export function withPoints(mask: OcclusionMask, points: readonly Point[]): OcclusionMask {
  const rounded = points.map(([x, y]): Point => [roundCoordinate(clamp01(x)), roundCoordinate(clamp01(y))])
  const box = boundsOf(rounded)
  return { ...mask, points: rounded, x: roundCoordinate(box.x), y: roundCoordinate(box.y), w: roundCoordinate(box.w), h: roundCoordinate(box.h) }
}

/** A box rounded to the stored precision and kept inside the image after rounding. */
export function fitBox(box: Box): Box {
  const x = roundCoordinate(clamp01(box.x))
  const y = roundCoordinate(clamp01(box.y))
  return {
    x,
    y,
    w: Math.min(roundCoordinate(box.w), roundCoordinate(1 - x)),
    h: Math.min(roundCoordinate(box.h), roundCoordinate(1 - y)),
  }
}

/** A mask with its box set to `box`; a polygon's points are carried along by the box's offset and scale. */
export function withBox(mask: OcclusionMask, box: Box): OcclusionMask {
  const next = { ...mask, ...fitBox(box) }
  if (mask.shape !== "polygon" || !mask.points) return next

  const sx = mask.w > 0 ? box.w / mask.w : 1
  const sy = mask.h > 0 ? box.h / mask.h : 1
  const points = mask.points.map(([px, py]): Point => [box.x + (px - mask.x) * sx, box.y + (py - mask.y) * sy])
  return withPoints(next, points)
}

/** A mask shifted by a delta in image fractions. Not clamped; callers clamp the whole selection. */
export function shifted(mask: OcclusionMask, dx: number, dy: number): OcclusionMask {
  if (mask.shape === "polygon" && mask.points) {
    return withPoints(mask, mask.points.map(([px, py]): Point => [px + dx, py + dy]))
  }
  return { ...mask, x: roundCoordinate(mask.x + dx), y: roundCoordinate(mask.y + dy) }
}

/** The union box of several masks. */
export function unionBox(masks: readonly Pick<OcclusionMask, "x" | "y" | "w" | "h">[]): Box {
  const x = Math.min(...masks.map((m) => m.x))
  const y = Math.min(...masks.map((m) => m.y))
  const right = Math.max(...masks.map((m) => m.x + m.w))
  const bottom = Math.max(...masks.map((m) => m.y + m.h))
  return { x, y, w: right - x, h: bottom - y }
}
