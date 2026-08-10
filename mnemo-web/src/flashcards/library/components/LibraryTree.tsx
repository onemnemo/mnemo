import type { RefObject } from "react"

import { useT } from "@/i18n/useT"

import type { LibraryDrag } from "../dnd/useLibraryDrag"
import type { LibraryRow } from "../tree"
import { DeckRow } from "./DeckRow"
import { FolderRow } from "./FolderRow"
import { RETENTION_CELL } from "./rowLayout"

/** The library list: one quiet header over the folder and deck rows. */
export function LibraryTree({
  rows,
  onOpenDeck,
  onToggleFolder,
  drag,
  surfaceRef,
}: {
  rows: LibraryRow[]
  onOpenDeck: (id: string) => void
  onToggleFolder: (id: string) => void
  drag: LibraryDrag
  /** The whole surface is a drop target: anywhere on it that is not a row means the root. */
  surfaceRef: RefObject<HTMLDivElement | null>
}) {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)

  return (
    <div ref={surfaceRef} className="mt-3">
      {/* Only the columns that are numbers get a heading. Naming the name column
          says nothing the rows do not already say. */}
      <div className="flex h-7 items-center gap-3 pr-2 pl-2.5 text-[11.5px] text-ink-3">
        <span className="flex-1" />
        <span className="flex items-center gap-4">
          <span className="w-7 text-right">{fc("ColNew")}</span>
          <span className="w-7 text-right">{fc("ColLearn")}</span>
          <span className="w-7 text-right">{fc("ColDue")}</span>
        </span>
        <span className={RETENTION_CELL}>{fc("ColRetention")}</span>
        <span className="size-7 shrink-0" />
      </div>

      <div role="rowgroup">
        {rows.map((row) =>
          row.kind === "folder" ? (
            <FolderRow key={`folder:${row.id}`} row={row} onToggle={onToggleFolder} drag={drag} />
          ) : (
            <DeckRow key={`deck:${row.id}`} row={row} onOpen={onOpenDeck} drag={drag} />
          ),
        )}
      </div>
    </div>
  )
}
