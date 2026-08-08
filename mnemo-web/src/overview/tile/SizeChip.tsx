import type { WidgetSizeDto } from "@/api/types"
import { cn } from "@/lib/utils"

interface SizeChipProps {
  size: WidgetSizeDto
  selected: boolean
  onSelect: (size: WidgetSizeDto) => void
}

/** The `C×R` label a size is shown as, everywhere one is shown. U+00D7, never an ASCII x. */
export function sizeLabel(size: WidgetSizeDto): string {
  return `${size.columns}×${size.rows}`
}

/**
 * One span the widget supports, as a chip. The selected chip is the tile's current span.
 *
 * `aria-pressed` rather than a radio group: the chips are a toolbar of toggles in the desktop and
 * reading them as a named set would put a group label on screen that the design does not have.
 */
export function SizeChip({ size, selected, onSelect }: SizeChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(size)}
      className={cn(
        "cursor-pointer rounded-sm border px-[7px] py-0.5 font-mono text-caption-button transition-colors duration-150",
        selected
          ? "border-[var(--accent-border-subtle)] bg-brand-subtle text-brand"
          : "border-line text-text-tertiary hover:border-[var(--accent-border-subtle)]",
      )}
    >
      {sizeLabel(size)}
    </button>
  )
}
