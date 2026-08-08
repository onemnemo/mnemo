import type { HintCell } from "../layout/hints"
import { GAP, ROW_HEIGHT } from "../layout/metrics"
import { DashedOutline } from "./DashedOutline"

interface BoardHintLayerProps {
  cells: readonly HintCell[]
}

/**
 * The dashed 1x1 squares drawn over every free cell while the board is being edited.
 *
 * Sits behind the tiles and takes no pointer events, so a press that lands on a hint is a press on
 * the board underneath it. Cells are positioned off the same `--overview-cell` expression the tiles
 * use, which is what keeps a hint square aligned with the tile that would land on it.
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
          <DashedOutline className="stroke-line" />
          <span className="relative font-mono text-caption text-text-faded">1×1</span>
        </div>
      ))}
    </div>
  )
}
