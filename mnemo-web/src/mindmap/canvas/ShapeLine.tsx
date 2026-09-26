/** Separate SVG layers keep the stroke below captions and handles above them during live rewrites. */

import { useLayoutEffect, useRef } from "react"

import { useT } from "@/i18n/useT"

import type { Point, SceneElement, SceneLine } from "../model/scene"
import { capsPathData } from "../scene/cap-geometry"
import { lineDrawing, linePath, midpoint } from "../scene/line-geometry"
import { bendRingLook, LINE_HIT_WIDTH } from "./line-marks"

const RING_RADIUS = 5

// SVG vector-effect cannot see the world element's outer CSS transform.
const screen = (px: number): string => `calc(${px}px / var(--mm-zoom, 1))`

export function ShapeLine({
  element,
  line,
  stroke,
}: {
  element: SceneElement
  line: SceneLine
  stroke: string | undefined
}) {
  const d = linePath(line.start, line.end, line.bend)
  const drawing = lineDrawing(line)
  const color = stroke ?? "var(--line)"

  return (
    <svg
      className="absolute inset-0 overflow-visible"
      width={element.width}
      height={element.height}
      style={{ pointerEvents: "none" }}
      role="group"
    >
      <path
        data-mm-line-stroke=""
        d={drawing.stroke}
        fill="none"
        stroke={color}
        strokeWidth={line.thickness}
        strokeLinecap="round"
      />
      {/* Always mounted, so a live drag can rewrite it without waiting for React. */}
      <path data-mm-line-caps="" d={capsPathData(drawing.caps, line.thickness)} style={{ fill: color }} />
      <path
        data-mm-line-select=""
        className="mm-line-select"
        d={d}
        fill="none"
        stroke="var(--accent)"
        strokeDasharray="5 4"
        strokeLinecap="round"
        style={{ strokeWidth: screen(1.5) }}
      />
      {/* Round caps keep zero-length lines hittable. */}
      <path
        data-mm-line-hit=""
        d={d}
        fill="none"
        stroke="transparent"
        strokeLinecap="round"
        style={{ pointerEvents: "stroke", cursor: "move", strokeWidth: screen(LINE_HIT_WIDTH) }}
      />
    </svg>
  )
}

export function ShapeLineHandles({
  element,
  line,
  hidden,
}: {
  element: SceneElement
  line: SceneLine
  hidden?: boolean
}) {
  const t = useT()
  const handles = useRef<SVGSVGElement>(null)

  useLayoutEffect(() => {
    const svg = handles.current
    if (!svg) return

    const bend = line.bend ?? midpoint(line.start, line.end)
    const place = (handle: "start" | "end" | "bend", at: Point): void => {
      svg.querySelector(`[data-mm-handle="${handle}"]`)?.setAttribute("transform", `translate(${at.x} ${at.y})`)
    }

    // Pointer drags write these transforms directly. React compares a commit with its prior props,
    // so an unchanged box-relative point would otherwise retain coordinates from the old line box.
    place("start", line.start)
    place("end", line.end)
    place("bend", bend)
  }, [line])

  return (
    <svg
      ref={handles}
      className="pointer-events-none absolute inset-0 overflow-visible"
      width={element.width}
      height={element.height}
      role="group"
      style={{ display: hidden ? "none" : undefined }}
    >
      <LineHandles
        line={line}
        labels={{
          start: t("Mindmap", "LineStartHandle"),
          end: t("Mindmap", "LineEndHandle"),
          bend: t("Mindmap", "LineBendHandle"),
        }}
      />
    </svg>
  )
}

function LineHandles({
  line,
  labels,
}: {
  line: SceneLine
  labels: Readonly<Record<"start" | "end" | "bend", string>>
}) {
  const bend = line.bend ?? midpoint(line.start, line.end)

  return (
    <g data-mm-line-handles="" className="mm-line-handles">
      {/* Kept mounted so a live bend drag does not wait for React. */}
      <Tangent from={bend} to={line.start} which="start" shown={line.bend !== null} />
      <Tangent from={bend} to={line.end} which="end" shown={line.bend !== null} />
      <Ring at={line.start} handle="start" label={labels.start} />
      <Ring at={line.end} handle="end" label={labels.end} />
      <Ring at={bend} handle="bend" label={labels.bend} filled={line.bend === null} />
    </g>
  )
}

function Tangent({ from, to, which, shown }: { from: Point; to: Point; which: "start" | "end"; shown: boolean }) {
  return (
    <line
      data-mm-tangent={which}
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      stroke="var(--accent)"
      strokeDasharray="3 3"
      strokeOpacity={0.6}
      style={{ display: shown ? undefined : "none", strokeWidth: screen(1) }}
    />
  )
}

function Ring({
  at,
  handle,
  label,
  filled = false,
}: {
  at: Point
  handle: "start" | "end" | "bend"
  label: string
  filled?: boolean
}) {
  const look = bendRingLook(!filled)
  return (
    <g
      data-mm-handle={handle}
      aria-label={label}
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
      role="button"
      tabIndex={0}
      transform={`translate(${at.x} ${at.y})`}
      className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <circle
        r={RING_RADIUS}
        fill={look.fill}
        fillOpacity={look.fillOpacity}
        stroke="var(--accent)"
        strokeWidth={1.5}
        style={{
          pointerEvents: "all",
          cursor: handle === "bend" ? "grab" : "crosshair",
          transformBox: "fill-box",
          transformOrigin: "center",
          transform: "scale(calc(1 / var(--mm-zoom, 1)))",
        }}
      />
    </g>
  )
}
