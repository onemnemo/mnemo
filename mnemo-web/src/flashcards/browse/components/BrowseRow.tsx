import type { CardViewDto, DeckSummaryDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { Checkbox } from "@/components/ui/checkbox"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSubMenu,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { LEECH_LAPSES } from "@/flashcards/leeches"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { StateTag, cardStateKind } from "../../bits"
import { stripMath } from "../../math"
import { dueLabel, frontPreview, oneLine } from "../../deck/cards"
import { ACTIONS_CELL, BACK_CELL, DECK_CELL, ROW_GRID } from "./rowLayout"

export interface BrowseRowActions {
  onPeek: (id: string) => void
  onEdit: (id: string) => void
  onFlag: (id: string, value: boolean) => void
  onSuspend: (id: string, value: boolean) => void
  onMove: (id: string, targetDeckId: string) => void
  onDelete: (id: string) => void
}

/**
 * One card in the collection-wide browser. Generalizes deck/components/CardRow.tsx with a
 * Deck cell and a peek action; everything else - the flag rail, the front/back preview, the
 * state tag, due and lapses - reads exactly the way it does on one deck's table, because it is
 * the same card shape and the same reading of it.
 */
export function BrowseRow({
  view,
  deckName,
  selected,
  onToggleSelect,
  moveTargets,
  actions,
  now,
}: {
  view: CardViewDto
  /** Resolved client-side from the decks list; falls back to the raw id if a deck was just deleted. */
  deckName: string
  selected: boolean
  onToggleSelect: (id: string) => void
  moveTargets: DeckSummaryDto[]
  actions: BrowseRowActions
  now: number
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const { card, schedule } = view
  const suspended = card.state === "suspended"
  const due = dueLabel(view, now, fc)
  const front = frontPreview(card.front)
  const leech = schedule.lapses >= LEECH_LAPSES
  // Every row can name a different owning deck, so "move to" has to drop that row's own
  // deck from its own list rather than a page-wide exclusion.
  const rowMoveTargets = moveTargets.filter((deck) => deck.id !== card.deckId)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="row"
          onDoubleClick={() => actions.onEdit(card.id)}
          className={cn(
            ROW_GRID,
            "group/card h-11 cursor-pointer border-b border-line-soft transition-colors",
            selected ? "bg-frame-active" : "hover:bg-frame-hover",
            suspended && "opacity-55",
          )}
          style={{ transitionDuration: "var(--duration-instant)" }}
        >
          <Checkbox checked={selected} onToggle={() => onToggleSelect(card.id)} label={front} />

          {/* Flagged is a property of the card, so it reads on the row rather than
              only inside a filter. Always rendered: the slot has to hold its width
              whether or not this particular card is flagged. */}
          <AppIcon
            name="common/flag"
            size={12}
            className={cn(
              "shrink-0",
              card.isFlagged ? "text-state-due [&>svg]:fill-current" : "text-transparent",
            )}
          />

          <span className="flex min-w-0 items-center gap-1.5">
            {card.type === "cloze" ? <AppIcon name="braces" size={13} className="shrink-0 text-ink-icon" /> : null}
            <span className={cn("truncate text-[13px]", suspended ? "text-ink-3" : "text-ink")} title={card.front}>
              {front}
            </span>
          </span>

          <span className={cn(BACK_CELL, "truncate text-[13px] text-ink-3")} title={card.back}>
            {oneLine(stripMath(card.back))}
          </span>

          <span className={cn(DECK_CELL, "truncate text-[12.5px] text-ink-2")} title={deckName}>
            {deckName}
          </span>

          <StateTag state={cardStateKind(card, schedule)} />

          <span
            className={cn("text-right text-[12.5px]", due.isDue ? "font-medium text-state-due" : "text-ink-2")}
          >
            {due.text}
          </span>

          <span
            className={cn(
              "text-right text-[12.5px] tabular-nums",
              leech ? "font-medium text-state-learn" : "text-ink-3",
            )}
            title={leech ? fc("LeechHint") : undefined}
          >
            {schedule.lapses}
          </span>

          <span className={ACTIONS_CELL}>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                actions.onPeek(card.id)
              }}
              title={fc("PeekCard")}
              aria-label={fc("PeekCard")}
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-md text-ink-3 transition-opacity",
                "hover:bg-frame-active hover:text-ink",
                "opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100",
              )}
            >
              <AppIcon name="eye" size={13} />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                actions.onEdit(card.id)
              }}
              title={fc("EditCard")}
              aria-label={fc("EditCard")}
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-md text-ink-3 transition-opacity",
                "hover:bg-frame-active hover:text-ink",
                "opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100",
              )}
            >
              <AppIcon name="pencil" size={13} />
            </button>
          </span>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem icon="eye" onSelect={() => actions.onPeek(card.id)}>
          {fc("PeekCard")}
        </ContextMenuItem>
        <ContextMenuItem icon="flyout/rename" onSelect={() => actions.onEdit(card.id)}>
          {fc("EditCard")}
        </ContextMenuItem>
        <ContextMenuItem icon="common/flag" onSelect={() => actions.onFlag(card.id, !card.isFlagged)}>
          {fc("RowFlagToggle")}
        </ContextMenuItem>
        <ContextMenuItem icon="common/pause" onSelect={() => actions.onSuspend(card.id, !suspended)}>
          {fc("RowSuspendToggle")}
        </ContextMenuItem>
        {rowMoveTargets.length > 0 ? (
          <ContextMenuSubMenu label={fc("MoveToDeck")} icon="common/folder">
            {rowMoveTargets.map((deck) => (
              <ContextMenuItem key={deck.id} onSelect={() => actions.onMove(card.id, deck.id)}>
                {deck.name}
              </ContextMenuItem>
            ))}
          </ContextMenuSubMenu>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem icon="common/trash" danger onSelect={() => actions.onDelete(card.id)}>
          {fc("DeleteCard")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
