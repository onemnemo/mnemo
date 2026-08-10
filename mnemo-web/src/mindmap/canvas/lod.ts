/**
 * Level of detail, driven by CSS off a single attribute rather than by React.
 *
 * Node and edge chrome is suppressed below zoom 0.40 and all label text below 0.15, for painting
 * and for hit-testing alike. That is product behaviour inherited from the desktop, not an
 * optimization: at overview zoom a label is a smear and a checkbox is a pixel, and hit-testing
 * chrome you cannot see is worse than not drawing it.
 *
 * The implementation choice matters as much as the behaviour. The obvious approach, having each
 * node subscribe to the zoom and re-render when it crosses a threshold, means five thousand store
 * subscriptions and five thousand re-renders on one gesture. Instead one attribute is written on
 * the container and CSS does the rest, so a band crossing costs one DOM write and a style
 * recalculation with no React work at all.
 *
 * The attribute is written only when the BAND changes, not on every zoom value, so a continuous
 * zoom gesture writes it at most twice in each direction.
 */

/** Chrome implies labels, since 0.40 sits above 0.15. */
export const CHROME_ZOOM_THRESHOLD = 0.4
export const LABEL_ZOOM_THRESHOLD = 0.15

export type LodBand = "full" | "labels" | "bare"

export function bandForZoom(zoom: number): LodBand {
  if (zoom >= CHROME_ZOOM_THRESHOLD) return "full"
  if (zoom >= LABEL_ZOOM_THRESHOLD) return "labels"
  return "bare"
}

/**
 * Writes the band onto a host element, and only when it changes.
 *
 * The `bare` band is measured to hold sixty frames a second on five thousand elements only while
 * each of them is ONE box: a positioned host with a background and nothing inside it. A second box
 * per element, or a per-element border in that band, roughly halves the frame rate. That is a CSS
 * obligation, enforced in the stylesheet rather than here, but this is where it is worth reading.
 */
export class LodController {
  private band: LodBand | null = null
  private readonly host: HTMLElement

  constructor(host: HTMLElement) {
    this.host = host
  }

  /** Returns true when the band actually changed, so a caller can do band-conditional work. */
  apply(zoom: number): boolean {
    const next = bandForZoom(zoom)
    if (next === this.band) {
      return false
    }
    this.band = next
    this.host.dataset.lod = next
    return true
  }

  current(): LodBand | null {
    return this.band
  }
}
