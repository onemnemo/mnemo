import { useLayoutEffect, useRef, useState } from "react"

import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { ActivityDay } from "../../data/useDailyActivity"
import { GAP, ROW_HEIGHT } from "../../layout/metrics"
import { LEVELS, levelFor, toWeeks } from "./levels"

/**
 * The grid of day squares.
 *
 * A component rather than inline JSX because it has to measure itself. The cells cannot be sized in
 * CSS: `aspect-square` would take the square's width from its height, but the height comes from a
 * flex column whose width is the thing being derived, so it resolves to zero and the heatmap
 * vanishes. Height is a constant and can be computed; width has to be observed.
 */
export function Heatmap({ days, rowSpan }: { days: readonly ActivityDay[]; rowSpan: number }) {
  const t = useT()
  const host = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const element = host.current
    if (element === null) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    // Measured before subscribing: the observer's first callback is a frame late, and a heatmap
    // that paints at zero width and then snaps reads as a rendering fault.
    setWidth(element.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [])

  const weeks = toWeeks(days)
  const peak = days.reduce((max, day) => Math.max(max, day.reviews), 0)

  // What is left of the tile once the head and, on a tall tile, the legend have taken their share.
  const budget = rowSpan * ROW_HEIGHT + (rowSpan - 1) * GAP - 28 - (26 + (rowSpan >= 2 ? 30 : 0))
  // The gaps are budgeted at their minimum here; the real pitch is worked out below from what is
  // left over. Assuming a generous gap costs a whole pixel of cell size, which at seven pixels is
  // a seventh of the widget.
  const cell = Math.max(5, Math.min(14, Math.floor((budget - 2 * 6) / 7)))

  const fits = Math.max(1, Math.floor((width + 2) / (cell + 2)))
  const shown = Math.min(weeks.length, fits)
  const pitch = shown > 1 ? Math.max(2, Math.min(5, (width - shown * cell) / (shown - 1))) : 2

  return (
    <div
      ref={host}
      // Reversed so the columns pack from the right: when there is more history than room, the
      // weeks that get clipped are the old ones, and the fade says so rather than looking like a
      // rendering fault.
      className="mt-2.5 flex w-full flex-row-reverse justify-start overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_28px)]"
      style={{ gap: pitch }}
    >
      {weeks
        .slice(weeks.length - shown)
        .reverse()
        .map((week, weekIndex) => (
          <div key={weekIndex} className="flex shrink-0 flex-col" style={{ gap: pitch }}>
            {week.map((day, dayIndex) => (
              <span
                key={dayIndex}
                title={day ? t("WidgetActivity", "ReviewsOnDay", { 0: day.reviews, 1: day.day }) : undefined}
                className={cn("rounded-[2px]", day ? LEVELS[levelFor(day.reviews, peak)] : "bg-transparent")}
                style={{ width: cell, height: cell }}
              />
            ))}
          </div>
        ))}
    </div>
  )
}
