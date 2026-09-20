import type { AnchorSide } from "../model/document"
import type { Point } from "../model/scene"
import { ANCHOR_SIDES, anchorPoint, type AnchorTarget } from "../scene/line-geometry"

const SVG_NS = "http://www.w3.org/2000/svg"

const ANCHOR_RADIUS = 4

export interface LineOverlay {
  showAnchors(target: AnchorTarget | null, locked: AnchorSide | null, toPane: (point: Point) => Point): void
  showPreview(start: Point, end: Point, toPane: (point: Point) => Point): void
  showReadout(at: Point, text: string): void
  remove(): void
}

export function openLineOverlay(pane: HTMLElement): LineOverlay {
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:30"
  const dots = ANCHOR_SIDES.map((side) => {
    const dot = document.createElementNS(SVG_NS, "circle")
    dot.dataset.mmAnchor = side
    dot.setAttribute("r", String(ANCHOR_RADIUS))
    dot.setAttribute("stroke", "var(--accent)")
    dot.setAttribute("stroke-width", "1.5")
    dot.style.display = "none"
    svg.append(dot)
    return dot
  })
  const preview = document.createElementNS(SVG_NS, "line")
  preview.dataset.mmPreview = ""
  preview.setAttribute("stroke", "var(--accent)")
  preview.setAttribute("stroke-width", "1.5")
  preview.setAttribute("stroke-linecap", "round")
  preview.style.display = "none"
  svg.prepend(preview)
  pane.append(svg)

  const readout = document.createElement("div")
  readout.dataset.mmReadout = ""
  readout.style.cssText = [
    "position:absolute",
    "left:0",
    "top:0",
    "pointer-events:none",
    "z-index:31",
    "display:none",
    "padding:2px 7px",
    "border-radius:6px",
    "background:var(--canvas)",
    "box-shadow:0 0 0 1px var(--line)",
    "color:var(--ink-2)",
    "font-size:11px",
    "font-variant-numeric:tabular-nums",
    "white-space:nowrap",
  ].join(";")
  pane.append(readout)

  return {
    showAnchors(target, locked, toPane) {
      dots.forEach((dot, i) => {
        if (!target) {
          dot.style.display = "none"
          return
        }
        const side = ANCHOR_SIDES[i]
        const at = toPane(anchorPoint(target.box, side, target.rotation))
        dot.setAttribute("cx", String(at.x))
        dot.setAttribute("cy", String(at.y))
        dot.setAttribute("fill", side === locked ? "var(--accent)" : "var(--canvas)")
        dot.style.display = ""
      })
    },

    showPreview(start, end, toPane) {
      const from = toPane(start)
      const to = toPane(end)
      preview.setAttribute("x1", String(from.x))
      preview.setAttribute("y1", String(from.y))
      preview.setAttribute("x2", String(to.x))
      preview.setAttribute("y2", String(to.y))
      preview.style.display = ""
    },

    showReadout(at, text) {
      readout.textContent = text
      readout.style.display = ""
      readout.style.transform = `translate(${at.x + 14}px, ${at.y + 14}px)`
    },

    remove() {
      svg.remove()
      readout.remove()
    },
  }
}
