import type { CSSProperties } from "react"

import type { WidgetInstanceDto } from "@/api/types"

import { computePlacements, extentHeightForRows } from "../layout/compute"
import { GAP, ROW_HEIGHT } from "../layout/metrics"
import { useBoardWidth } from "../layout/useBoardWidth"
import { WidgetTile } from "../tile/WidgetTile"

interface WidgetBoardProps {
  widgets: readonly WidgetInstanceDto[]
  onRemove: (instanceId: string) => void
}

/**
 * The tile grid: runs the layout engine, then positions every tile absolutely.
 *
 * Absolute rather than CSS Grid because the engine is not expressing a grid. Tiles carry stored
 * coordinates that a dense pack may override, an in-flight drag pins one tile and reflows the rest
 * around it, and both apps have to agree on the result cell for cell. Grid auto-placement decides
 * all of that itself and cannot be told the answer.
 *
 * Column widths stay in CSS. The engine needs the column *count*, and only the count changes which
 * cell a tile lands in, so a width that moves inside its bucket repaints without re-running
 * placement or re-rendering a single tile.
 */
export function WidgetBoard({ widgets, onRemove }: WidgetBoardProps) {
  const { ref, columnCount } = useBoardWidth<HTMLDivElement>()

  // -1: no tile is pinned outside a drag, so placement resolves in plain list order.
  const placements = computePlacements(widgets, columnCount, -1)
  const usedRows = Math.max(0, ...placements.map((placement) => placement.row + placement.rowSpan))

  const cell: CSSProperties = {
    // One column's width, gaps already taken out. Declared once so every tile's left and width
    // derive from the same expression instead of each repeating the subtraction.
    "--overview-cell": `calc((100% - ${(columnCount - 1) * GAP}px) / ${columnCount})`,
    height: extentHeightForRows(usedRows),
  } as CSSProperties

  return (
    <div ref={ref} className="relative w-full" style={cell}>
      {widgets.map((widget, index) => {
        const placement = placements[index]
        return (
          <div
            key={widget.instanceId}
            className="absolute"
            style={{
              left: `calc(var(--overview-cell) * ${placement.column} + ${placement.column * GAP}px)`,
              width: `calc(var(--overview-cell) * ${placement.columnSpan} + ${(placement.columnSpan - 1) * GAP}px)`,
              top: placement.row * (ROW_HEIGHT + GAP),
              height: placement.rowSpan * ROW_HEIGHT + (placement.rowSpan - 1) * GAP,
            }}
          >
            <WidgetTile instance={widget} onRemove={onRemove} />
          </div>
        )
      })}
    </div>
  )
}
