import type { CSSProperties } from "react"

export type Ring = "none" | "hover" | "selected"

const RING_WIDTH = 1.25
const SELECTED_RING = `0 0 0 ${RING_WIDTH}px var(--accent-paper)`
const HOVER_RING = `0 0 0 ${RING_WIDTH}px color-mix(in srgb, var(--accent-paper) 42%, transparent)`

function ringShadow(ring: Ring): string | null {
  return ring === "selected" ? SELECTED_RING : ring === "hover" ? HOVER_RING : null
}

/** Fill of a covered mask, or of one seen through when masks are shown. */
export function maskFill(showMasks: boolean): string {
  return showMasks ? "color-mix(in srgb, var(--mask) 25%, transparent)" : "color-mix(in srgb, var(--mask) 86%, transparent)"
}

/** The box a rectangle or ellipse is drawn with. */
export function boxStyle(ellipse: boolean, ring: Ring, showMasks: boolean): CSSProperties {
  const edge = showMasks ? "inset 0 0 0 1px var(--paper-line)" : "inset 0 0 0 1px var(--mask-edge)"
  const outer = ringShadow(ring)
  return {
    background: maskFill(showMasks),
    borderRadius: ellipse ? "50%" : 3,
    boxShadow: outer ? `${edge}, ${outer}` : edge,
  }
}

/** The fill and edge of a polygon, which is drawn as SVG. */
export function polygonStyle(showMasks: boolean): CSSProperties {
  return {
    fill: maskFill(showMasks),
    stroke: showMasks ? "var(--paper-line)" : "var(--mask-edge)",
    strokeWidth: 1,
    vectorEffect: "non-scaling-stroke",
  }
}

/** The ring around a selected or hovered polygon. */
export function polygonRing(ring: Exclude<Ring, "none">): CSSProperties {
  return {
    fill: "none",
    stroke: ring === "selected" ? "var(--accent-paper)" : "color-mix(in srgb, var(--accent-paper) 42%, transparent)",
    strokeWidth: RING_WIDTH * 2,
    vectorEffect: "non-scaling-stroke",
    strokeLinejoin: "round",
  }
}
