/**
 * The radial toolkit's arithmetic: which sector a flick landed in, and what one wedge looks like.
 *
 * It is a module rather than three helpers inside the component because the ring hit-tests by angle
 * and not by the DOM. Nothing it draws takes pointer events, so what a release picks is decided
 * entirely here, and as plain functions the boundaries can be checked at every count instead of by
 * eye at six.
 */

export interface RadialSector {
  /** What the caller is handed back when this sector is picked. */
  id: string
  /** Looked up in the Mindmap namespace. The ring holds keys, not words. */
  labelKey: string
  /** A name AppIcon resolves. A sector without one is label only. */
  icon?: string
  /** Drawn in the danger tint instead of the neutral one. */
  danger?: boolean
}

/** The hole in the middle, which is where the hub sits. */
export const RADIAL_INNER = 30

export const RADIAL_OUTER = 78

/** Slack around the centre where no sector is chosen, so a twitch is not a pick. */
export const RADIAL_DEAD = 22

/**
 * Which sector a pointer offset from the centre is over, or null inside the dead zone.
 *
 * Zero is straight up and the angle grows clockwise, which is what the swapped arguments to atan2
 * and the negated dy buy. That puts sector 0 where the eye starts, so the order on screen is the
 * order in the array and a caller writes its sectors in the order it wants them read.
 */
export function sectorAt(dx: number, dy: number, count: number): number | null {
  if (count <= 0) return null
  if (Math.hypot(dx, dy) < RADIAL_DEAD) return null

  const step = (2 * Math.PI) / count
  const angle = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI)
  // Sectors are centred on their angle rather than starting at it, so half a step comes off before
  // the divide. The wrap at the end is for the top sector, whose first half lives just under a full
  // turn and would otherwise land one past the last index.
  return Math.floor((angle + step / 2) / step) % count
}

/** A point on the ring in the SVG's own frame, where zero is to the right and y grows downward. */
function polar(degrees: number, radius: number): string {
  const angle = (degrees * Math.PI) / 180
  return `${(Math.cos(angle) * radius).toFixed(2)} ${(Math.sin(angle) * radius).toFixed(2)}`
}

/**
 * The wedge outline for one sector, as SVG path data centred on 0,0.
 *
 * Out along the leading edge, round the outside, back in, and round the inside to close. The quarter
 * turn taken off the start is what puts sector 0 straight up, and the half step before it opens the
 * path on the sector's leading edge, so the edges drawn here are the same ones sectorAt buckets by
 * and the wedge lit under the pointer is always the one a release would pick.
 *
 * A ring needs at least two sectors. At one the sweep is a full turn, the arc's two ends land on the
 * same point, and SVG draws nothing.
 */
export function wedgePath(index: number, count: number): string {
  const sweep = 360 / count
  const start = index * sweep - sweep / 2 - 90
  const end = start + sweep
  const big = sweep > 180 ? 1 : 0

  return [
    `M${polar(start, RADIAL_INNER)}`,
    `L${polar(start, RADIAL_OUTER)}`,
    `A${RADIAL_OUTER} ${RADIAL_OUTER} 0 ${big} 1 ${polar(end, RADIAL_OUTER)}`,
    `L${polar(end, RADIAL_INNER)}`,
    `A${RADIAL_INNER} ${RADIAL_INNER} 0 ${big} 0 ${polar(start, RADIAL_INNER)}`,
    "Z",
  ].join(" ")
}
