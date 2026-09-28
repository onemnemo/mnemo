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
  /** The main sector under the pointer, or null over the hub. A dimmed one is hot only to be named. */
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

/** The angle one sub item spans. Short rings keep a fixed step; long ones share an arc that overlaps one neighbour a side. */
export function subStep(items: number): number {
  return Math.min(30, 135 / items)
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

/** How far off its own axis a sector's sub-ring still claims the pointer: its band plus half an item. */
function reach(items: number): number {
  const step = subStep(items)
  return (items * step) / 2 + step / 2
}

/** The item at an angle in sector `index`'s sub-ring, clamped to its ends. */
function subAt(angle: number, index: number, slots: readonly RingSlot[]): number {
  const items = slots[index].subs
  const step = subStep(items)
  const offset = turn(angle, sectorAngle(index, slots.length))
  return Math.max(0, Math.min(items - 1, Math.round(offset / step + (items - 1) / 2)))
}

/** A sector keeps the pointer after this long hot, if it has a sub-ring to keep it for. */
export const LATCH_DWELL = 120
/** A latched sector lets go when the pointer comes back this close to the hub. */
const LATCH_DROP_RADIUS = 60
/** Below this speed (px/ms) the pointer is choosing, not travelling, so a neighbour takes over at once. */
const SLOW = 0.35
/** Above this the pointer is travelling, so a neighbour it passes through never takes over. */
const FAST = 0.6
/** Between the two, a neighbour takes over once the pointer has been in it this long. */
export const HANDOVER_DWELL = 60

/** What the hit test carries between pointer events: the latched parent, handover and speed. */
export interface RingState {
  readonly hit: RingHit
  readonly latched: number | null
  readonly hotSince: number
  /** The sector hot before this one, which a fast throw may only be passing out of. */
  readonly before: number | null
  readonly candidate: number | null
  readonly candidateSince: number
  /** Smoothed pointer speed, px/ms. */
  readonly speed: number
  readonly last: { readonly x: number; readonly y: number; readonly t: number } | null
}

export const RING_START: RingState = {
  hit: NO_HIT,
  latched: null,
  hotSince: 0,
  before: null,
  candidate: null,
  candidateSince: 0,
  speed: 0,
  last: null,
}

/** The next state after the pointer moves to `dx`,`dy` from the centre at time `t` (ms). */
export function stepRing(state: RingState, dx: number, dy: number, t: number, slots: readonly RingSlot[]): RingState {
  const last = { x: dx, y: dy, t }
  const dt = state.last ? t - state.last.t : 0
  const speed =
    state.last && dt > 0 ? 0.6 * (Math.hypot(dx - state.last.x, dy - state.last.y) / dt) + 0.4 * state.speed : state.speed

  const radius = Math.hypot(dx, dy)
  if (slots.length === 0 || radius < HUB_RADIUS) {
    return { ...RING_START, speed, last }
  }

  const latchable = (index: number | null): index is number =>
    index !== null && index < slots.length && slots[index].subs > 0 && !slots[index].inert
  const angle = angleOf(dx, dy)
  const main = sectorAt(angle, slots.length)
  const previous = state.hit.hot

  let latched = state.latched
  if (latched === null && latchable(previous) && t - state.hotSince >= LATCH_DWELL) {
    latched = previous
  }
  if (
    latched !== null &&
    (radius < LATCH_DROP_RADIUS ||
      Math.abs(turn(angle, sectorAngle(latched, slots.length))) > reach(slots[latched].subs))
  ) {
    latched = null
  }

  let hot = main
  let candidate: number | null = null
  let candidateSince = state.candidateSince
  if (latched !== null && main !== latched && radius <= RING_EDGE) {
    candidate = main
    if (state.candidate !== main) {
      candidateSince = t
    }
    const handover = speed < SLOW || (speed <= FAST && t - candidateSince >= HANDOVER_DWELL)
    if (handover) {
      latched = null
      candidate = null
    } else {
      hot = latched
    }
  } else if (latched !== null) {
    hot = latched
  }

  if (latched === null && radius > RING_EDGE) {
    // Crossing the rim moments after leaving a sector, still inside its sub-ring's arc, is a throw
    // at one of its far items rather than a move to the neighbour.
    const hotFor = hot === previous ? t - state.hotSince : 0
    const before = state.before
    if (
      before !== null &&
      hot !== before &&
      hotFor < HANDOVER_DWELL &&
      speed >= SLOW &&
      latchable(before) &&
      Math.abs(turn(angle, sectorAngle(before, slots.length))) <= reach(slots[before].subs)
    ) {
      hot = before
    }
    if (latchable(hot)) {
      latched = hot
    }
  }
  const sub = radius > RING_EDGE && latchable(hot) && latched === hot ? subAt(angle, hot, slots) : null

  return {
    hit: { hot, sub },
    latched,
    hotSince: hot === previous ? state.hotSince : t,
    before: hot === previous ? state.before : previous,
    candidate,
    candidateSince,
    speed,
    last,
  }
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
