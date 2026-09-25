import { memo } from "react"

import { cn } from "@/lib/utils"

import { boxOf, anchorsFor, edgeShape, strokeToPathData, isFilled } from "./edge-paths"
import { strokeFor } from "./edge-canvas"
import { CapMarkers } from "./CapMarkers"
import { capMarker } from "./line-marks"
import { dashAttribute, strokeStyleFor } from "./edge-style"
import type { Scene, SceneEdge, SceneElement } from "../model/scene"
import { useFieldFlush } from "./useFieldFlush"

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
  const owner = `edge-${edge.id}`

  return (
    <>
      {filled ? null : <CapMarkers owner={owner} color={style.color} start={edge.startCap} end={edge.endCap} />}
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
        markerStart={filled ? undefined : capMarker(edge.startCap, owner, "start")}
        markerEnd={filled ? undefined : capMarker(edge.endCap, owner, "end")}
      />
    </>
  )
}

/**
 * Edge labels, as DOM inside the world layer.
 *
 * DOM rather than SVG text, and inside the world rather than the edge SVG, because the runtime moves
 * them by writing one transform each when an endpoint moves; an SVG text node would have to be
 * repositioned by attribute and would not inherit the app's type. The scene index finds them by the
 * data attribute, which is the whole contract between this and the repaint path.
 */
export const MindmapEdgeLabels = memo(function MindmapEdgeLabels({
  scene,
  editingId,
  onEditEnd,
}: {
  scene: Scene
  /** The edge whose label is currently a field. */
  editingId?: string | null
  /** The field closed: the typed text, or null when the edit was abandoned. */
  onEditEnd?: (id: string, text: string | null) => void | Promise<unknown>
}) {
  const boxes = new Map<string, SceneElement>()
  for (const element of scene.elements) {
    boxes.set(element.id, element)
  }

  return (
    <>
      {scene.edges.map((edge) => {
        const from = boxes.get(edge.fromId)
        const to = boxes.get(edge.toId)
        if (!from || !to) {
          return null
        }
        // An edge with no label draws nothing, unless it is the one being labelled: a first label
        // has to be typed somewhere, and the rule that skips empty ones would leave nothing to type
        // into.
        const editing = edge.id === editingId
        if (!edge.label && !editing) {
          return null
        }

        const at = edgeShape(edge.routing ?? "curve", anchorsFor(boxOf(from), boxOf(to))).label
        const place = { transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }

        return editing ? (
          <EdgeLabelEditor key={edge.id} edge={edge} place={place} onEditEnd={onEditEnd} />
        ) : (
          <span
            key={edge.id}
            data-mm-edge-label={edge.id}
            className={LABEL_PILL}
            style={place}
          >
            {edge.label}
          </span>
        )
      })}
    </>
  )
})

/** The chip an edge label sits in, worn by the label and by the field that replaces it. */
const LABEL_PILL =
  "absolute left-0 top-0 whitespace-nowrap rounded-full bg-canvas px-1.5 text-[10.5px] leading-[16px] text-ink-2 shadow-[0_0_0_1px_var(--line-soft)]"

/** The pill's horizontal padding and ring, which the text width does not include. */
const LABEL_FIELD_CHROME = 14

let labelMeasure: CanvasRenderingContext2D | null | undefined

/**
 * Widens the field to its text as it is typed.
 *
 * `field-sizing: content` would do this in CSS, but only Chromium has it: on WebKit the field kept its
 * starting width while typing and the text scrolled inside it. The text is measured in the field's
 * own font instead, which every engine agrees on.
 */
function fitLabelField(field: HTMLInputElement): void {
  if (labelMeasure === undefined) {
    labelMeasure = document.createElement("canvas").getContext("2d") ?? null
  }
  if (!labelMeasure) return
  const style = getComputedStyle(field)
  // Firefox leaves the shorthand empty, so it is rebuilt from the parts there.
  labelMeasure.font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const text = field.value || field.placeholder
  field.style.width = `${Math.ceil(labelMeasure.measureText(text).width) + LABEL_FIELD_CHROME}px`
}

/**
 * A label, as a field, in the label's own place.
 *
 * On the canvas rather than in a popover hanging off the bar that opened it. An edge label is a thing
 * on the map at a particular point, and typing it anywhere else means reading the result somewhere
 * other than where you are looking. The bar's button is what starts the edit; it is not where the
 * edit happens.
 */
function EdgeLabelEditor({
  edge,
  place,
  onEditEnd,
}: {
  edge: SceneEdge
  place: { transform: string }
  onEditEnd?: (id: string, text: string | null) => void | Promise<unknown>
}) {
  const { finish, track } = useFieldFlush(edge.label ?? "", (value) => onEditEnd?.(edge.id, value))

  return (
    <input
      data-mm-edge-label={edge.id}
      ref={(node) => {
        if (!node) return
        fitLabelField(node)
        node.focus({ preventScroll: true })
        node.select()
      }}
      defaultValue={edge.label ?? ""}
      spellCheck={false}
      // select-text against the pane's select-none, or the caret cannot select what it is editing.
      className={cn(LABEL_PILL, "w-[56px] min-w-[56px] select-text text-ink outline-none")}
      style={place}
      onChange={(event) => {
        fitLabelField(event.currentTarget)
        track(event.currentTarget.value)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          // A composing Enter confirms the IME's candidate, not the label; let the IME answer it.
          if (event.nativeEvent.isComposing) {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          finish(event.currentTarget.value)
          return
        }
        if (event.key === "Escape") {
          event.stopPropagation()
          finish(null)
        }
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
      // A press inside the field is not a press on the canvas, which would clear the selection and
      // unmount the field before the caret ever moved.
      onPointerDown={(event) => event.stopPropagation()}
    />
  )
}
