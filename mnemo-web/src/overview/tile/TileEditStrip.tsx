import type { PointerEvent as ReactPointerEvent } from "react"

import type { WidgetSizeDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { IconButton } from "@/components/ui/icon-button"
import { useT } from "@/i18n/useT"

import { sameSize } from "../widgets/manifest"
import { SizeChip } from "./SizeChip"

interface TileEditStripProps {
  title: string
  /** An unavailable tile shows its raw widget id, so the title is mono and reads as an identifier. */
  isUnavailable: boolean
  sizes: readonly WidgetSizeDto[]
  current: WidgetSizeDto
  onResize: (size: WidgetSizeDto) => void
  onRemove: () => void
  /** Absent for a widget with no settings, which is what decides whether the gear renders at all. */
  onConfigure?: () => void
  onHandlePointerDown: (event: ReactPointerEvent) => void
}

/**
 * The header a tile wears in edit mode, in place of its title row: a grip and title on the left,
 * then the size chips, the gear and the remove x.
 *
 * The grip and the title are one surface rather than two, because together they are the drag
 * handle: the title is the widest reliable thing to grab, and a 16px grip on its own is not a
 * target anyone hits. The press listener sits on that surface and nowhere else, which is what makes
 * a press on a size chip, the gear or the remove x not a drag.
 */
export function TileEditStrip({
  title,
  isUnavailable,
  sizes,
  current,
  onResize,
  onRemove,
  onConfigure,
  onHandlePointerDown,
}: TileEditStripProps) {
  const t = useT()

  return (
    <div>
      <div className="mx-2 mt-0.5 flex h-[30px] items-center">
        <div
          className="flex min-w-0 flex-1 cursor-move items-center gap-[7px] pr-2 pl-1"
          onPointerDown={onHandlePointerDown}
        >
          <AppIcon name="common/grip-vertical" size={16} className="shrink-0 text-text-tertiary" />
          {isUnavailable ? (
            <span className="min-w-0 truncate font-mono text-caption text-text-tertiary">{title}</span>
          ) : (
            <span className="min-w-0 truncate text-caption font-semibold text-text-secondary">{title}</span>
          )}
        </div>

        <div className="mr-1.5 flex shrink-0 items-center gap-[3px]">
          {sizes.map((size) => (
            <SizeChip
              key={`${size.columns}x${size.rows}`}
              size={size}
              selected={sameSize(size, current)}
              onSelect={onResize}
            />
          ))}
        </div>

        {onConfigure === undefined ? null : (
          <IconButton
            icon="common/cog"
            label={t("Overview", "ConfigureWidget")}
            className="shrink-0 p-1 text-text-secondary hover:bg-[var(--list-item-hover-background)] hover:text-text-secondary"
            onClick={onConfigure}
          />
        )}

        <IconButton
          icon="common/x"
          label={t("Overview", "RemoveWidget")}
          className="shrink-0 p-1 text-text-secondary hover:bg-[var(--list-item-hover-background)] hover:text-text-secondary"
          onClick={onRemove}
        />
      </div>

      {/* Separates the chrome from the content it is not part of, in the same accent the editing
          border uses so the two read as one mode rather than two decorations. */}
      <div className="mx-3 mt-0.5 border-t border-dashed border-[var(--accent-border-subtle)]" />
    </div>
  )
}
