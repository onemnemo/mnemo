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

import { dueLabel, frontPreview } from "../cards"
import { MONO_CELL, ROW_GRID } from "./rowLayout"

export interface CardRowActions {
  onFlag: (id: string, value: boolean) => void
  onSuspend: (id: string, value: boolean) => void
  onMove: (id: string, targetDeckId: string) => void
  onDelete: (id: string) => void
}

/**
 * One card in the deck table. Actions live on right-click, matching the desktop -
 * there is no per-row button, so the row stays quiet until asked.
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
  const isCloze = card.type === "cloze"
  const due = dueLabel(view, now, fc)
  const firstTag = card.tags[0]

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="row"
          className={cn(
            ROW_GRID,
            "h-[37px] border-b border-divider-subtle",
            selected ? "bg-brand-subtle" : "hover:bg-[var(--widget-background-hover)]",
            suspended && "opacity-60",
          )}
        >
          <Checkbox
            checked={selected}
            onToggle={() => onToggleSelect(card.id)}
            label={frontPreview(card.front)}
          />

          <div className="flex min-w-0 items-center gap-1.5">
            {card.attachments.length > 0 ? (
              <AppIcon name="common/image" size={13} className="shrink-0 text-text-faded" />
            ) : null}
            {card.isFlagged ? (
              <AppIcon name="common/flag" size={13} className="shrink-0 text-[var(--flashcard-state-learning)]" />
            ) : null}
            {isCloze ? (
              <span className="mr-1.5 grid h-4 shrink-0 place-items-center rounded-sm bg-[var(--widget-background-primary)] px-1 font-mono text-caption text-[var(--flashcard-state-new)]">
                […]
              </span>
            ) : null}
            <span
              className={cn(
                "truncate text-body-extra-small font-medium",
                suspended ? "text-text-disabled line-through" : "text-text-primary",
              )}
              title={card.front}
            >
              {frontPreview(card.front)}
            </span>
          </div>

          <span className="text-caption text-text-tertiary">{fc(isCloze ? "TypeCloze" : "TypeClassic")}</span>

          <div className="min-w-0">
            {/* A suspended card shows that instead of its tag: the state is the more
                useful thing to know, and only one chip fits the column. */}
            {suspended ? (
              <TagChip className="text-[var(--flashcard-state-learning)]">{fc("SuspendedChip")}</TagChip>
            ) : firstTag ? (
              <TagChip className="text-text-tertiary">{firstTag}</TagChip>
            ) : null}
          </div>

          <span className={cn(MONO_CELL, due.isDue ? "text-brand" : "text-text-tertiary")}>{due.text}</span>
          <span className={cn(MONO_CELL, "text-text-tertiary")}>{schedule.lapses}</span>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        {/* Editing arrives with the card editor, next in this phase. */}
        <ContextMenuItem icon="flyout/rename" disabled>
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

function TagChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block max-w-full truncate rounded-sm bg-[var(--widget-background-primary)] px-1.5 py-px text-caption",
        className,
      )}
    >
      {children}
    </span>
  )
}
