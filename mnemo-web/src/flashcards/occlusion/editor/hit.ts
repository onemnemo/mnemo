import { intersects, rectBetween as between } from "@/mindmap/interaction/marquee"

import type { OcclusionDocument, OcclusionMask } from "../../facts/occlusion"
import type { Box } from "../geometry"
import { drawOrder } from "./cards"
import type { Point } from "./shape"

/** A pointer position as a fraction of the image, from pixels in the pane and the image's frame. */
export function pointToImage(client: { x: number; y: number }, pane: { left: number; top: number }, frame: Box): Point {
  if (frame.w <= 0 || frame.h <= 0) return [0, 0]
  return [(client.x - pane.left - frame.x) / frame.w, (client.y - pane.top - frame.y) / frame.h]
}

function insidePolygon(points: readonly Point[], [px, py]: Point): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Whether a point (image fractions) is on the mask's shape. */
export function maskContains(mask: OcclusionMask, point: Point): boolean {
  const [px, py] = point
  if (mask.shape === "polygon" && mask.points) return insidePolygon(mask.points, point)
  if (px < mask.x || px > mask.x + mask.w || py < mask.y || py > mask.y + mask.h) return false
  if (mask.shape === "rect") return true

  const rx = mask.w / 2
  const ry = mask.h / 2
  const dx = (px - (mask.x + rx)) / rx
  const dy = (py - (mask.y + ry)) / ry
  return dx * dx + dy * dy <= 1
}

/** The topmost of masks listed in draw order (last is on top) under a point. */
export function hitOrdered(ordered: readonly OcclusionMask[], point: Point): OcclusionMask | null {
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (maskContains(ordered[i], point)) return ordered[i]
  }
  return null
}

/** The topmost mask under a point. */
export function hitMask(document: OcclusionDocument, point: Point): OcclusionMask | null {
  return hitOrdered(drawOrder(document), point)
}

/** A rectangle between two points, in image fractions. */
export function rectBetween(a: Point, b: Point): Box {
  const rect = between({ x: a[0], y: a[1] }, { x: b[0], y: b[1] })
  return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
}

/** Ids of the masks a rubber band touches. Like the mind map's, it catches anything it overlaps. */
export function masksInRect(document: OcclusionDocument, rect: Box): string[] {
  const band = { x: rect.x, y: rect.y, width: rect.w, height: rect.h }
  return document.masks
    .filter((mask) => intersects(band, { x: mask.x, y: mask.y, width: mask.w, height: mask.h }))
    .map((mask) => mask.id)
}
