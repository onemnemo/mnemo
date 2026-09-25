import type { ArrowCap } from "../model/document"

export const LINE_HIT_WIDTH = 14

/**
 * The marker id for one end of one line. Every capped end owns its marker, because a shared marker
 * can only follow its line's colour through `context-stroke`, which WebKit does not implement: there
 * every dot and arrowhead drew black.
 */
export function capMarkerId(owner: string, side: "start" | "end"): string {
  return `mm-cap-${side}-${owner.replace(/[^A-Za-z0-9_-]/g, "_")}`
}

export function hasCapMarker(cap: ArrowCap | undefined): cap is "arrow" | "dot" {
  return cap === "arrow" || cap === "dot"
}

export function capMarker(cap: ArrowCap | undefined, owner: string, side: "start" | "end"): string | undefined {
  return hasCapMarker(cap) ? `url(#${capMarkerId(owner, side)})` : undefined
}

export function bendRingLook(bent: boolean): { fill: string; fillOpacity: number } {
  return bent ? { fill: "var(--canvas)", fillOpacity: 1 } : { fill: "var(--accent)", fillOpacity: 0.35 }
}
