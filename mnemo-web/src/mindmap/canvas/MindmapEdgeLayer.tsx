import { memo } from "react"

import { boxOf, anchorsFor, edgeShape, strokeToPathData, isFilled } from "./edge-paths"
import { strokeFor } from "./edge-canvas"
import { dashAttribute, strokeStyleFor } from "./edge-style"
import type { Scene, SceneEdge, SceneElement } from "../model/scene"

/**
 * Edges as SVG, for overview zoom.
 *
 * The unintuitive half of the substrate split. SVG costs a fixed frame per gesture whatever is on
 * screen, which is ruinous at readable zoom and irrelevant at overview zoom where a gesture already
 * moves everything; the canvas has the opposite shape, free per gesture and collapsing when several
 * thousand edges are in view at once. So each is used only in the band it was measured to win, and
 * this one is the overview band.
 *
 * One viewport-sized SVG carrying the camera on an inner group, rather than a canvas-sized one: a pan
 * then moves a transform on a small element instead of scrolling a box the size of the document.
 */
export const MindmapEdgeLayer = memo(function MindmapEdgeLayer({
  scene,
  cameraRef,
}: {
  scene: Scene
  cameraRef: (group: SVGGElement | null) => void
}) {
  const boxes = new Map<string, SceneElement>()
  for (const element of scene.elements) {
    boxes.set(element.id, element)
  }

  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
      <defs>
        {/*
          `context-stroke` takes the colour from the path wearing the marker, so eight branch hues
          and every user-picked colour share two definitions instead of needing one marker each.
        */}
        <marker
          id="mm-cap-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
          markerUnits="strokeWidth"
        >
          <path d="M0 0.5 L8 4 L0 7.5 Z" fill="context-stroke" />
        </marker>
        <marker
          id="mm-cap-dot"
          viewBox="0 0 8 8"
          refX="4"
          refY="4"
          markerWidth="4"
          markerHeight="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <circle cx="4" cy="4" r="3.2" fill="context-stroke" />
        </marker>
      </defs>
      <g ref={cameraRef}>
        {scene.edges.map((edge) => {
          const from = boxes.get(edge.fromId)
          const to = boxes.get(edge.toId)
          if (!from || !to) {
            return null
          }
          return <EdgePath key={edge.id} edge={edge} from={from} to={to} />
        })}
      </g>
    </svg>
  )
})

function EdgePath({ edge, from, to }: { edge: SceneEdge; from: SceneElement; to: SceneElement }) {
  const stroke = strokeFor(edge, anchorsFor(boxOf(from), boxOf(to)))
  const style = strokeStyleFor(edge)
  const filled = isFilled(stroke)

  return (
    <path
      data-mm-edge={edge.id}
      d={strokeToPathData(stroke)}
      // A ribbon is a closed shape, so it is filled and never stroked; stroking one outlines it
      // instead of filling it, and filling an open curve closes it into a lens.
      fill={filled ? style.color : "none"}
      stroke={filled ? "none" : style.color}
      strokeWidth={filled ? undefined : style.width}
      strokeDasharray={filled ? undefined : dashAttribute(style.dash)}
      strokeLinecap="round"
      // A ribbon has no stroke for a marker to take its colour from, and a tapering branch that
      // ended in an arrowhead would be two ideas about the same end anyway.
      markerStart={filled ? undefined : capUrl(edge.startCap)}
      markerEnd={filled ? undefined : capUrl(edge.endCap)}
    />
  )
}

function capUrl(cap: SceneEdge["startCap"]): string | undefined {
  if (cap === "arrow") return "url(#mm-cap-arrow)"
  if (cap === "dot") return "url(#mm-cap-dot)"
  return undefined
}

/**
 * Edge labels, as DOM inside the world layer.
 *
 * DOM rather than SVG text, and inside the world rather than the edge SVG, because the runtime moves
 * them by writing one transform each when an endpoint moves; an SVG text node would have to be
 * repositioned by attribute and would not inherit the app's type. The scene index finds them by the
 * data attribute, which is the whole contract between this and the repaint path.
 */
export const MindmapEdgeLabels = memo(function MindmapEdgeLabels({ scene }: { scene: Scene }) {
  const boxes = new Map<string, SceneElement>()
  for (const element of scene.elements) {
    boxes.set(element.id, element)
  }

  return (
    <>
      {scene.edges.map((edge) => {
        const from = boxes.get(edge.fromId)
        const to = boxes.get(edge.toId)
        if (!edge.label || !from || !to) {
          return null
        }
        const at = edgeShape(edge.routing ?? "curve", anchorsFor(boxOf(from), boxOf(to))).label
        return (
          <span
            key={edge.id}
            data-mm-edge-label={edge.id}
            className="absolute left-0 top-0 whitespace-nowrap rounded-full bg-canvas px-1.5 text-[10.5px] leading-[16px] text-ink-2 shadow-[0_0_0_1px_var(--line-soft)]"
            style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
          >
            {edge.label}
          </span>
        )
      })}
    </>
  )
})
