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
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { StateTag, cardStateKind } from "../../bits"
import { stripMath } from "../../math"
import { LEECH_LAPSES, dueLabel, frontPreview, oneLine } from "../cards"
import { BACK_CELL, ROW_GRID } from "./rowLayout"

export interface CardRowActions {
  onEdit: (id: string) => void
  onFlag: (id: string, value: boolean) => void
  onSuspend: (id: string, value: boolean) => void
  onMove: (id: string, targetDeckId: string) => void
  onDelete: (id: string) => void
}

/**
 * One card in the deck table.
 *
 * Everything a card can have done to it is on right-click, but right-click is not
 * discoverable and neither is double-click until you have tried it, so the one
 * action worth reaching for gets a button that appears under the pointer.
 */
export function CardRow({
  view,
  selected,
  onToggleSelect,
  moveTargets,
  actions,
  now,
}: {
  view: CardViewDto
  selected: boolean
  onToggleSelect: (id: string) => void
  moveTargets: DeckSummaryDto[]
  actions: CardRowActions
  now: number
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const { card, schedule } = view
  const suspended = card.state === "suspended"
  const due = dueLabel(view, now, fc)
  const front = frontPreview(card.front)
  const leech = schedule.lapses >= LEECH_LAPSES

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
              // A flag reads as flagged when it is filled, not merely tinted; the source SVG
              // carries fill="none", so the fill has to be forced on from here.
              card.isFlagged ? "text-state-due [&>svg]:fill-current" : "text-transparent",
            )}
          />

          <span className="flex min-w-0 items-center gap-1.5">
            {/* A type column read "Classic" on almost every row. A marker only where
                the type differs says the same thing in no space at all. */}
            {card.type === "cloze" ? <AppIcon name="braces" size={13} className="shrink-0 text-ink-icon" /> : null}
            <span className={cn("truncate text-[13px]", suspended ? "text-ink-3" : "text-ink")} title={card.front}>
              {front}
            </span>
          </span>

          <span className={cn(BACK_CELL, "truncate text-[13px] text-ink-3")} title={card.back}>
            {oneLine(stripMath(card.back))}
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

          <button
            type="button"
            onClick={() => actions.onEdit(card.id)}
            title={fc("EditCard")}
            aria-label={fc("EditCard")}
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-md text-ink-3 transition-opacity",
              "hover:bg-frame-active hover:text-ink",
              "opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100",
            )}
          >
            <AppIcon name="pencil" size={14} />
          </button>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem icon="flyout/rename" onSelect={() => actions.onEdit(card.id)}>
          {fc("EditCard")}
        </ContextMenuItem>
        <ContextMenuItem icon="common/flag" onSelect={() => actions.onFlag(card.id, !card.isFlagged)}>
          {fc("RowFlagToggle")}
        </ContextMenuItem>
        <ContextMenuItem icon="common/pause" onSelect={() => actions.onSuspend(card.id, !suspended)}>
          {fc("RowSuspendToggle")}
        </ContextMenuItem>
        {moveTargets.length > 0 ? (
          <ContextMenuSubMenu label={fc("MoveToDeck")} icon="common/folder">
            {moveTargets.map((deck) => (
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
