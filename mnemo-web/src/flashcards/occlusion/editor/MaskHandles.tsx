import type { OcclusionMask } from "../../facts/occlusion"
import type { ResizeDir } from "@/mindmap/interaction/resize"

/** A mid-edge handle on the top or bottom is dropped under this height, in pixels, so it does not cover the mask. */
const MID_HANDLE_MIN_HEIGHT = 24

const CURSORS: Record<ResizeDir, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
}

const SPOTS: Record<ResizeDir, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
}

/** Which handles a rectangle or ellipse of this height shows. */
function visibleHandles(heightPx: number): ResizeDir[] {
  const all = Object.keys(SPOTS) as ResizeDir[]
  return heightPx >= MID_HANDLE_MIN_HEIGHT ? all : all.filter((dir) => dir !== "n" && dir !== "s")
}

const HANDLE =
  "pointer-events-auto absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-[2px] bg-canvas shadow-handle before:absolute before:-inset-[7px] before:content-['']"
const HANDLE_RING = { boxShadow: "inset 0 0 0 1.25px var(--accent-paper), var(--e-handle)" }

/** The eight resize handles of a rectangle or ellipse, or a vertex handle on each point of a polygon. */
export function MaskHandles({ mask, heightPx }: { mask: OcclusionMask; heightPx: number }) {
  if (mask.shape === "polygon" && mask.points) {
    return (
      <>
        {mask.points.map(([x, y], index) => (
          <span
            key={index}
            data-vertex={index}
            className={HANDLE}
            style={{ ...HANDLE_RING, left: `${x * 100}%`, top: `${y * 100}%`, cursor: "move" }}
          />
        ))}
      </>
    )
  }

  return (
    <>
      {visibleHandles(heightPx).map((dir) => {
        const [fx, fy] = SPOTS[dir]
        return (
          <span
            key={dir}
            data-handle={dir}
            className={HANDLE}
            style={{
              ...HANDLE_RING,
              left: `${(mask.x + mask.w * fx) * 100}%`,
              top: `${(mask.y + mask.h * fy) * 100}%`,
              cursor: CURSORS[dir],
            }}
          />
        )
      })}
    </>
  )
}
