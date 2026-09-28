/**
 * The previews on the selection bars and their panels, drawn at the sizes the bars are designed at.
 * The flyouts that arm a tool keep the smaller ones in glyphs.tsx.
 */

import type { ArrowCap, EdgeRouting, LineStyle } from "../model/document"

const DASH: Record<LineStyle, string | undefined> = {
  solid: undefined,
  dashed: "6 5",
  dotted: "0.1 4.5",
  double: undefined,
}

/** A line pattern `width` wide, at the given stroke weight. */
export function PatternGlyph({ line, width, weight }: { line: LineStyle; width: number; weight: number }) {
  const end = width - 3
  return (
    <svg width={width} height={10} viewBox={`0 0 ${width} 10`} aria-hidden>
      <path
        d={line === "double" ? `M3 2.5H${end}M3 7.5H${end}` : `M3 5H${end}`}
        stroke="currentColor"
        strokeWidth={line === "double" ? Math.min(weight, 1.4) : weight}
        strokeLinecap="round"
        strokeDasharray={DASH[line]}
        fill="none"
      />
    </svg>
  )
}

const ROUTE_PATH: Record<EdgeRouting, string> = {
  curve: "M3 22.5C22 22.5 22 3.5 41 3.5",
  straight: "M3 22.5 41 3.5",
  orthogonal: "M3 22.5H20a2 2 0 0 0 2-2V5.5a2 2 0 0 1 2-2H41",
}

function RoutePath({ routing, width }: { routing: EdgeRouting; width: number }) {
  return (
    <path
      d={ROUTE_PATH[routing]}
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  )
}

/** How an edge travels between two nodes, drawn between two dots. */
export function RoutePreview({ routing }: { routing: EdgeRouting }) {
  return (
    <svg width={44} height={26} viewBox="0 0 44 26" aria-hidden>
      <RoutePath routing={routing} width={1.8} />
      <circle cx={3} cy={22.5} r={2} fill="currentColor" />
      <circle cx={41} cy={3.5} r={2} fill="currentColor" />
    </svg>
  )
}

/** The route alone, small enough for the bar. */
export function RouteFace({ routing }: { routing: EdgeRouting }) {
  return (
    <svg width={22} height={14} viewBox="0 0 44 26" aria-hidden>
      <RoutePath routing={routing} width={3} />
    </svg>
  )
}

/** A cap drawn at x = 8 pointing left; mirrored for the far end. */
function Cap({ cap }: { cap: ArrowCap }) {
  if (cap === "arrow") {
    return <path d="M13 2 8 7l5 5" fill="none" />
  }
  if (cap === "dot") {
    return <circle cx={8} cy={7} r={3} fill="currentColor" />
  }
  return null
}

/** One end's choice, on a stub of line; `end` mirrors it to point right. */
export function CapPreview({ cap, end }: { cap: ArrowCap; end: boolean }) {
  return (
    <svg
      width={40}
      height={14}
      viewBox="0 0 40 14"
      aria-hidden
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={end ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M8 7H36" fill="none" />
      <Cap cap={cap} />
    </svg>
  )
}

/** Both ends on one stub, for the bar. */
export function EndsFace({ start, end }: { start: ArrowCap; end: ArrowCap }) {
  return (
    <svg
      width={26}
      height={10}
      viewBox="4 0 36 14"
      aria-hidden
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 7H36" fill="none" />
      <Cap cap={start} />
      <g transform="translate(44 0) scale(-1 1)">
        <Cap cap={end} />
      </g>
    </svg>
  )
}
