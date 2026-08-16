import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import type { HintCell } from "../layout/hints"
import { GAP, ROW_HEIGHT } from "../layout/metrics"

/**
 * One dashed square, in the first free cell, offering to add a widget there.
 *
 * One rather than a dashed square in every free cell. A board wearing a placeholder everywhere it
 * could hold something is graph paper: it reads as broken rather than as editable, and it competes
 * with the tiles the reader is trying to rearrange. One is an offer; twelve are a texture.
 */
export function AddHereSlot({ cell, onAdd }: { cell: HintCell; onAdd: () => void }) {
  const t = useT()

  return (
    <button
      type="button"
      onClick={onAdd}
      className="absolute flex flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-line text-ink-3 transition-colors hover:border-ink-3/50 hover:bg-frame-hover hover:text-ink-2"
      style={{
        left: `calc(var(--overview-cell) * ${cell.column} + ${cell.column * GAP}px)`,
        width: "var(--overview-cell)",
        top: cell.row * (ROW_HEIGHT + GAP),
        height: ROW_HEIGHT,
        transitionDuration: "var(--duration-fast)",
      }}
    >
      <AppIcon name="plus" size={16} strokeWidth={1.8} />
      <span className="text-[11.5px]">{t("Overview", "AddWidget")}</span>
    </button>
  )
}
