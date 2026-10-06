import type { Box } from "../geometry"
import type { Guide } from "./snap"
import type { Point } from "./shape"

const LINE = "var(--accent-paper)"

/** The thin lines drawn while a drag is snapped to another mask. */
export function SnapGuides({ guides }: { guides: Guide[] }) {
  return (
    <>
      {guides.map((guide) => (
        <span
          key={`${guide.axis}${guide.at}`}
          data-testid="snap-guide"
          data-axis={guide.axis}
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={
            guide.axis === "x"
              ? { left: `${guide.at * 100}%`, top: `${guide.from * 100}%`, height: `${(guide.to - guide.from) * 100}%`, width: 1, background: LINE }
              : { top: `${guide.at * 100}%`, left: `${guide.from * 100}%`, width: `${(guide.to - guide.from) * 100}%`, height: 1, background: LINE }
          }
        />
      ))}
    </>
  )
}

/** The rubber band of a marquee selection. */
export function MarqueeBand({ band }: { band: Box }) {
  return (
    <span
      data-testid="marquee"
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{
        left: `${band.x * 100}%`,
        top: `${band.y * 100}%`,
        width: `${band.w * 100}%`,
        height: `${band.h * 100}%`,
        boxShadow: `inset 0 0 0 1px ${LINE}`,
        background: "color-mix(in srgb, var(--accent-paper) 12%, transparent)",
      }}
    />
  )
}

/** A polygon being drawn: the points placed, the open path through them and a line to the pointer. */
export function PendingPolygon({ points, cursor }: { points: Point[]; cursor: Point | null }) {
  const path = (cursor ? [...points, cursor] : points).map(([x, y]) => `${x},${y}`).join(" ")
  return (
    <>
      <svg
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
      >
        <polyline
          points={path}
          style={{ fill: "none", stroke: LINE, strokeWidth: 1.5, vectorEffect: "non-scaling-stroke", strokeLinejoin: "round" }}
        />
      </svg>
      {points.map(([x, y], index) => (
        <span
          key={index}
          data-testid="pending-point"
          aria-hidden="true"
          className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-canvas"
          style={{ left: `${x * 100}%`, top: `${y * 100}%`, boxShadow: `inset 0 0 0 1.25px ${LINE}` }}
        />
      ))}
    </>
  )
}
