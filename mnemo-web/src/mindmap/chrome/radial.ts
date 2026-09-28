/**
 * The radial ring's arithmetic. It hit-tests by angle rather than by the DOM, so what a release picks
 * is decided here. Angles are degrees clockwise from straight up, so sector 0 is where the eye starts.
 */

/** The hub's radius, which is also the dead zone: a release over it picks nothing. */
export const HUB_RADIUS = 48

export const RING_INNER = 54
export const RING_OUTER = 126

/** Past this the pointer is in sub-ring territory. */
export const RING_EDGE = RING_OUTER + 4

export const SUB_INNER = 134
export const SUB_OUTER = 194

/** How close to the pane's edge the main ring may come. Sub-rings may run off; the hub still names what they pick. */
const PANE_MARGIN = 8

/** Past this many selected, the scrim cuts nothing out: the dimmed canvas alone reads fine. */
export const MOST_CUTOUTS = 20

/** The hairline between wedges, and how round their corners are. */
export const WEDGE_GAP = 1.5
export const WEDGE_ROUND = 0.75

/** A sector as the hit test sees it: how many items its sub-ring holds, and whether it is off. */
export interface RingSlot {
  readonly subs: number
  readonly inert?: boolean
}

export interface RingHit {
  /** The main sector under the pointer, or null over the hub. */
  readonly hot: number | null
  /** The item in that sector's sub-ring, or null while the pointer is on the main ring. */
  readonly sub: number | null
}

export const NO_HIT: RingHit = { hot: null, sub: null }

function angleOf(dx: number, dy: number): number {
  return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360
}

/** The signed turn from `b` to `a`, in [-180, 180). */
function turn(a: number, b: number): number {
  return ((((a - b + 180) % 360) + 360) % 360) - 180
}

/** The angle one sub item spans. Short rings keep a fixed step, long ones share a fixed arc. */
export function subStep(items: number): number {
  return Math.min(30, 250 / items)
}

export function sectorAngle(index: number, count: number): number {
  return (index * 360) / count
}

export function subAngle(index: number, count: number, item: number, items: number): number {
  return sectorAngle(index, count) + (item - (items - 1) / 2) * subStep(items)
}

/** The main sector at an angle. Sectors are centred on their angle, so each spans half a step either side. */
export function sectorAt(angle: number, count: number): number {
  const step = 360 / count
  const normal = ((angle % 360) + 360) % 360
  return Math.floor((normal + step / 2) / step) % count
}

/** The item at an angle in sector `index`'s sub-ring, clamped to its ends; null outside the band plus half an item. */
function subAt(angle: number, index: number, slots: readonly RingSlot[]): number | null {
  const items = slots[index].subs
  if (items === 0) {
    return null
  }
  const step = subStep(items)
  const offset = turn(angle, sectorAngle(index, slots.length))
  if (Math.abs(offset) > (items * step) / 2 + step / 2) {
    return null
  }
  return Math.max(0, Math.min(items - 1, Math.round(offset / step + (items - 1) / 2)))
}

/**
 * What a pointer offset from the ring's centre is over. Past the rim, the sector already hot keeps
 * the pointer while it stays in its own band, so sliding along a wide sub-ring never flips the parent.
 */
export function ringHit(dx: number, dy: number, slots: readonly RingSlot[], previous: number | null): RingHit {
  const radius = Math.hypot(dx, dy)
  if (slots.length === 0 || radius < HUB_RADIUS) {
    return NO_HIT
  }
  const angle = angleOf(dx, dy)
  const main = sectorAt(angle, slots.length)
  if (radius <= RING_EDGE) {
    return slots[main].inert ? NO_HIT : { hot: main, sub: null }
  }

  if (previous !== null && previous < slots.length && !slots[previous].inert) {
    const kept = subAt(angle, previous, slots)
    if (kept !== null) {
      return { hot: previous, sub: kept }
    }
  }
  return slots[main].inert ? NO_HIT : { hot: main, sub: subAt(angle, main, slots) }
}

/** Where the ring's centre goes so the main ring and its margin fit the pane. A pane too small for it gets the ring centred. */
export function clampRing(at: { x: number; y: number }, pane: { width: number; height: number }) {
  const reach = RING_OUTER + PANE_MARGIN
  const clamp = (value: number, size: number) =>
    size < reach * 2 ? size / 2 : Math.min(Math.max(value, reach), size - reach)
  return { x: clamp(at.x, pane.width), y: clamp(at.y, pane.height) }
}

/** A point on the ring, centred on 0,0 with y growing downward. */
export function polar(degrees: number, radius: number): { x: number; y: number } {
  const angle = (degrees * Math.PI) / 180
  return { x: Math.sin(angle) * radius, y: -Math.cos(angle) * radius }
}

function point(degrees: number, radius: number): string {
  const { x, y } = polar(degrees, radius)
  return `${x.toFixed(2)} ${y.toFixed(2)}`
}

/**
 * One wedge from angle `from` to `to` between two radii, as SVG path data centred on 0,0.
 *
 * Inset by the rounding all round and by half the gap along both edges, so stroking it in its own
 * fill with round joins brings it back out to the band, rounds its corners, and leaves the gap.
 */
export function wedgePath(from: number, to: number, inner: number, outer: number, gap = WEDGE_GAP): string {
  const near = inner + WEDGE_ROUND
  const far = outer - WEDGE_ROUND
  // A fixed length, so a wider angle at the inner radius than at the outer.
  const pad = (radius: number) => (((gap / 2 + WEDGE_ROUND) / radius) * 180) / Math.PI
  const big = to - from > 180 ? 1 : 0
  return [
    `M${point(from + pad(far), far)}`,
    `A${far} ${far} 0 ${big} 1 ${point(to - pad(far), far)}`,
    `L${point(to - pad(near), near)}`,
    `A${near} ${near} 0 ${big} 0 ${point(from + pad(near), near)}`,
    "Z",
  ].join(" ")
}

/** A full annulus between two radii, for an even-odd fill. */
export function annulusPath(inner: number, outer: number): string {
  const circle = (r: number) => `M${-r} 0a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`
  return `${circle(outer)} ${circle(inner)}`
}
