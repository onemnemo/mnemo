import type { ReactNode } from "react"

import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { LibraryRow, LibraryTotals } from "../tree"
import { DeckRow } from "./DeckRow"
import { FolderRow } from "./FolderRow"
import { METRIC_CLASS, ROW_GRID } from "./rowLayout"

/** The library table: column header, the folder/deck rows, and a totals footer. */
export function LibraryTree({
  rows,
  totals,
  onOpenDeck,
  onToggleFolder,
}: {
  rows: LibraryRow[]
  totals: LibraryTotals
  onOpenDeck: (id: string) => void
  onToggleFolder: (id: string) => void
}) {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className={cn(ROW_GRID, "h-8 border-b border-divider-subtle")}>
        <HeadCell className="text-left">{fc("ColDeck")}</HeadCell>
        <HeadCell>{fc("ColNew")}</HeadCell>
        <HeadCell>{fc("ColLearn")}</HeadCell>
        <HeadCell>{fc("ColDue")}</HeadCell>
        <HeadCell>{fc("ColRetention")}</HeadCell>
        <span />
      </div>

      <div role="rowgroup">
        {rows.map((row) =>
          row.kind === "folder" ? (
            <FolderRow key={`folder:${row.id}`} row={row} onToggle={onToggleFolder} />
          ) : (
            <DeckRow key={`deck:${row.id}`} row={row} onOpen={onOpenDeck} />
          ),
        )}
      </div>

      <div className={cn(ROW_GRID, "h-[34px] bg-[var(--widget-background-hover)]")}>
        <span className="text-caption font-semibold text-text-faded">{fc("Total")}</span>
        <span className={cn(METRIC_CLASS, "text-caption text-[var(--flashcard-state-new)]")}>{totals.new}</span>
        <span className={cn(METRIC_CLASS, "text-caption text-[var(--flashcard-state-learning)]")}>{totals.learning}</span>
        <span className={cn(METRIC_CLASS, "text-caption text-[var(--accent)]")}>{totals.due}</span>
        <span className={cn(METRIC_CLASS, "text-caption text-text-secondary")}>{totals.retentionPercent}%</span>
        <span />
      </div>
    </div>
  )
}

function HeadCell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("text-right text-caption font-semibold text-text-faded", className)}>{children}</span>
  )
}
