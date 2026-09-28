/**
 * The lasso gesture: a loop recorded in canvas space and drawn over the pane as it grows, so a wheel
 * zoom or pan mid-loop moves it with the map.
 */

import type { Point } from "../model/scene"
import { loopBounds } from "./lasso"

export const SVG_NS = "http://www.w3.org/2000/svg"

/** Pane pixels between recorded points. As smooth as the eye can tell, and cheap to test. */
const STEP = 3

export interface LassoSurface {
  readonly pane: HTMLElement
  toCanvas(clientX: number, clientY: number): Point
  toPane(point: Point): Point
  zoom(): number
}

export interface LassoDrag<Intent> {
  readonly kind: "lasso"
  readonly pointerId: number
  readonly intent: Intent
  readonly points: Point[]
  readonly overlay: SVGPathElement
  /** The path drawn so far, and where its first point sat when it was, to tell whether the camera moved. */
  drawn: string
  anchor: Point
  /** The pointer's last client position, to redraw from when the camera moves under a still pointer. */
  client: { x: number; y: number }
}

export function beginLasso<Intent>(
  surface: LassoSurface,
  pointerId: number,
  intent: Intent,
  start: Point,
  client: { x: number; y: number },
): LassoDrag<Intent> {
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:30"
  const path = document.createElementNS(SVG_NS, "path")
  path.setAttribute("fill", "color-mix(in oklab, var(--accent) 10%, transparent)")
  path.setAttribute("stroke", "var(--accent)")
  path.setAttribute("stroke-width", "1.5")
  path.setAttribute("stroke-dasharray", "4 3")
  path.setAttribute("stroke-linejoin", "round")
  svg.append(path)
  surface.pane.append(svg)
  const anchor = surface.toPane(start)
  return { kind: "lasso", pointerId, intent, points: [start], overlay: path, drawn: `M${anchor.x} ${anchor.y}`, anchor, client }
}

export function moveLasso<Intent>(surface: LassoSurface, drag: LassoDrag<Intent>, clientX: number, clientY: number): void {
  drag.client = { x: clientX, y: clientY }
  const at = surface.toCanvas(clientX, clientY)
  const last = drag.points[drag.points.length - 1]
  const step = Math.hypot(at.x - last.x, at.y - last.y) * surface.zoom() >= STEP
  const anchor = surface.toPane(drag.points[0])
  if (anchor.x !== drag.anchor.x || anchor.y !== drag.anchor.y) {
    // The camera moved under the loop, so every point sits somewhere new on screen.
    if (step) {
      drag.points.push(at)
    }
    drag.anchor = anchor
    drag.drawn = drag.points
      .map((point, index) => {
        const p = surface.toPane(point)
        return `${index === 0 ? "M" : "L"}${p.x} ${p.y}`
      })
      .join("")
  } else if (step) {
    drag.points.push(at)
    const p = surface.toPane(at)
    drag.drawn += `L${p.x} ${p.y}`
  } else {
    return
  }
  drag.overlay.setAttribute("d", `${drag.drawn}Z`)
}

/** The finished loop, or null when it was only a wobble, which is a click. A straight stroke is kept. */
export function endLasso<Intent>(
  surface: LassoSurface,
  drag: LassoDrag<Intent>,
  clientX: number,
  clientY: number,
): readonly Point[] | null {
  dropLasso(drag)
  const loop = [...drag.points, surface.toCanvas(clientX, clientY)]
  const reach = loopBounds(loop)
  const zoom = surface.zoom()
  return loop.length < 3 || (reach.width * zoom < 4 && reach.height * zoom < 4) ? null : loop
}

export function dropLasso<Intent>(drag: LassoDrag<Intent>): void {
  drag.overlay.ownerSVGElement?.remove()
}
