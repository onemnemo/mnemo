import { navigate } from "@/app/router"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"

import { Body, Empty, Head, ItemRow, Legend, MixBar, Stat, useWidgetTitle } from "../../parts"
import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading } from "../states"
import { estimateMinutes, useToday } from "./useToday"

const NS = "WidgetToday"

/**
 * Today's queue.
 *
 * Three compositions, not one design stretched: 4x1 is a strip, so the three facts sit side by
 * side; anything narrower stacks them; and a tall tile adds the deck breakdown underneath. Laying
 * the strip out as the stacked version leaves two thirds of a 700px box empty, which is what makes
 * a board look unfinished.
 */
export function TodayWidget({ instance, manifest, renderColumns }: WidgetProps) {
  const t = useT()
  const title = useWidgetTitle(manifest)
  const today = useToday()

  const rows = instance.size.rows
  const total = today.counts.new + today.counts.learning + today.counts.due

  if (today.state !== "ready") {
    return (
      <Body>
        <Head title={title} icon="calendar-clock" />
        {today.state === "loading" ? (
          <div className="mt-2 flex-1">
            <WidgetLoading rows={2} />
          </div>
        ) : (
          <WidgetError onRetry={today.retry} />
        )}
      </Body>
    )
  }

  if (total === 0) {
    return (
      <Body>
        <Head title={title} icon="calendar-clock" />
        <Empty>{t(NS, "CaughtUp")}</Empty>
      </Body>
    )
  }

  const legend = [
    { label: t(NS, "CountNew", { 0: today.counts.new }), dot: "bg-state-new" },
    { label: t(NS, "CountLearning", { 0: today.counts.learning }), dot: "bg-state-learn" },
    { label: t(NS, "CountReview", { 0: today.counts.due }), dot: "bg-state-due" },
  ]

  const study = (
    <Button
      className="shrink-0"
      icon={<AppIcon name="play" size={14} strokeWidth={0} className="fill-current" />}
      onClick={() => navigate("flashcards")}
    >
      {t(NS, "Study")}
    </Button>
  )

  if (renderColumns >= 4) {
    return (
      <Body>
        <Head title={title} icon="calendar-clock" />
        <div className="flex flex-1 items-center gap-7">
          <div className="shrink-0">
            <Stat value={total} unit={t("Overview", "cards")} scale={1.2} />
            <p className="mt-1 text-[12px] text-ink-3">{t(NS, "AboutMinutes", { 0: estimateMinutes(total) })}</p>
          </div>
          <div className="min-w-0 flex-1">
            <MixBar counts={today.counts} />
            <Legend items={legend} className="mt-2.5" />
          </div>
          {study}
        </div>
      </Body>
    )
  }

  return (
    <Body>
      <Head title={title} icon="calendar-clock" />
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <Stat value={total} unit={t("Overview", "cards")} />
        {study}
      </div>
      <MixBar counts={today.counts} className="mt-2.5" />
      <Legend items={legend} className="mt-1.5" />

      {rows >= 2 && (
        <div className="mt-4 min-h-0 flex-1 border-t border-line-soft pt-3">
          <Head title={t(NS, "WhereTheWorkIs")} className="mb-1.5" />
          {today.decks.map((deck) => (
            <ItemRow
              key={deck.id}
              glyph={
                deck.icon ?? <AppIcon name="square-stack" size={14} strokeWidth={1.6} className="text-ink-icon" />
              }
              title={deck.name}
              meta={String(deck.waiting)}
              href={`#/flashcard-deck/${deck.id}`}
            />
          ))}
        </div>
      )}
    </Body>
  )
}
