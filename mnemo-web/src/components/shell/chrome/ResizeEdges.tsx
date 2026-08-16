import { beginWindowResize, type WindowEdge } from "@/lib/window"

/**
 * The border the OS is no longer drawing.
 *
 * A chromeless window has no frame to grab, so these are invisible strips laid
 * over the window edges purely to start a native resize. They sit above the
 * content, which is why they are as thin as they can be while still being
 * catchable, and why the corners are listed after the sides: the later element
 * wins the overlap, and a corner that behaves like an edge is the thing people
 * notice.
 */

const THICKNESS = 4
const CORNER = 12

const EDGES: Array<{ edge: WindowEdge; cursor: string; style: React.CSSProperties }> = [
  { edge: "top", cursor: "ns-resize", style: { top: 0, left: 0, right: 0, height: THICKNESS } },
  { edge: "bottom", cursor: "ns-resize", style: { bottom: 0, left: 0, right: 0, height: THICKNESS } },
  { edge: "left", cursor: "ew-resize", style: { left: 0, top: 0, bottom: 0, width: THICKNESS } },
  { edge: "right", cursor: "ew-resize", style: { right: 0, top: 0, bottom: 0, width: THICKNESS } },
  { edge: "top-left", cursor: "nwse-resize", style: { top: 0, left: 0, width: CORNER, height: CORNER } },
  { edge: "top-right", cursor: "nesw-resize", style: { top: 0, right: 0, width: CORNER, height: CORNER } },
  { edge: "bottom-left", cursor: "nesw-resize", style: { bottom: 0, left: 0, width: CORNER, height: CORNER } },
  { edge: "bottom-right", cursor: "nwse-resize", style: { bottom: 0, right: 0, width: CORNER, height: CORNER } },
]

export function ResizeEdges() {
  return (
    <>
      {EDGES.map(({ edge, cursor, style }) => (
        <div
          key={edge}
          aria-hidden
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            beginWindowResize(edge)
          }}
          className="fixed z-[100]"
          style={{ ...style, cursor }}
        />
      ))}
    </>
  )
}
