import { useT } from "@/i18n/useT"

import { DashedOutline } from "../board/DashedOutline"

interface DropSlotProps {
  /** The dragged tile's span, e.g. 2×1, so the slot says what would land in it. */
  sizeLabel: string
}

/**
 * What a tile's slot shows while that tile is being dragged: the card is gone, not faded, and this
 * takes its place.
 *
 * It is the tile's *resolved* slot, so it moves with the drag as the engine re-places the board
 * around the pointer. It is not a hole left at the origin cell.
 */
export function DropSlot({ sizeLabel }: DropSlotProps) {
  const t = useT()

  return (
    <div className="relative h-full">
      {/* Two layers rather than one translucent fill: the outline has to stay at full strength while
          the tint behind it does not, and a single element cannot be 55% opaque in one place. */}
      <div className="absolute inset-0 rounded-lg bg-brand-subtle opacity-55" />
      <DashedOutline className="stroke-[var(--accent-border-subtle)]" />

      <div className="absolute inset-0 flex items-center justify-center gap-1.5">
        <span className="text-body-small text-brand">{t("Overview", "DropSlot")}</span>
        <span className="font-mono text-body-small text-brand">{sizeLabel}</span>
      </div>
    </div>
  )
}
