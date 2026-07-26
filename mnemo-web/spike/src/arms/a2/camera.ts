/**
 * The camera, as pure arithmetic over the contract's viewport.
 *
 * This is the whole reason A2 exists. React Flow's cost turned out to be per-frame JavaScript
 * proportional to the node count, so the question A2 asks is what a pan costs when the answer
 * is "one string, written to one element". Everything here is O(1) in the size of the document,
 * and keeping it in its own module is what makes that claim checkable rather than asserted.
 */

import { MAX_SCALE, MIN_SCALE } from '../../fixture/model'
import type { Viewport } from '../../harness/contract'

/**
 * Wheel-delta to zoom-ratio constant. Its exact value does not matter: the driver fits the
 * arm's real sensitivity from a probe before it sweeps, so any smooth exponential mapping is
 * driveable. It is exponential rather than linear because zoom composes multiplicatively, and
 * a linear mapping makes the same wheel notch feel very different at 0.1 than at 5.0.
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.002

export function clampZoom(zoom: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, zoom))
}

/**
 * The world layer's transform for a camera.
 *
 * Written as translate-then-scale, which composes to `matrix(z, 0, 0, z, -x*z, -y*z)`, so the
 * shared parser recovers the camera exactly. Order matters: scale-then-translate would put the
 * translation in scaled units and the committed read would disagree with the state at every
 * zoom except 1.0.
 */
export function worldTransform(v: Viewport): string {
  return `translate(${-v.x * v.zoom}px, ${-v.y * v.zoom}px) scale(${v.zoom})`
}

/**
 * The same camera as an SVG `transform` attribute, for the group holding the edges.
 *
 * The edge SVG is viewport-sized and carries the camera on an inner group, rather than being
 * canvas-sized and riding the world's transform. That is not a stylistic choice: a canvas-sized
 * SVG on the forest fixture is a box roughly 10,900 by 135,000 CSS pixels, and merely having it
 * under a transformed ancestor cost a whole frame on every pan even with every path inside it
 * hidden. Sized to the viewport, it costs what it draws.
 */
export function svgCameraTransform(v: Viewport): string {
  return `translate(${-v.x * v.zoom}, ${-v.y * v.zoom}) scale(${v.zoom})`
}

/** Grab and pan: dragging the surface one way moves the camera the other, scaled down by zoom. */
export function panBy(v: Viewport, dxClient: number, dyClient: number): Viewport {
  return { x: v.x - dxClient / v.zoom, y: v.y - dyClient / v.zoom, zoom: v.zoom }
}

/**
 * Zoom anchored on a point, given in pixels from the container's top-left.
 *
 * Anchoring is not decoration. Zooming about the container's centre instead of the cursor
 * makes the content slide under the pointer, and at the 0.1-to-1.0 sweep the scenarios drive
 * that drift is large enough to walk the camera off the fixture entirely, which would measure
 * an empty renderer for the back half of the sweep.
 */
export function zoomAt(v: Viewport, deltaY: number, offsetX: number, offsetY: number): Viewport {
  const zoom = clampZoom(v.zoom * Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY))
  if (zoom === v.zoom) return v
  // The canvas point under the cursor is `v.x + offsetX / v.zoom`, and it must still be there
  // afterwards, which fixes the new origin.
  return {
    x: v.x + offsetX / v.zoom - offsetX / zoom,
    y: v.y + offsetY / v.zoom - offsetY / zoom,
    zoom,
  }
}
