import type { WidgetPlacement } from "../layout/engine"
import { GAP, ROW_HEIGHT } from "../layout/metrics"

/**
 * The cell a dragged tile would land in, drawn as a filled rounded rect behind the board.
 *
 * There is only ever one of these, and only while something is in the air. A grid pre-filled with
 * dashed placeholders is graph paper: it makes an empty board look broken rather than empty, and
 * it makes a busy one unreadable. The tile itself is the thing that follows the pointer; this is
 * only the answer to "where does it go".
 *
 * Positioned off the same `--overview-cell` expression the tiles use, so the ghost cannot land a
 * fraction of a pixel away from the tile it stands in for.
 */
export function DragGhost({ placement }: { placement: WidgetPlacement }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute rounded-2xl bg-frame-active/70 transition-[left,top,width,height] duration-120 ease-out"
      style={{
        left: `calc(var(--overview-cell) * ${placement.column} + ${placement.column * GAP}px)`,
        width: `calc(var(--overview-cell) * ${placement.columnSpan} + ${(placement.columnSpan - 1) * GAP}px)`,
        top: placement.row * (ROW_HEIGHT + GAP),
        height: placement.rowSpan * ROW_HEIGHT + (placement.rowSpan - 1) * GAP,
      }}
    />
  )
}
