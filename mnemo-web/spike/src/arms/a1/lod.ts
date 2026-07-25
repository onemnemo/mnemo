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
export function createLodController(container: HTMLElement, enabled: boolean): LodController {
  let isEnabled = enabled
  let band: LodBand = 'full'

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
