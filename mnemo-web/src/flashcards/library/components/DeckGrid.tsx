import type { DeckSummaryDto } from "@/api/types"
import { navigate } from "@/app/router"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"

import { Counts, MixBar, Ring } from "../../bits"

/**
 * The same decks as cards rather than rows.
 *
 * Flat: folders are a list idea, and a grid that drew them would be a list with
 * worse alignment. Every deck in scope shows, wherever it lives.
 */
export function DeckGrid({
  decks,
  folderNames,
  onOpenDeck,
}: {
  decks: DeckSummaryDto[]
  /** Folder id to name, for the one line of context a tile has room for. */
  folderNames: ReadonlyMap<string, string>
  onOpenDeck: (id: string) => void
}) {
  return (
    <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(268px,1fr))] gap-3">
      {decks.map((deck) => (
        <DeckTile
          key={deck.id}
          deck={deck}
          folderName={deck.folderId === null ? null : (folderNames.get(deck.folderId) ?? null)}
          onOpen={() => onOpenDeck(deck.id)}
        />
      ))}
    </div>
  )
}

function DeckTile({
  deck,
  folderName,
  onOpen,
}: {
  deck: DeckSummaryDto
  folderName: string | null
  onOpen: () => void
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const work = deck.dueCounts.total
  const started = deck.lastStudied !== null
  const idle = work === 0 && started

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen()
        }
      }}
      className="group/tile flex cursor-pointer flex-col rounded-xl p-3.5 shadow-[0_0_0_1px_var(--line-soft)] outline-none transition-shadow hover:shadow-canvas focus-visible:shadow-canvas"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-canvas-sunken">
          {deck.icon ? (
            <span aria-hidden className="text-[16px] leading-none">
              {deck.icon}
            </span>
          ) : (
            <AppIcon name="square-stack" size={16} className="text-ink-icon" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-ink" title={deck.name}>
            {deck.name}
          </span>
          <span className="block truncate text-[12px] text-ink-3">
            {folderName ?? fc("NoFolder")}
            {" · "}
            {fc("DeckCardCountFormat", { 0: deck.totalCards.toLocaleString() })}
          </span>
        </span>

        <Ring percent={deck.retentionSampleSize > 0 ? deck.retentionPercent : null} />
      </div>

      <MixBar counts={deck.dueCounts} className="mt-3.5" />

      <div className="mt-3 flex items-center justify-between gap-2">
        {work > 0 ? (
          <Counts counts={deck.dueCounts} />
        ) : (
          <span className="text-[12.5px] text-ink-3">{started ? fc("DeckCaughtUp") : fc("DeckNotStarted")}</span>
        )}

        <Button
          variant={work > 0 ? "solid" : "outline"}
          disabled={idle}
          onClick={(event) => {
            event.stopPropagation()
            navigate("flashcard-session", deck.id, "review", "due")
          }}
          className="h-7 px-2.5"
        >
          {work > 0 ? fc("Study") : fc("StudyStart")}
        </Button>
      </div>
    </div>
  )
}
