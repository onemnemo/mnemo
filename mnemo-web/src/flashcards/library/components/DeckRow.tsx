import { navigate } from "@/app/router"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { formatRelative } from "@/lib/relative-date"

import { Counts, Retention, retentionReading } from "../../bits"
import type { DragHandle } from "../dnd/model"
import type { LibraryDrag } from "../dnd/useLibraryDrag"
import type { DeckRowModel } from "../tree"
import { DeckRowContextMenu } from "./DeckRowContextMenu"
import { DeckRowMenu } from "./DeckRowMenu"
import { DEPTH_INDENT, RETENTION_CELL } from "./rowLayout"
import { useDeckMenuEntries } from "./useDeckMenuEntries"

/**
 * One deck in the library list: what it is, what it owes, and the way in.
 *
 * Study lives on the row rather than behind the menu, because studying is the job.
 * It only asks for attention when the pointer is already there.
 */
export function DeckRow({
  row,
  onOpen,
  drag,
}: {
  row: DeckRowModel
  onOpen: (id: string) => void
  drag: LibraryDrag
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)
  const { deck, dueToday } = row

  // Caught up means nothing to do. Never opened does not: that deck has every one
  // of its cards still waiting, they are simply not scheduled yet.
  const started = deck.lastStudied !== null
  const idle = dueToday === 0 && started
  const menuEntries = useDeckMenuEntries(deck, idle)

  const handle: DragHandle = {
    key: `deck:${deck.id}`,
    kind: "deck",
    id: deck.id,
    parentId: deck.folderId,
    label: deck.name,
    subtitle: fc("DeckCardCountFormat", { 0: deck.totalCards }),
  }

  return (
    <DeckRowContextMenu entries={menuEntries}>
      <div
        role="row"
        tabIndex={0}
        data-row-key={handle.key}
        data-row-kind="deck"
        data-row-id={deck.id}
        data-row-depth={row.depth}
        data-row-folder={deck.folderId ?? ""}
        onPointerDown={(event) => drag.press(event, handle)}
        onClick={() => !drag.suppressClick(handle.key) && onOpen(deck.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onOpen(deck.id)
          }
        }}
        style={{
          opacity: drag.sourceKey === handle.key ? 0.35 : undefined,
          paddingLeft: 10 + row.depth * DEPTH_INDENT,
        }}
        className={cn(
          "group/deck flex h-12 cursor-pointer items-center gap-3 rounded-lg pr-2 outline-none transition-colors",
          "hover:bg-frame-hover focus-visible:bg-frame-hover",
        )}
      >
        <DeckIcon icon={deck.icon} />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] text-ink" title={deck.name}>
            {deck.name}
          </span>
          <span className="block truncate text-[12px] text-ink-3">
            {fc("DeckCardCountFormat", { 0: deck.totalCards.toLocaleString() })}
            {" · "}
            {deck.lastStudied
              ? fc("DeckLastStudiedFormat", { 0: formatRelative(deck.lastStudied, Date.now(), t) })
              : fc("DeckNeverStudied")}
          </span>
        </span>

        {/* The whole row navigates, so anything clickable inside it has to stop the
            event, or starting a session also opens the deck behind it. */}
        <span
          className="shrink-0 opacity-0 transition-opacity group-hover/deck:opacity-100 focus-within:opacity-100"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Button
            variant="outline"
            disabled={idle}
            onClick={(event) => {
              event.stopPropagation()
              navigate("flashcard-session", deck.id, "review", "due")
            }}
            className="h-7 bg-canvas px-2.5"
            icon={<AppIcon name="common/play-filled" size={12} />}
          >
            {idle ? fc("StudyDone") : fc("Study")}
          </Button>
        </span>

        <Counts counts={deck.dueCounts} className="shrink-0" />

        <span className={RETENTION_CELL}>
          <Retention percent={retentionReading(deck.retentionPercent, deck.retentionSampleSize)} />
        </span>

        <span
          className="shrink-0"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <DeckRowMenu entries={menuEntries} />
        </span>
      </div>
    </DeckRowContextMenu>
  )
}

/**
 * Icons are opt-in. A deck without one gets a neutral mark rather than an empty
 * slot, so a list of half-decorated decks still lines up: the missing icon should
 * read as "not set", never as a rendering hole.
 */
function DeckIcon({ icon }: { icon: string | null }) {
  return (
    <span className="grid size-[18px] shrink-0 place-items-center">
      {icon ? (
        <span aria-hidden className="text-[14px] leading-none">
          {icon}
        </span>
      ) : (
        <AppIcon name="square-stack" size={15} className="text-ink-icon" />
      )}
    </span>
  )
}
