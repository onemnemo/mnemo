interface DashedOutlineProps {
  /** Stroke colour utility for the outline, e.g. `stroke-line`. */
  className: string
}

/**
 * The dashed rounded outline both empty-cell affordances wear: the hint squares over free cells and
 * the drop slot a dragged tile leaves behind. Fills its positioned parent.
 *
 * An SVG rect rather than a dashed CSS border because the dash pattern is part of the design and
 * CSS does not let you name one: a `border-dashed` hairline gets whatever length the engine picks.
 */
export function DashedOutline({ className }: DashedOutlineProps) {
  return (
    // overflow-visible because a column width is a fraction of the board: the outline can land on a
    // subpixel and lose an edge to clipping otherwise.
    <svg className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
      <rect
        className={`fill-none ${className}`}
        // Inset by half the stroke so the outline sits inside the cell rather than straddling its
        // edge, which would make it read a pixel wider than the tile it stands in for.
        style={{ x: "0.75px", y: "0.75px", width: "calc(100% - 1.5px)", height: "calc(100% - 1.5px)", rx: "12px" }}
        strokeWidth={1.5}
        strokeDasharray="4 4"
      />
    </svg>
  )
}
