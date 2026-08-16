import type { WidgetSizeDto } from "@/api/types"

/** The `C×R` label a size is shown as, everywhere one is shown. U+00D7, never an ASCII x. */
export function sizeLabel(size: WidgetSizeDto): string {
  return `${size.columns}×${size.rows}`
}
