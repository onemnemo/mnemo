import { AppIcon } from "@/components/icon/AppIcon"
import { useDecksQuery } from "@/flashcards/api"
import { useT } from "@/i18n/useT"

import { settingString } from "../../config/encode"
import { Body, Empty, Head, Legend, MixBar, Stat, useWidgetTitle } from "../../parts"
import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading } from "../states"

const NS = "WidgetDeck"

/**
 * One deck, its queue and a way in.
 *
 * The configured deck is looked up in the library list rather than fetched by id, so a tile
 * pointed at a deleted deck is a lookup that misses instead of a 404 dressed up as a broken
 * widget. An unset or missing deck falls back to the first in the library, which is what makes a
 * freshly added tile show something rather than an instruction to go and configure it.
 */
export function DeckSpotlightWidget({ instance, manifest, renderColumns }: WidgetProps) {
  const t = useT()
  const title = useWidgetTitle(manifest)
  const decks = useDecksQuery()

  const configured = settingString(manifest, instance.settings, "deck")
  const deckList = decks.data ?? []
  const deck = deckList.find((candidate) => candidate.id === configured) ?? deckList[0]

  if (decks.isPending || decks.isError || deck === undefined) {
    return (
      <Body>
        <Head title={title} icon="square-stack" />
        {decks.isPending ? (
          <div className="mt-2 flex-1">
            <WidgetLoading rows={2} />
          </div>
        ) : decks.isError ? (
          <WidgetError onRetry={() => void decks.refetch()} />
        ) : (
          <Empty>{t(NS, "NoDecks")}</Empty>
        )}
      </Body>
    )
  }

  const counts = deck.dueCounts
  const waiting = counts.new + counts.learning + counts.due

  return (
    <Body href={`#/flashcard-deck/${deck.id}`} title={deck.name}>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[15px] leading-none">
          {deck.icon ?? <AppIcon name="square-stack" size={16} strokeWidth={1.6} className="text-ink-icon" />}
        </span>
        <span className="min-w-0 truncate text-[12.5px] font-medium text-ink">{deck.name}</span>
      </div>

      <div className="mt-auto">
        {waiting > 0 ? (
          <>
            <Stat value={waiting} unit={renderColumns >= 2 ? t(NS, "CardsWaiting") : t(NS, "Due")} scale={0.8} />
            <MixBar counts={counts} className="mt-2" />
            {renderColumns >= 2 && (
              <Legend
                className="mt-1.5"
                items={[
                  { label: t(NS, "CountNew", { 0: counts.new }), dot: "bg-state-new" },
                  { label: t(NS, "CountLearning", { 0: counts.learning }), dot: "bg-state-learn" },
                  { label: t(NS, "CountReview", { 0: counts.due }), dot: "bg-state-due" },
                ]}
              />
            )}
          </>
        ) : (
          <p className="text-[12.5px] text-ink-3">{t(NS, "CaughtUpFormat", { 0: deck.totalCards })}</p>
        )}
      </div>
    </Body>
  )
}
