import { navigate } from "@/app/router"
import { useT } from "@/i18n/useT"

import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading, WidgetMessage } from "../states"
import { useRecentNotes } from "./useRecentNotes"

/**
 * A short list of recently touched notes, each row opening the note.
 *
 * The row recipe is shared with RecentDecks: a 34px flat button under a hairline, title on the
 * left, dimmer meta on the right. Only the number of trailing columns differs between the two.
 */
export function RecentNotesWidget({ instance, manifest }: WidgetProps) {
  const t = useT()
  const notes = useRecentNotes(instance, manifest)

  if (notes.state === "loading") return <WidgetLoading rows={4} />
  if (notes.state === "error") return <WidgetError onRetry={notes.retry} />
  if (notes.state === "empty") return <WidgetMessage>{t("RecentNotes", "EmptyWindow")}</WidgetMessage>

  return (
    // The scrollbar is hidden rather than absent: a 2x1 tile holds two rows of a five-row list, and
    // a visible track inside a 120px card costs more width than it explains.
    <div className="h-full overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {notes.rows.map((row) => (
        <div key={row.noteId} className="border-t border-divider-subtle">
          <button
            type="button"
            onClick={() => navigate("notes", row.noteId)}
            className="flex min-h-[34px] w-full cursor-pointer items-center gap-3 rounded-sm px-1 text-left transition-colors hover:bg-[var(--list-item-hover-background)]"
          >
            <span className="min-w-0 flex-1 truncate text-body-small font-medium text-text-primary">{row.title}</span>
            <span className="shrink-0 truncate text-caption text-text-tertiary">{row.meta}</span>
          </button>
        </div>
      ))}
    </div>
  )
}
