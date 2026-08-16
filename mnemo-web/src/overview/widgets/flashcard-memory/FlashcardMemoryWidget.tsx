import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import { Body, Empty, Head, Ring, Spark, useWidgetTitle } from "../../parts"
import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading } from "../states"
import { useFlashcardMemory } from "./useFlashcardMemory"

const NS = "WidgetRetention"

/**
 * How much of what gets reviewed is actually recalled, across the library.
 *
 * The ring says "a proportion" before the number is read, which a bare percentage does not, and it
 * holds the same meaning at every tile width. The wide size trades ring diameter for a sentence
 * about the direction, since a number with no direction is a number nobody can act on.
 */
export function FlashcardMemoryWidget({ manifest, renderColumns }: WidgetProps) {
  const t = useT()
  const title = useWidgetTitle(manifest)
  const memory = useFlashcardMemory()

  if (memory.state !== "ready") {
    return (
      <Body>
        <Head title={title} icon="target" />
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

  const ring = (size: number) => (
    <Ring value={memory.retentionPercent / 100} size={size} stroke={size >= 56 ? 4 : 3.5}>
      <span className="font-semibold tabular-nums text-ink" style={{ fontSize: size >= 56 ? 15 : 13 }}>
        {memory.retentionPercent}%
      </span>
    </Ring>
  )

  if (renderColumns >= 2) {
    const rising = memory.trendDelta >= 0
    return (
      <Body>
        <Head title={title} icon="target" />
        <div className="flex flex-1 items-center gap-4">
          {ring(52)}
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <div className="h-[26px] w-full text-ink-3">
              <Spark values={memory.trend} />
            </div>
            <p className="mt-1.5 flex items-center gap-1 text-[12px] text-ink-2">
              <AppIcon
                name={rising ? "trending-up" : "trending-down"}
                size={14}
                strokeWidth={1.9}
                className="shrink-0 text-ink-icon"
              />
              <span className="truncate">
                {t(NS, "TrendFormat", {
                  0: `${rising ? "+" : ""}${memory.trendDelta.toFixed(1)}`,
                  1: memory.trendDays,
                })}
              </span>
            </p>
          </div>
        </div>
      </Body>
    )
  }

  return (
    <Body>
      <Head title={title} icon="target" />
      <div className="flex flex-1 items-center justify-center gap-3">
        {ring(56)}
        <div className="h-[30px] flex-1 text-ink-3">
          <Spark values={memory.trend} />
        </div>
      </div>
    </Body>
  )
}
