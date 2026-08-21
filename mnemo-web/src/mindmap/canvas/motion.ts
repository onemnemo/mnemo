/**
 * The compositing hint, held only while the map is moving.
 *
 * `will-change: transform` puts an element on its own compositor layer, which is what makes a pan
 * cost a transform instead of a repaint. It has a second effect that is easy to miss: Chromium
 * fixes that layer's raster scale, on the reasoning that something about to change its transform
 * should not be re-rastered mid-flight. So a layer rastered at overview zoom keeps its overview
 * pixels when the camera zooms in, and the map is drawn by scaling that texture up. Every node comes
 * back blurred, and stays blurred until something invalidates it: repainting one node (selecting it)
 * sharpens that one, and a drag, which reprojects the scene, sharpens all of them.
 *
 * The hint therefore has to be temporary. It goes on with the first frame of a gesture, so the
 * measured pan and drag behaviour is exactly what it was, and comes off shortly after the camera
 * stops, which re-rasters everything at the zoom it settled at.
 *
 * Written as one attribute on the world with the CSS keyed off it, the same shape as the level of
 * detail bands, so promoting or dropping a mapful of nodes is one DOM write rather than one per
 * element.
 */

/**
 * How long after the last movement the hint comes off.
 *
 * Long enough to sit through the gap between two wheel notches or two drag gestures, so an ordinary
 * zoom is one promotion and one demotion rather than a dozen; short enough that letting go of the
 * wheel and looking at the map does not mean looking at a blurred one.
 */
export const MOTION_IDLE = 200

export class MotionHint {
  private moving = false
  private timer = 0
  private readonly host: HTMLElement
  private readonly idle: number

  constructor(host: HTMLElement, idle = MOTION_IDLE) {
    this.host = host
    this.idle = idle
  }

  /** Something moved this frame: the camera, or an element under it. */
  moved(): void {
    if (!this.moving) {
      this.moving = true
      this.host.dataset.mmMotion = ""
    }
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.settle(), this.idle)
  }

  /** True while the hint is on, for a caller that wants to know without reading the DOM. */
  active(): boolean {
    return this.moving
  }

  dispose(): void {
    window.clearTimeout(this.timer)
    this.timer = 0
    this.settle()
  }

  private settle(): void {
    if (!this.moving) return
    this.moving = false
    delete this.host.dataset.mmMotion
  }
}
