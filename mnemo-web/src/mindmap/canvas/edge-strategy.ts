/**
 * Which substrate draws the edges, and when that changes.
 *
 * The two edge layers fail in complementary regions rather than one being better. SVG costs a
 * fixed frame per gesture no matter how little is on screen, so it fails the readable-zoom
 * scenarios: a pan showing ONE element ran at 30fps against a clean 60 with edges off. Canvas
 * removes that entirely, both of those scenarios go to 600 frames of 600, and then collapses to
 * 83ms per frame at overview zoom with 4,826 elements visible WHILE NOTHING IS MOVING.
 *
 * Neither region overlaps the other, and the zoom band that separates them already exists as the
 * level-of-detail signal. So the hybrid strategy is not a compromise between two renderers, it is
 * each renderer used only where it was measured to work:
 *
 *   readable zoom (`full`, `labels`) -> canvas
 *   overview zoom (`bare`)           -> svg
 *
 * The inactive layer is genuinely unmounted rather than hidden. Both failures are caused by the
 * layer merely EXISTING (a canvas-sized SVG cost a frame per pan with every path inside it
 * hidden, and the canvas idle collapse happens with nothing drawn), so a hidden layer would carry
 * the cost the switch exists to avoid and the architecture would be invalid.
 */

import { LABEL_ZOOM_THRESHOLD } from './lod'
import type { EdgeMode } from './edge-style'

/** What the run was asked for. `hybrid` picks an `EdgeMode` per band; the rest pin one. */
export type EdgeStrategy = EdgeMode | 'hybrid'

/**
 * Enter the overview substrate exactly at the `bare` band, so the switch never disagrees with the
 * level of detail the same zoom already selected.
 */
export const HYBRID_ENTER_OVERVIEW_ZOOM = LABEL_ZOOM_THRESHOLD

/**
 * Leave it higher than it was entered.
 *
 * Without the gap a camera resting on the threshold would tear both layers down and build them
 * back up on every jittered frame of a zoom gesture, which is a far worse failure than either
 * layer's own. The gap is ~13% of the threshold, comfortably wider than wheel-step quantisation
 * and still far narrower than the band it guards.
 */
export const HYBRID_LEAVE_OVERVIEW_ZOOM = 0.17

export interface EdgeStrategySelector {
  /**
   * Returns the substrate to switch to, or null when nothing should change.
   *
   * Null rather than the current value so a caller cannot accidentally treat "unchanged" as a
   * reason to rebuild: rebuilding is exactly what this exists to make rare.
   */
  update(zoom: number): EdgeMode | null
  current(): EdgeMode
}

/** The substrate a hybrid run starts on, before any hysteresis applies. */
export function initialHybridMode(zoom: number): EdgeMode {
  return zoom < HYBRID_ENTER_OVERVIEW_ZOOM ? 'svg' : 'canvas'
}

export function createEdgeStrategySelector(
  strategy: EdgeStrategy,
  initialZoom: number,
): EdgeStrategySelector {
  if (strategy !== 'hybrid') {
    return { update: () => null, current: () => strategy }
  }

  let mode = initialHybridMode(initialZoom)

  return {
    update(zoom) {
      const next: EdgeMode =
        mode === 'canvas'
          ? zoom < HYBRID_ENTER_OVERVIEW_ZOOM
            ? 'svg'
            : 'canvas'
          : zoom >= HYBRID_LEAVE_OVERVIEW_ZOOM
            ? 'canvas'
            : 'svg'
      if (next === mode) return null
      mode = next
      return next
    },
    current: () => mode,
  }
}
