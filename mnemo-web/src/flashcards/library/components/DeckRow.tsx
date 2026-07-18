import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { DragHandle } from "../dnd/model"
import type { LibraryDrag } from "../dnd/useLibraryDrag"
import { RETENTION_HIGH_THRESHOLD, RETENTION_TRACK_WIDTH, retentionFillWidth, type DeckRowModel } from "../tree"
import { DeckRowMenu } from "./DeckRowMenu"
import { DEPTH_INDENT, METRIC_CLASS, ROW_GRID } from "./rowLayout"

/**
 * One deck in the library table. A deck with nothing waiting fades back and
 * trades its three count columns for a single "Up to date" note.
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
  const { deck, dueToday } = row
  const upToDate = dueToday === 0
  const retentionHigh = deck.retentionPercent >= RETENTION_HIGH_THRESHOLD

  const handle: DragHandle = {
    key: `deck:${deck.id}`,
    kind: "deck",
    id: deck.id,
    parentId: deck.folderId,
    label: deck.name,
    subtitle: t("Flashcards", "DeckCardCountFormat", { 0: deck.totalCards }),
  }

  return (
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
      // The dimming while dragging has to beat the "up to date" fade, so it is set here
      // rather than added as another opacity class.
      style={{ opacity: drag.sourceKey === handle.key ? 0.35 : undefined }}
      className={cn(
        ROW_GRID,
        "group relative h-[38px] cursor-pointer border-b border-divider-subtle outline-none",
        "hover:bg-[var(--widget-background-hover)] focus-visible:bg-[var(--widget-background-hover)]",
        upToDate && "opacity-45",
      )}
    >
      <div className="flex min-w-0 items-center gap-2" style={{ marginLeft: row.depth * DEPTH_INDENT }}>
        <span className="ml-1.5 truncate text-body-extra-small font-medium text-text-primary" title={deck.name}>
          {deck.name}
        </span>
        <span className="shrink-0 text-caption text-text-faded">
          {t("Flashcards", "DeckCardCountFormat", { 0: deck.totalCards })}
        </span>
      </div>

      {upToDate ? (
        <div className="col-span-3 text-right text-caption text-[var(--flashcard-retention-high)]">
          {t("Flashcards", "UpToDate")}
        </div>
      ) : (
        <>
          <Metric value={deck.dueCounts.new} color="var(--flashcard-state-new)" />
          <Metric value={deck.dueCounts.learning} color="var(--flashcard-state-learning)" />
          <Metric value={deck.dueCounts.due} color="var(--accent)" />
        </>
      )}

      <div className="flex items-center justify-end gap-[7px]">
        <span
          className="h-[3px] shrink-0 overflow-hidden rounded-sm bg-[var(--widget-background-primary)]"
          style={{ width: RETENTION_TRACK_WIDTH }}
        >
          <span
            className="block h-full rounded-sm"
            style={{
              width: retentionFillWidth(deck.retentionPercent),
              background: retentionHigh ? "var(--flashcard-retention-high)" : "var(--flashcard-state-learning)",
            }}
          />
        </span>
        <span className="font-mono text-caption text-text-secondary tabular-nums">{deck.retentionPercent}%</span>
      </div>

      {/* Covers the retention column on hover, the way the desktop row swaps the
          bar out for its actions rather than reserving space for them. Absolute
          rather than grid-placed: an explicitly positioned grid item is placed
          before the auto-flow ones, which would bump the retention cell to a
          second row. Width spans the retention and action columns plus the row's
          right padding. */}
      <div className="absolute inset-y-0 right-0 flex w-[146px] items-center justify-end gap-1.5 bg-[var(--widget-background-hover)] pr-[18px] opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <DeckRowMenu deck={deck} upToDate={upToDate} />
      </div>
    </div>
  )
}

function Metric({ value, color }: { value: number; color: string }) {
  return (
    <span className={METRIC_CLASS} style={{ color: value === 0 ? "var(--text-disabled)" : color }}>
      {value}
    </span>
  )
}
