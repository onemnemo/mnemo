/**
 * Where a tooltip sits next to the thing it describes.
 *
 * Pure geometry, kept apart from the host so the rules that actually go wrong (an edge
 * flip, a bar centred under the last button on the right) are testable without a DOM.
 */

export type TooltipSide = "top" | "bottom" | "left" | "right"

export interface Size {
  readonly width: number
  readonly height: number
}

export interface Rect extends Size {
  readonly x: number
  readonly y: number
}

export interface PlaceOptions {
  /** Gap between the anchor and the tooltip. */
  readonly offset: number
  /** Closest the tooltip may come to a viewport edge. */
  readonly padding: number
}

export interface Placement {
  readonly x: number
  readonly y: number
  /** The side actually used, which is the requested one unless it had to flip. */
  readonly side: TooltipSide
}

const OPPOSITE: Readonly<Record<TooltipSide, TooltipSide>> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
}

function isVertical(side: TooltipSide): boolean {
  return side === "top" || side === "bottom"
}

/** The coordinate along the side's own axis: the top for a vertical side, the left for a horizontal one. */
function mainAxis(anchor: Rect, tip: Size, side: TooltipSide, offset: number): number {
  switch (side) {
    case "top":
      return anchor.y - tip.height - offset
    case "bottom":
      return anchor.y + anchor.height + offset
    case "left":
      return anchor.x - tip.width - offset
    case "right":
      return anchor.x + anchor.width + offset
  }
}

function fits(anchor: Rect, tip: Size, viewport: Size, side: TooltipSide, options: PlaceOptions): boolean {
  const start = mainAxis(anchor, tip, side, options.offset)
  const extent = isVertical(side) ? tip.height : tip.width
  const limit = isVertical(side) ? viewport.height : viewport.width
  return start >= options.padding && start + extent <= limit - options.padding
}

function clamp(value: number, min: number, max: number): number {
  // max first: on a viewport too small for the tooltip the low edge is the one to keep.
  return Math.max(min, Math.min(value, max))
}

/**
 * Places the tooltip on the requested side, flipping to the opposite one when it does not
 * fit and staying on screen either way.
 *
 * Being on screen beats being on the requested side, and both beat sitting clear of the
 * anchor: a hint clamped over the corner of its own button is still readable, one that
 * ran off the window is not.
 */
export function placeTooltip(
  anchor: Rect,
  tip: Size,
  viewport: Size,
  side: TooltipSide,
  options: PlaceOptions,
): Placement {
  const flipped = OPPOSITE[side]
  const chosen = fits(anchor, tip, viewport, side, options) || !fits(anchor, tip, viewport, flipped, options)
    ? side
    : flipped

  const main = mainAxis(anchor, tip, chosen, options.offset)
  const { padding } = options

  if (isVertical(chosen)) {
    const centred = anchor.x + anchor.width / 2 - tip.width / 2
    return {
      x: clamp(centred, padding, viewport.width - tip.width - padding),
      y: clamp(main, padding, viewport.height - tip.height - padding),
      side: chosen,
    }
  }

  const centred = anchor.y + anchor.height / 2 - tip.height / 2
  return {
    x: clamp(main, padding, viewport.width - tip.width - padding),
    y: clamp(centred, padding, viewport.height - tip.height - padding),
    side: chosen,
  }
}
