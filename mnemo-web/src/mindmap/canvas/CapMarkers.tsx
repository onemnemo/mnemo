import type { ArrowCap } from "../model/document"
import { ARROW_MARKER, DOT_MARKER } from "../scene/cap-geometry"
import { capMarkerId, hasCapMarker } from "./line-marks"

/**
 * The end markers of one line, painted in its colour.
 *
 * Rendered beside the path that uses them, so they mount and unmount with it and never need a
 * shared defs layer kept alive across the zoom-dependent edge substrates. The colour goes in as a
 * style rather than an attribute so a `var()` resolves.
 */
export function CapMarkers({
  owner,
  color,
  start,
  end,
}: {
  owner: string
  color: string
  start: ArrowCap | undefined
  end: ArrowCap | undefined
}) {
  if (!hasCapMarker(start) && !hasCapMarker(end)) {
    return null
  }

  return (
    <defs>
      {hasCapMarker(start) ? <CapMarker id={capMarkerId(owner, "start")} cap={start} color={color} /> : null}
      {hasCapMarker(end) ? <CapMarker id={capMarkerId(owner, "end")} cap={end} color={color} /> : null}
    </defs>
  )
}

function CapMarker({ id, cap, color }: { id: string; cap: "arrow" | "dot"; color: string }) {
  if (cap === "arrow") {
    return (
      <marker
        id={id}
        viewBox={`0 0 ${ARROW_MARKER.size} ${ARROW_MARKER.size}`}
        refX={ARROW_MARKER.refX}
        refY={ARROW_MARKER.refY}
        markerWidth={ARROW_MARKER.size * ARROW_MARKER.scale}
        markerHeight={ARROW_MARKER.size * ARROW_MARKER.scale}
        orient="auto-start-reverse"
        markerUnits="strokeWidth"
      >
        <path d={ARROW_MARKER.path} style={{ fill: color }} />
      </marker>
    )
  }

  return (
    <marker
      id={id}
      viewBox={`0 0 ${DOT_MARKER.size} ${DOT_MARKER.size}`}
      refX={DOT_MARKER.refX}
      refY={DOT_MARKER.refY}
      markerWidth={DOT_MARKER.size * DOT_MARKER.scale}
      markerHeight={DOT_MARKER.size * DOT_MARKER.scale}
      orient="auto"
      markerUnits="strokeWidth"
    >
      <circle cx={DOT_MARKER.refX} cy={DOT_MARKER.refY} r={DOT_MARKER.radius} style={{ fill: color }} />
    </marker>
  )
}
