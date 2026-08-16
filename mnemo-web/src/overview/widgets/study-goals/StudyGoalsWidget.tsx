import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { Body, Head, Ring, useWidgetTitle } from "../../parts"
import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading } from "../states"
import { useStudyGoals } from "./useStudyGoals"

const NS = "WidgetGoals"

/**
 * Today's targets for cards, sessions and minutes.
 *
 * Two compositions of the same three numbers: a tall tile gets labelled rows, a wide-and-short one
 * gets rings. A row list crushed into 92px is unreadable, and three rings stretched down 256px are
 * three lonely circles.
 */
export function StudyGoalsWidget({ instance, manifest }: WidgetProps) {
  const t = useT()
  const title = useWidgetTitle(manifest)
  const goals = useStudyGoals(instance, manifest)

  if (goals.state !== "ready") {
    return (
      <Body>
        <Head title={title} icon="target" />
        {goals.state === "loading" ? (
          <div className="mt-2 flex-1">
            <WidgetLoading rows={3} />
          </div>
        ) : (
          <WidgetError onRetry={goals.retry} />
        )}
      </Body>
    )
  }

  if (instance.size.rows >= 2) {
    return (
      <Body>
        <Head title={title} icon="target" />
        <div className="mt-2 flex flex-1 flex-col justify-center gap-4">
          {goals.goals.map((goal) => (
            <div key={goal.titleKey}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[12.5px] text-ink">{t(NS, goal.titleKey)}</span>
                <span className="shrink-0 text-[12px] tabular-nums text-ink-3">
                  <span className="font-medium text-ink-2">{goal.completed}</span>
                  {" / "}
                  {goal.target}
                </span>
              </div>
              {/* The fill keeps its own radius rather than relying on the track clipping it, so a
                  bar a few pixels along reads as a rounded stub instead of a square-ended sliver. */}
              <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-canvas-sunken">
                <span
                  className={cn("block h-full rounded-full", goal.percent >= 100 ? "bg-ink-2" : "bg-ink-3/60")}
                  style={{ width: `${goal.percent}%` }}
                />
              </span>
            </div>
          ))}
        </div>
      </Body>
    )
  }

  return (
    <Body>
      <Head title={title} icon="target" />
      <div className="flex flex-1 items-center justify-around gap-2">
        {goals.goals.map((goal) => (
          <div key={goal.titleKey} className="flex min-w-0 flex-col items-center gap-1">
            <Ring value={goal.percent / 100} size={38} stroke={3}>
              <span className="text-[10.5px] font-semibold tabular-nums text-ink">{goal.completed}</span>
            </Ring>
            <span className="max-w-full truncate text-[10.5px] text-ink-3">{t(NS, `${goal.titleKey}Short`)}</span>
          </div>
        ))}
      </div>
    </Body>
  )
}
