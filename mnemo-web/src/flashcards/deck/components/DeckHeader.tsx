import type { DeckSummaryDto } from "@/api/types"
import { navigate } from "@/app/router"
import { EmojiPickerButton } from "@/components/emoji/EmojiPickerButton"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import { formatRelative } from "@/lib/relative-date"

import { useUpdateDeck } from "../../api"
import { useCardEditor } from "../../editor/store"
import { RETENTION_TRACK_WIDTH } from "../cards"
import { DeckMenu } from "./DeckMenu"
import { StudySplitButton } from "./StudySplitButton"

/**
 * Deck name, the row of sub-stats, and the page's actions.
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

  const { learning, due, total: dueToday } = deck.dueCounts
  const retention = Math.min(100, Math.max(0, deck.retentionPercent))

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
    <div className="flex items-start gap-2.5">
      <button
        type="button"
        onClick={() => navigate("flashcards")}
        title={fc("BackToLibrary")}
        aria-label={fc("BackToLibrary")}
        className="-ml-1.5 mt-0.5 grid size-8 shrink-0 place-items-center rounded-md text-text-secondary hover:bg-surface-subtle"
      >
        <AppIcon name="common/chevron-left" size={18} />
      </button>

      <div className="min-w-0 flex-1 space-y-1.5">
        {/* The icon is the affordance for changing it, with no separate control,
            and the empty state is just as clickable. */}
        <h1 className="flex min-w-0 items-center gap-2 text-heading-3 font-semibold text-text-primary">
          <EmojiPickerButton
            value={deck.icon}
            context={deck.name}
            onChange={setIcon}
            fallback="sidebar/flashcard"
            label={deck.icon ? fc("ChangeDeckIcon") : fc("AddDeckIcon")}
            size={32}
            glyphSize={17}
            className="-ml-1"
          />
          <span className="truncate" title={deck.name}>
            {deck.name}
          </span>
        </h1>

        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-body-extra-small text-text-tertiary">
          <span>{fc("DeckCardCountFormat", { 0: deck.totalCards })}</span>

          {learning > 0 ? (
            <span className="text-[var(--flashcard-state-learning)]">
              {learning} {fc("DeckStatLearningSuffix")}
            </span>
          ) : null}

          {due > 0 ? (
            <span className="text-brand">
              {due} {fc("DeckStatDueSuffix")}
            </span>
          ) : null}

          <span className="flex items-center gap-1.5">
            {fc("DeckRetentionLabel")}
            <span
              className="h-[3px] overflow-hidden rounded-sm bg-[var(--widget-background-primary)]"
              style={{ width: RETENTION_TRACK_WIDTH }}
            >
              <span
                className="block h-full rounded-sm bg-[var(--flashcard-retention-high)]"
                style={{ width: (RETENTION_TRACK_WIDTH * retention) / 100 }}
              />
            </span>
            <span className="font-mono text-text-secondary tabular-nums">{retention}%</span>
          </span>

          <span>
            {deck.lastStudied
              ? fc("DeckLastStudiedFormat", { 0: formatRelative(deck.lastStudied, Date.now(), t) })
              : fc("DeckNeverStudied")}
          </span>
        </div>
      </div>

      <div className="mt-0.5 flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => openAdd(deck.id)}>
          <AppIcon name="common/plus" size={14} />
          {fc("DeckAddCards")}
        </Button>
        <StudySplitButton deckId={deck.id} dueCount={dueToday} allCount={deck.activeCards} />
        <DeckMenu deck={deck} />
      </div>
    </div>
  )
}
