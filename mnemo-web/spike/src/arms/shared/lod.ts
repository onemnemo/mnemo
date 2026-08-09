/**
 * Level of detail, driven by CSS off a single attribute rather than by React.
 *
 * The desktop suppresses node and edge chrome below zoom 0.40 and all label text below
 * 0.15, for painting and for hit-testing alike. That is product behaviour, not an
 * optimization, so every arm in this spike implements it: measuring an arm that paints
 * full labels and live math at overview zoom would be measuring a product that will never
 * ship.
 *
 * The implementation choice matters as much as the behaviour. The obvious approach, having
 * each node subscribe to the zoom and re-render when it crosses a threshold, means 5,000
 * store subscriptions and 5,000 re-renders on a single gesture. Instead one attribute is
 * written on the container and CSS does the rest, so a band crossing costs one DOM write
 * and a style recalculation with no React work at all.
 *
 * The attribute is written only when the BAND changes, not on every zoom value, so a
 * continuous zoom gesture writes it at most twice in each direction.
 */

/** Matches the shipped desktop thresholds. Chrome implies labels, since 0.40 sits above 0.15. */
export const CHROME_ZOOM_THRESHOLD = 0.4
export const LABEL_ZOOM_THRESHOLD = 0.15

export type LodBand = 'full' | 'labels' | 'bare'

export function bandForZoom(zoom: number): LodBand {
  if (zoom >= CHROME_ZOOM_THRESHOLD) return 'full'
  if (zoom >= LABEL_ZOOM_THRESHOLD) return 'labels'
  return 'bare'
}

// ---- marker rungs ----------------------------------------------------------------------

/**
 * How expensive the `bare` band is allowed to be, as a ladder from the cheapest thing the
 * substrate can express up to what `bare` renders today.
 *
 * This exists because `bare` was never the cheap tier it reads as. It already drops text,
 * chips, glyphs, math and the border radius, and the all-visible case still cost 33ms per
 * frame at 4,826 elements. What it did NOT drop is the second box: every element renders a
 * positioned host AND an inner presentation box, and the inner box still carries a border, a
 * clip and a flex layout. The remaining question for the whole DOM substrate is therefore
 * narrow and worth answering exactly:
 *
 *   can the engine walk ~4,826 single trivial positioned boxes inside one frame?
 *
 * Rung 0 asks precisely that and nothing else. Rungs 1 to 3 add one property group back at a
 * time so a passing rung 0 can be spent on overview styling with a measured price rather than
 * a guess. Rung 4 is today's `bare` unchanged, and its job is reconciliation: it must
 * reproduce the known ~33ms. If it does not, the ladder is measuring something other than
 * what it claims and no other rung on it can be trusted.
 *
 * The deltas between rungs are NOT a per-property cost model. Engines pick paint and layout
 * paths off combinations of properties, so a rung's cost is the cost of that whole rung, not
 * the sum of the ones below it.
 */
export type MarkerRung = 0 | 1 | 2 | 3 | 4

/** Today's `bare`, so an unparameterized run measures exactly what every prior run measured. */
export const DEFAULT_MARKER_RUNG: MarkerRung = 4

export function isMarkerRung(value: number): value is MarkerRung {
  return Number.isInteger(value) && value >= 0 && value <= 4
}

/**
 * Reads `?rung=` and refuses anything it does not recognise rather than falling back, because
 * a typo silently measuring rung 4 while the report is labelled rung 0 is the single most
 * expensive way this experiment could produce a confident wrong answer.
 */
export function readMarkerRung(params: URLSearchParams): MarkerRung {
  const raw = params.get('rung')
  if (raw === null || raw === '') return DEFAULT_MARKER_RUNG
  // Matched as digits before being converted, because `Number` maps both '' and any run of
  // whitespace to 0, and 0 is a real rung. A stray space would otherwise select the cheapest
  // tier on the ladder while reading as a typo nobody would look at twice.
  const parsed = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  if (!isMarkerRung(parsed)) {
    throw new Error(`unknown ?rung= value '${raw}'; the marker ladder is rungs 0 through 4`)
  }
  return parsed
}

export interface LodController {
  /** Returns true when the band actually changed, which is what the crossing report keys on. */
  update(zoom: number): boolean
  setEnabled(enabled: boolean): void
  isEnabled(): boolean
  currentBand(): LodBand
}

/**
 * `enabled` false pins the band to `full` regardless of zoom. That is the diagnostic arm
 * of the measurement: it prices what level of detail is buying, and it is never gating,
 * because the product does not render labels at overview zoom.
 */
export function createLodController(
  container: HTMLElement,
  enabled: boolean,
  rung: MarkerRung = DEFAULT_MARKER_RUNG,
): LodController {
  let isEnabled = enabled
  let band: LodBand = 'full'

  // Written once. The rung is a property of the run, not of the camera, so it never changes
  // during a gesture and costs nothing per frame.
  container.setAttribute('data-rung', String(rung))

  const write = (next: LodBand): boolean => {
    if (next === band) return false
    band = next
    container.setAttribute('data-lod', next)
    return true
  }

  container.setAttribute('data-lod', band)

  return {
    update(zoom) {
      return write(isEnabled ? bandForZoom(zoom) : 'full')
    },
    setEnabled(next) {
      isEnabled = next
      // Re-evaluating from the current band alone is not possible, so callers pass the
      // zoom again on the next update; forcing 'full' here keeps the off state honest.
      if (!next) write('full')
    },
    isEnabled() {
      return isEnabled
    },
    currentBand() {
      return band
    },
  }
}
