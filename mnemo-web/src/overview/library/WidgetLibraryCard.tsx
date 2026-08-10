import { useState } from "react"

import type { WidgetSizeDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { sizeLabel } from "../tile/size-label"
import type { WidgetManifest } from "../widgets/manifest"
import { WidgetPreview } from "./WidgetPreview"

/**
 * Preview box widths, fixed because the modal is: 900 minus the 168px rail and 40px of padding,
 * split into two columns with a 12px gutter, less the card's own padding and a 12px inset, so a
 * full-width preview still reads as a tile sitting on a surface rather than as a panel butting
 * into the card's edges. A four-wide widget spans both columns, so the gallery grid echoes the
 * board grid.
 */
const CARD_WIDTH = 311 - 24
const WIDE_WIDTH = 658 - 24

interface WidgetLibraryCardProps {
  manifest: WidgetManifest
  title: string
  description: string
  /** How many of this widget are already on the board. */
  count: number
  onAdd: (size: WidgetSizeDto) => void
}

/**
 * One widget in the gallery: the widget itself, its name, and its sizes.
 *
 * A list of text rows is the wrong shape for choosing something whose entire value is visual. Here
 * every entry is the widget rendered live at true proportions, with its sizes switchable on the
 * preview, so you pick a widget by looking at it. That is the only way anyone actually picks one.
 */
export function WidgetLibraryCard({ manifest, title, description, count, onAdd }: WidgetLibraryCardProps) {
  const t = useT()
  const [size, setSize] = useState<WidgetSizeDto>(manifest.defaultSize)

  const wide = size.columns >= 4
  const blocked = count > 0 && manifest.allowMultiple !== true

  return (
    <div className={cn("flex flex-col rounded-xl p-3 shadow-[0_0_0_1px_var(--line-soft)]", wide && "col-span-2")}>
      <WidgetPreview manifest={manifest} size={size} boxWidth={wide ? WIDE_WIDTH : CARD_WIDTH} boxHeight={152} />

      <div className="mt-3 flex min-w-0 items-start gap-2">
        <AppIcon name={manifest.icon} size={16} strokeWidth={1.6} className="mt-px shrink-0 text-ink-icon" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
            <span className="truncate">{title}</span>
            {count > 0 && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-frame-active px-1.5 py-px text-[10.5px] font-medium text-ink-2">
                <AppIcon name="check" size={10} strokeWidth={2.6} />
                {count > 1 ? t("WidgetLibrary", "OnBoardCountFormat", { 0: count }) : t("WidgetLibrary", "OnBoard")}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{description}</p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-1">
        {manifest.supportedSizes.length > 1 &&
          manifest.supportedSizes.map((candidate) => {
            const label = sizeLabel(candidate)
            const selected = label === sizeLabel(size)
            return (
              <button
                key={label}
                type="button"
                aria-pressed={selected}
                onClick={() => setSize(candidate)}
                className={cn(
                  "h-[22px] rounded-md px-1.5 text-[11px] font-medium tabular-nums transition-colors",
                  selected ? "bg-frame-active text-ink" : "text-ink-3 hover:bg-frame-hover hover:text-ink-2",
                )}
                style={{ transitionDuration: "var(--duration-fast)" }}
              >
                {label}
              </button>
            )
          })}

        <Button
          variant={blocked ? "ghost" : "outline"}
          size="sm"
          disabled={blocked}
          onClick={() => onAdd(size)}
          icon={blocked ? undefined : <AppIcon name="plus" size={14} strokeWidth={2} />}
          title={blocked ? t("WidgetLibrary", "OnlyOnce") : undefined}
          className="ml-auto"
        >
          {blocked
            ? t("WidgetLibrary", "Added")
            : manifest.allowMultiple && count > 0
              ? t("WidgetLibrary", "AddAnother")
              : t("WidgetLibrary", "Add")}
        </Button>
      </div>
    </div>
  )
}
