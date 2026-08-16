import type { CSSProperties } from "react"

import type { WidgetInstanceDto, WidgetSizeDto } from "@/api/types"
import { cn } from "@/lib/utils"

import { computePlacements, extentHeightForRows } from "../layout/compute"
import { freeCells } from "../layout/hints"
import { GAP, ROW_HEIGHT } from "../layout/metrics"
import { useBoardWidth } from "../layout/useBoardWidth"
import { useOverviewStore } from "../store"
import { WidgetTile } from "../tile/WidgetTile"
import { AddHereSlot } from "./AddHereSlot"
import { DragGhost } from "./DragGhost"
import { useBoardDrag } from "./useBoardDrag"

interface WidgetBoardProps {
  widgets: readonly WidgetInstanceDto[]
  isEditMode: boolean
  onRemove: (instanceId: string) => void
  onResize: (instanceId: string, size: WidgetSizeDto) => void
  onConfigure: (instanceId: string) => void
  onAdd: () => void
}

/**
 * The tile grid: runs the layout engine, then positions every tile absolutely.
 *
 * Absolute rather than CSS Grid because the engine is not expressing a grid. Tiles carry stored
 * coordinates that a dense pack may override, an in-flight drag pins one tile and reflows the rest
 * around it, and the dragged tile is not in a cell at all while the pointer holds it. Grid
 * auto-placement decides all of that itself and cannot be told the answer.
 *
 * Column widths stay in CSS. The engine needs the column *count*, and only the count changes which
 * cell a tile lands in, so a width that moves inside its bucket repaints without re-running
 * placement or re-rendering a single tile.
 */
export function WidgetBoard({ widgets, isEditMode, onRemove, onResize, onConfigure, onAdd }: WidgetBoardProps) {
  const { ref, columnCount } = useBoardWidth<HTMLDivElement>()
  // Drag substate is read here rather than threaded down from the route: the anchor is an input to
  // the layout pass, and the layout pass is this component.
  const dragged = useOverviewStore((state) => state.dragged)
  const anchorIndex = useOverviewStore((state) => state.anchorIndex)
  const dragPosition = useOverviewStore((state) => state.dragPosition)

  // The dragged tile is placed first so it keeps the cell the pointer chose and everything else
  // resolves around it. -1 outside a drag, where placement runs in plain list order.
  const placements = computePlacements(widgets, columnCount, anchorIndex)
  const usedRows = Math.max(0, ...placements.map((placement) => placement.row + placement.rowSpan))
  const contentHeight = extentHeightForRows(usedRows)

  const { onTilePointerDown } = useBoardDrag(ref, { columnCount, usedRows, placements })

  // The offer to add a tile goes in the first free cell, including the growth row, and only when
  // nothing is in the air: a dashed square under a moving tile is two answers to the same question.
  const firstFree = isEditMode && dragged === null ? freeCells(placements, columnCount)[0] : undefined
  const draggedPlacement = dragged === null ? undefined : placements[anchorIndex]

  const cell: CSSProperties = {
    // One column's width, gaps already taken out. Declared once so every tile's left and width
    // derive from the same expression instead of each repeating the subtraction.
    "--overview-cell": `calc((100% - ${(columnCount - 1) * GAP}px) / ${columnCount})`,
    // Edit mode reserves a row below the content, so there is always a free cell to drop onto and
    // the board can grow downwards without the user having to make room first.
    height: isEditMode ? contentHeight + (contentHeight > 0 ? GAP : 0) + ROW_HEIGHT : contentHeight,
  } as CSSProperties

  return (
    <div ref={ref} className="relative w-full" style={cell}>
      {draggedPlacement && <DragGhost placement={draggedPlacement} />}

      {widgets.map((widget, index) => {
        const placement = placements[index]
        const isDragging = widget.instanceId === dragged
        // Free of the grid while the pointer holds it, and only once the gesture has reported a
        // position; before that it stays in its placed cell rather than jumping to a corner.
        const floating = isDragging && dragPosition !== null

        return (
          <div
            key={widget.instanceId}
            className={cn(
              "absolute",
              // Tiles slide to the position the engine gave them, which is how a reflow reads as
              // the board making room rather than as everything teleporting. The dragged tile is
              // excluded: it has to be where the pointer is this frame, not on its way there.
              // Only the coordinates animate; a span change is instant, as on the desktop.
              !isDragging && "transition-[left,top] duration-200 ease-[cubic-bezier(0.215,0.61,0.355,1)]",
            )}
            style={{
              left: floating
                ? dragPosition.x
                : `calc(var(--overview-cell) * ${placement.column} + ${placement.column * GAP}px)`,
              top: floating ? dragPosition.y : placement.row * (ROW_HEIGHT + GAP),
              width: `calc(var(--overview-cell) * ${placement.columnSpan} + ${(placement.columnSpan - 1) * GAP}px)`,
              height: placement.rowSpan * ROW_HEIGHT + (placement.rowSpan - 1) * GAP,
              // The tile under the pointer has to sit above its neighbours, or it slides behind
              // the corner of whichever tile is making room for it.
              zIndex: isDragging ? 30 : 1,
            }}
          >
            <WidgetTile
              instance={widget}
              isEditMode={isEditMode}
              isDragging={isDragging}
              // Below two columns every tile spans the board, so nothing should draw its narrow
              // composition however few cells it nominally owns.
              renderColumns={columnCount === 1 ? Math.max(2, widget.size.columns) : widget.size.columns}
              onRemove={onRemove}
              onResize={onResize}
              onConfigure={onConfigure}
              onTilePointerDown={onTilePointerDown}
            />
          </div>
        )
      })}

      {firstFree && <AddHereSlot cell={firstFree} onAdd={onAdd} />}
    </div>
  )
}
