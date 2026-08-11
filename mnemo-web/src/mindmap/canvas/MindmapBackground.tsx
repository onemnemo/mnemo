import { forwardRef } from "react"

import type { CanvasBackground } from "../model/scene"

/**
 * What the map sits on.
 *
 * A CSS background rather than drawn geometry: the runtime pans it by shifting the pattern's origin
 * and zooms it by scaling the tile, which costs two style writes a frame however far the map extends.
 * Drawing a grid across the document's own bounds would cost more the bigger the map got, for a thing
 * nobody is looking at.
 */
export const MindmapBackground = forwardRef<HTMLDivElement, { background: CanvasBackground }>(
  function MindmapBackground({ background }, ref) {
    return (
      <div
        ref={ref}
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={background === "plain" ? undefined : PATTERNS[background]}
      />
    )
  },
)

/**
 * Both patterns are one tile repeated, sized and offset by the camera. Kept faint enough to read as
 * paper rather than as content: a grid you notice is a grid competing with the map on it.
 */
const PATTERNS: Record<Exclude<CanvasBackground, "plain">, React.CSSProperties> = {
  dots: {
    backgroundImage: "radial-gradient(circle at 1px 1px, var(--line) 1px, transparent 0)",
  },
  grid: {
    backgroundImage:
      "linear-gradient(to right, var(--line-soft) 1px, transparent 1px), linear-gradient(to bottom, var(--line-soft) 1px, transparent 1px)",
  },
}
