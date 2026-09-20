import type { ArrowCap } from "../model/document"

export const LINE_HIT_WIDTH = 14

export function capMarker(cap: ArrowCap | undefined): string | undefined {
  if (cap === "arrow") return "url(#mm-cap-arrow)"
  if (cap === "dot") return "url(#mm-cap-dot)"
  return undefined
}

export function bendRingLook(bent: boolean): { fill: string; fillOpacity: number } {
  return bent ? { fill: "var(--canvas)", fillOpacity: 1 } : { fill: "var(--accent)", fillOpacity: 0.35 }
}
