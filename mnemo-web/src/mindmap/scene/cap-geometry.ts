import type { ArrowCap } from "../model/document"
import type { Point } from "../model/scene"

export const ARROW_MARKER = {
  size: 8,
  refX: 7,
  refY: 4,
  scale: 5 / 8,
  path: "M0 0.5 L8 4 L0 7.5 Z",
  points: [
    [0, 0.5],
    [8, 4],
    [0, 7.5],
  ],
} as const

export const DOT_MARKER = {
  size: 8,
  refX: 4,
  refY: 4,
  radius: 3.2,
  scale: 4 / 8,
} as const

const ARROW_RADIUS = Math.max(
  ...ARROW_MARKER.points.map(([x, y]) => Math.hypot(x - ARROW_MARKER.refX, y - ARROW_MARKER.refY)),
) * ARROW_MARKER.scale

export function capRadiusFactor(cap: ArrowCap): number {
  if (cap === "arrow") return ARROW_RADIUS
  if (cap === "dot") return DOT_MARKER.radius * DOT_MARKER.scale
  return 0.5
}

export function arrowCapPoints(at: Point & { readonly angle: number }, width: number): readonly Point[] {
  const scale = width * ARROW_MARKER.scale
  const cosine = Math.cos(at.angle)
  const sine = Math.sin(at.angle)
  return ARROW_MARKER.points.map(([markerX, markerY]) => {
    const x = (markerX - ARROW_MARKER.refX) * scale
    const y = (markerY - ARROW_MARKER.refY) * scale
    return {
      x: at.x + x * cosine - y * sine,
      y: at.y + x * sine + y * cosine,
    }
  })
}
