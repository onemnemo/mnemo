import type { ArrowCap } from "../model/document"
import type { Point } from "../model/scene"

/**
 * The arrowhead in its own units, tip at 8,4 pointing along +x, scaled by the line's weight.
 *
 * The tip is the reference point, so it lands exactly on the line's endpoint. The stroke itself stops
 * short under the head (see `capInset`), because the head narrows to nothing and a stroke running on
 * to the tip shows beside and past it.
 */
export const ARROW_MARKER = {
  refX: 8,
  refY: 4,
  scale: 5 / 8,
  points: [
    [0, 0.5],
    [8, 4],
    [0, 7.5],
  ],
} as const

export const DOT_MARKER = {
  radius: 3.2,
  scale: 4 / 8,
} as const

/** How far, in arrowhead units, the stroke runs on past the head's base so no seam shows there. */
const ARROW_OVERLAP = 1

/** One drawn cap: where the end is and which way the line travels there. */
export interface CapDraw {
  readonly kind: "arrow" | "dot"
  readonly x: number
  readonly y: number
  readonly angle: number
}

const ARROW_RADIUS = Math.max(
  ...ARROW_MARKER.points.map(([x, y]) => Math.hypot(x - ARROW_MARKER.refX, y - ARROW_MARKER.refY)),
) * ARROW_MARKER.scale

export function capRadiusFactor(cap: ArrowCap): number {
  if (cap === "arrow") return ARROW_RADIUS
  if (cap === "dot") return DOT_MARKER.radius * DOT_MARKER.scale
  return 0.5
}

export function hasCap(cap: ArrowCap | undefined): cap is "arrow" | "dot" {
  return cap === "arrow" || cap === "dot"
}

/** How far back from its end a stroke of this weight stops for this cap. */
export function capInset(cap: ArrowCap | undefined, width: number): number {
  if (cap !== "arrow") return 0
  return (ARROW_MARKER.refX - ARROW_OVERLAP) * ARROW_MARKER.scale * width
}

export function dotRadius(width: number): number {
  return DOT_MARKER.radius * DOT_MARKER.scale * width
}

/** Base corner, tip, base corner. */
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

/** Every cap of one line as one filled SVG path, so a line owns at most one extra element. */
export function capsPathData(caps: readonly CapDraw[], width: number): string {
  return caps
    .map((cap) => {
      if (cap.kind === "dot") {
        const r = dotRadius(width)
        const arc = `A${n(r)},${n(r)} 0 1 0`
        return `M${n(cap.x + r)},${n(cap.y)} ${arc} ${n(cap.x - r)},${n(cap.y)} ${arc} ${n(cap.x + r)},${n(cap.y)} Z`
      }
      const [left, tip, right] = arrowCapPoints(cap, width)
      return `M${n(tip.x)},${n(tip.y)} L${n(right.x)},${n(right.y)} L${n(left.x)},${n(left.y)} Z`
    })
    .join(" ")
}

function n(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}
