import { Sparkline } from "@/components/charts/Sparkline"
import { useT } from "@/i18n/useT"
import { useMeasuredWidth } from "@/lib/useMeasuredWidth"

import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading, WidgetMessage } from "../states"
import { useFlashcardMemory } from "./useFlashcardMemory"

const NS = "FlashcardMemory"

/** How tall the trend line is drawn. */
const TREND_HEIGHT = 34

/**
 * True retention across the library, with a trend line for whichever deck is being worked hardest.
 *
 * The narrow size drops the right column outright rather than shrinking it. A 1x1 tile is about
 * 250px wide, and a sparkline squeezed into what is left beside the headline would be a smudge
 * with a dot on the end.
 */
export function FlashcardMemoryWidget({ instance }: WidgetProps) {
  const t = useT()
  const memory = useFlashcardMemory()
  const { ref, width } = useMeasuredWidth<HTMLDivElement>()

  if (memory.state === "loading") return <WidgetLoading rows={2} />
  if (memory.state === "error") return <WidgetError onRetry={memory.retry} />
  if (memory.state === "empty") return <WidgetMessage>{t(NS, "EmptyState")}</WidgetMessage>

  const narrow = instance.size.columns <= 1

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-caption text-text-tertiary">{t(NS, "Subtitle")}</span>

      <div className="flex items-center gap-4">
        <div className="shrink-0">
          <div className="text-heading-3 font-semibold text-brand">{memory.retentionPercent}%</div>
          <div className="mt-0.5 text-caption text-text-secondary">{t(NS, "RetentionLabel")}</div>
        </div>

        {narrow ? null : (
          <div ref={ref} className="min-w-0 flex-1">
            <Sparkline
              values={memory.trend}
              width={width}
              height={TREND_HEIGHT}
              className="text-brand"
              dotClassName="text-brand"
            />
            <div className="mt-0.5 truncate text-center text-caption text-text-tertiary">{memory.trendDeckName}</div>
          </div>
        )}
      </div>
    </div>
  )
}
