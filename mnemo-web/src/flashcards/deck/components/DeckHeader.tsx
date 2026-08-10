import type { DeckSummaryDto } from "@/api/types"
import { EmojiPickerButton } from "@/components/emoji/EmojiPickerButton"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import { formatRelative } from "@/lib/relative-date"

import { useUpdateDeck } from "../../api"
import { Retention } from "../../bits"
import { useCardEditor } from "../../editor/store"
import { estimatedMinutes } from "../../library/tree"
import { DeckMenu } from "./DeckMenu"
import { StudySplitButton } from "./StudySplitButton"

/**
 * Deck name, one strip of facts, and the page's actions.
 *
 * The counts here come from the deck summary and are clipped to the preset's daily
 * budget, so they can read lower than the number of rows the matching filter chip
 * turns up in the table below. That is the desktop's behaviour: this line answers
 * "what will I study today", the filter answers "what is in this deck".
 */
export function DeckHeader({ deck }: { deck: DeckSummaryDto }) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)
  const openAdd = useCardEditor((state) => state.openAdd)
  const updateDeck = useUpdateDeck()

  const { total: work } = deck.dueCounts

  // The header is a full replace, so the fields that are not changing have to be
  // sent back as they are or the update clears them.
  const setIcon = (icon: string | null) =>
    void updateDeck.mutateAsync({
      id: deck.id,
      name: deck.name,
      description: deck.description,
      tags: deck.tags,
      icon,
    })

  return (
    <header className="mt-2 flex items-start justify-between gap-4">
      <div className="min-w-0">
        {/* The icon is the affordance for changing it, with no separate control,
            and the empty state is just as clickable. */}
        <h1 className="flex min-w-0 items-center gap-2 text-[22px] font-semibold tracking-[-0.02em] text-ink">
          <EmojiPickerButton
            value={deck.icon}
            context={deck.name}
            onChange={setIcon}
            fallback="square-stack"
            label={deck.icon ? fc("ChangeDeckIcon") : fc("AddDeckIcon")}
            size={32}
            glyphSize={18}
            className="-ml-1"
          />
          <span className="truncate" title={deck.name}>
            {deck.name}
          </span>
        </h1>

        {/* One strip of facts, separated by space rather than by pipes. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px] text-ink-2">
          <span>{fc("DeckCardCountFormat", { 0: deck.totalCards.toLocaleString() })}</span>

          <span>
            {work > 0 ? (
              <>
                <span className="font-medium text-state-due">
                  {work} {fc("DeckStatDueSuffix")}
                </span>
                {" · "}
                {fc("EstimatedMinutesFormat", { 0: estimatedMinutes(work) })}
              </>
            ) : (
              fc("DeckCaughtUp")
            )}
          </span>

          <span className="flex items-center gap-2">
            {fc("DeckRetentionLabel")}
            {/* No reviews to measure is not 0% remembered, and the bar has to say so.
                lastStudied cannot answer this: it is a lifetime timestamp, while the
                score is measured over a window that may hold nothing. */}
            <Retention percent={deck.retentionSampleSize > 0 ? deck.retentionPercent : null} />
          </span>

          <span className="text-ink-3">
            {deck.lastStudied
              ? fc("DeckLastStudiedFormat", { 0: formatRelative(deck.lastStudied, Date.now(), t) })
              : fc("DeckNeverStudied")}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" icon={<AppIcon name="plus" size={14} strokeWidth={1.9} />} onClick={() => openAdd(deck.id)}>
          {fc("DeckAddCards")}
        </Button>
        <StudySplitButton deckId={deck.id} dueCount={work} allCount={deck.activeCards} />
        <DeckMenu deck={deck} />
      </div>
    </header>
  )
}
