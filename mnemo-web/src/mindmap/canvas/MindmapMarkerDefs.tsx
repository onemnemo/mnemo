import { ARROW_MARKER, DOT_MARKER } from "../scene/cap-geometry"

/** Always mounted because shape markers outlive the zoom-dependent SVG edge layer. */
export function MindmapMarkerDefs() {
  return (
    <svg className="absolute size-0 overflow-hidden" aria-hidden>
      <defs>
        {/* context-stroke keeps the shared markers colour agnostic. */}
        <marker
          id="mm-cap-arrow"
          viewBox={`0 0 ${ARROW_MARKER.size} ${ARROW_MARKER.size}`}
          refX={ARROW_MARKER.refX}
          refY={ARROW_MARKER.refY}
          markerWidth={ARROW_MARKER.size * ARROW_MARKER.scale}
          markerHeight={ARROW_MARKER.size * ARROW_MARKER.scale}
          orient="auto-start-reverse"
          markerUnits="strokeWidth"
        >
          <path d={ARROW_MARKER.path} fill="context-stroke" />
        </marker>
        <marker
          id="mm-cap-dot"
          viewBox={`0 0 ${DOT_MARKER.size} ${DOT_MARKER.size}`}
          refX={DOT_MARKER.refX}
          refY={DOT_MARKER.refY}
          markerWidth={DOT_MARKER.size * DOT_MARKER.scale}
          markerHeight={DOT_MARKER.size * DOT_MARKER.scale}
          orient="auto"
          markerUnits="strokeWidth"
        >
          <circle cx={DOT_MARKER.refX} cy={DOT_MARKER.refY} r={DOT_MARKER.radius} fill="context-stroke" />
        </marker>
      </defs>
    </svg>
  )
}
