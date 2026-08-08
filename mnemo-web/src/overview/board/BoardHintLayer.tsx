import type { HintCell } from "../layout/hints"
import { GAP, ROW_HEIGHT } from "../layout/metrics"

interface BoardHintLayerProps {
  cells: readonly HintCell[]
}

/**
 * The dashed 1x1 squares drawn over every free cell while the board is being edited.
 *
 * Sits behind the tiles and takes no pointer events, so a press that lands on a hint is a press on
 * the board underneath it. Cells are positioned off the same `--overview-cell` expression the tiles
 * use, which is what keeps a hint square aligned with the tile that would land on it.
 *
 * The outline is an SVG rect rather than a dashed CSS border because the dash pattern is part of
 * the design and CSS does not let you name one: a `border-dashed` hairline gets whatever length
 * the engine picks.
 */
export function BoardHintLayer({ cells }: BoardHintLayerProps) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {cells.map((cell) => (
        <div
          key={`${cell.column}:${cell.row}`}
          className="absolute grid place-items-center"
          style={{
            left: `calc(var(--overview-cell) * ${cell.column} + ${cell.column * GAP}px)`,
            width: "var(--overview-cell)",
            top: cell.row * (ROW_HEIGHT + GAP),
            height: ROW_HEIGHT,
          }}
        >
          {/* overflow-visible because a column width is a fraction of the board: the outline can
              land on a subpixel and lose an edge to clipping otherwise. */}
          <svg className="absolute inset-0 size-full overflow-visible">
            <rect
              className="fill-none stroke-line"
              // Inset by half the stroke so the outline sits inside the cell rather than straddling
              // its edge, which would make a hint square read a pixel wider than the tile it marks.
              style={{ x: "0.75px", y: "0.75px", width: "calc(100% - 1.5px)", height: "calc(100% - 1.5px)", rx: "12px" }}
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
          </svg>
          <span className="relative font-mono text-caption text-text-faded">1×1</span>
        </div>
      ))}
    </div>
  )
}
