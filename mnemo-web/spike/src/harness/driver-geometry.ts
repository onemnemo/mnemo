/**
 * Pure coordinate and zoom math the driver needs to translate an intended
 * gesture into screen-space input, and to judge afterwards whether it landed.
 * Kept apart from event dispatch so the one arm-specific assumption each
 * function makes (pan direction, wheel sensitivity) is a single function to
 * replace if a concrete arm turns out to disagree, rather than a change
 * scattered through the dispatch and proof code.
 */

import type { FrameSample, Point, Viewport } from './contract'

export interface ContainerOrigin {
  readonly left: number
  readonly top: number
}

/**
 * Screen-space point for a canvas-space point, given the gesture target's own
 * page position and the arm's current viewport. Matches the standard camera
 * convention: screen = (canvas - viewportOrigin) * zoom, offset by wherever
 * the target itself sits on the page.
 */
export function canvasPointToClient(
  containerOrigin: ContainerOrigin,
  viewport: Viewport,
  point: Point,
): Point {
  return {
    x: containerOrigin.left + (point.x - viewport.x) * viewport.zoom,
    y: containerOrigin.top + (point.y - viewport.y) * viewport.zoom,
  }
}

/** The exact inverse of `canvasPointToClient`, for asking "what is under this press point". */
export function clientPointToCanvas(
  containerOrigin: ContainerOrigin,
  viewport: Viewport,
  point: Point,
): Point {
  return {
    x: (point.x - containerOrigin.left) / viewport.zoom + viewport.x,
    y: (point.y - containerOrigin.top) / viewport.zoom + viewport.y,
  }
}

/**
 * Canvas-space delta implied by a screen-space drag, under the "grab and
 * pan" convention: dragging the surface moves content with the cursor, so
 * the camera's own origin moves the opposite way, scaled down by zoom. This
 * is the one function to replace if a concrete arm pans differently;
 * GestureDriver takes it as an injectable strategy for exactly that reason,
 * since no arm exists yet to confirm the convention against.
 */
export function defaultPanDeltaToViewportDelta(dx: number, dy: number, zoom: number): Point {
  return { x: -dx / zoom, y: -dy / zoom }
}

export interface Tolerance {
  /** Fraction of the expected magnitude that counts as noise. */
  readonly relative: number
  /** Floor below which `relative` alone would be too tight to mean anything, e.g. near zero. */
  readonly absoluteFloor: number
}

export interface ClientRectLike {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * Fractions of the container's own width and height, centre first and then spreading
 * outward. Kept away from the edges because a press within a few pixels of the border can
 * land on a scrollbar, a resize affordance or a neighbouring panel rather than the canvas.
 */
const PRESS_CANDIDATE_FRACTIONS = [0.5, 0.28, 0.72, 0.14, 0.86, 0.4, 0.6]

/**
 * Client-space press candidates inside `rect`, ordered outward from the centre.
 *
 * A pan has to start on empty canvas: on a 5,000-element fixture the geometric centre is
 * almost certainly over an element, and a press on an element starts a node drag, which
 * leaves the viewport untouched and the frames recorded under the label "pan" belonging to
 * a completely different gesture. The caller walks this list until one of them provably
 * pans, so the order is fixed and deterministic rather than random.
 */
export function pressPointCandidates(rect: ClientRectLike): readonly Point[] {
  const candidates: Point[] = []
  const last = PRESS_CANDIDATE_FRACTIONS.length - 1
  for (let sum = 0; sum <= last * 2; sum++) {
    for (let i = 0; i <= last; i++) {
      const j = sum - i
      if (j < 0 || j > last) continue
      candidates.push({
        x: rect.left + rect.width * PRESS_CANDIDATE_FRACTIONS[i],
        y: rect.top + rect.height * PRESS_CANDIDATE_FRACTIONS[j],
      })
    }
  }
  return candidates
}

/** Whether `actual` is within `tolerance` of `expected`, scaled by the expected magnitude. */
export function withinTolerance(expected: number, actual: number, tolerance: Tolerance): boolean {
  const allowed = Math.max(tolerance.absoluteFloor, Math.abs(expected) * tolerance.relative)
  return Math.abs(actual - expected) <= allowed
}

export function pointDelta(before: Point, after: Point): Point {
  return { x: after.x - before.x, y: after.y - before.y }
}

/** Log-space linear interpolation: zoom composes multiplicatively, so a linear ramp in log-space is the one that reads as a steady sweep. */
export function interpolateZoomLog(from: number, to: number, fraction: number): number {
  return Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * fraction)
}

