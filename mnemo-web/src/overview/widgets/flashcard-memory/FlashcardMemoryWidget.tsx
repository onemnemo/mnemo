import { useT } from "@/i18n/useT"

import { Body, Empty, Head, Ring, Spark, useWidgetTitle } from "../../parts"
import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading } from "../states"
import { useFlashcardMemory } from "./useFlashcardMemory"

const NS = "FlashcardMemory"

/**
 * True retention across the library, with a trend line for whichever deck is being worked hardest.
 *
 * The narrow size drops the right column outright rather than shrinking it. A 1x1 tile is about
 * 250px wide, and a sparkline squeezed into what is left beside the headline would be a smudge
 * with a dot on the end.
 */
export function FlashcardMemoryWidget({ instance, manifest }: WidgetProps) {
  const t = useT()
  const title = useWidgetTitle(manifest)
  const memory = useFlashcardMemory()

  const narrow = instance.size.columns <= 1

  if (memory.state !== "ready") {
    return (
      <Body>
        <Head title={title} icon="orbit" />
        {memory.state === "loading" ? (
          <div className="mt-2 flex-1">
            <WidgetLoading rows={2} />
          </div>
        ) : memory.state === "error" ? (
          <WidgetError onRetry={memory.retry} />
        ) : (
          <Empty>{t(NS, "EmptyState")}</Empty>
        )}
      </Body>
    )
  }

  return (
    <Body>
      <Head title={title} icon="orbit" />

      <div className="mt-3 flex min-h-0 flex-1 items-center gap-4">
        {/* The ring says "a proportion" before the number is read, which a bare percentage does
            not, and it holds the same meaning at every tile width. */}
        <Ring value={memory.retentionPercent / 100} size={52}>
          <span className="text-[13px] font-semibold tabular-nums text-ink">{memory.retentionPercent}%</span>
        </Ring>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] text-ink-2">{t(NS, "RetentionLabel")}</p>
          {/* The narrow size drops the trend outright rather than shrinking it. A 1x1 tile is about
              250px wide, and a sparkline squeezed into what is left beside the ring is a smudge. */}
          {!narrow && memory.trend.length > 1 && (
            <>
              <div className="mt-1.5 h-8 text-ink-3">
                <Spark values={memory.trend} />
              </div>
              <p className="mt-0.5 truncate text-[11.5px] text-ink-3">{memory.trendDeckName}</p>
            </>
          )}
        </div>
      </div>
    </Body>
  )
}