/**
 * Wheel-deltaY sensitivity fitted from one observed (deltaY, zoomBefore,
 * zoomAfter) probe, under the model `ln(zoomAfter) = ln(zoomBefore) - k *
 * deltaY`. Convention: negative deltaY (scroll up / pinch out) zooms in,
 * matching the trackpad-pinch-as-ctrl-wheel mapping browsers themselves use
 * and that React Flow, Figma and Google Maps all listen for. Returns 0 if the
 * probe produced no measurable response, which a caller must treat as "this
 * arm did not react to the probe" rather than silently proceed.
 */
export function fitWheelSensitivity(probeDeltaY: number, zoomBefore: number, zoomAfter: number): number {
  if (probeDeltaY === 0 || zoomBefore <= 0 || zoomAfter <= 0) return 0
  return -Math.log(zoomAfter / zoomBefore) / probeDeltaY
}

/** The deltaY that should move `currentZoom` to `targetZoom`, given a fitted sensitivity. */
export function wheelDeltaForZoomRatio(currentZoom: number, targetZoom: number, sensitivity: number): number {
  if (sensitivity === 0) return 0
  return -Math.log(targetZoom / currentZoom) / sensitivity
}

export interface ZoomSample {
  /** Absolute timestamp, on the same clock as `FrameSample.t`, so the two series can be joined. */
  readonly t: number
  readonly zoom: number
}

export interface ZoomCrossing {
  readonly thresholdZoom: number
  readonly direction: 'up' | 'down'
  readonly fromT: number
  readonly toT: number
  readonly fromZoom: number
  readonly toZoom: number
}

/**
 * Every consecutive sample pair whose zoom straddles a threshold, in either
 * direction. A round-trip sweep (0.1 to 1.0 to 0.1) crosses each threshold
 * twice, once climbing and once descending, and both need to be reportable
 * separately from the rest of the sweep rather than folded into one figure.
 */
export function findZoomCrossings(
  samples: readonly ZoomSample[],
  thresholds: readonly number[],
): readonly ZoomCrossing[] {
  const crossings: ZoomCrossing[] = []
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]
    const curr = samples[i]
    for (const threshold of thresholds) {
      const straddledUp = prev.zoom < threshold && curr.zoom >= threshold
      const straddledDown = prev.zoom >= threshold && curr.zoom < threshold
      if (straddledUp || straddledDown) {
        crossings.push({
          thresholdZoom: threshold,
          direction: straddledUp ? 'up' : 'down',
          fromT: prev.t,
          toT: curr.t,
          fromZoom: prev.zoom,
          toZoom: curr.zoom,
        })
      }
    }
  }
  return crossings
}

/**
 * The frame samples that landed inside `[fromT, toT]`. Both series carry absolute
 * timestamps, so this is a plain interval selection; it exists as a function so the
 * arithmetic is written and tested once rather than re-derived at each call site, where
 * getting the origin wrong by the sweep's start offset would silently attribute a quiet
 * frame to a threshold crossing or a crossing's stall to plain sweep frames.
 */
export function framesInWindow(
  samples: readonly FrameSample[],
  fromT: number,
  toT: number,
): readonly FrameSample[] {
  return samples.filter((sample) => sample.t >= fromT && sample.t <= toT)
}

/**
 * The worst frame delta inside a window, or null when no frame landed in it. Null rather
 * than 0: a window with no samples is missing data, and 0 would read as a perfect frame.
 */
export function worstFrameDtInWindow(
  samples: readonly FrameSample[],
  fromT: number,
  toT: number,
): number | null {
  const inWindow = framesInWindow(samples, fromT, toT)
  if (inWindow.length === 0) return null
  return inWindow.reduce((worst, sample) => Math.max(worst, sample.dt), 0)
}
