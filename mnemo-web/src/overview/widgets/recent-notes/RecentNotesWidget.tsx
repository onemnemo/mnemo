import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import { Body, Empty, Head, ItemRow, useWidgetTitle } from "../../parts"
import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading } from "../states"
import { useRecentNotes } from "./useRecentNotes"

/** A short list of recently touched notes, each row opening the note. */
export function RecentNotesWidget({ instance, manifest }: WidgetProps) {
  const t = useT()
  const title = useWidgetTitle(manifest)
  const notes = useRecentNotes(instance, manifest)

  return (
    <Body>
      <Head title={title} icon="notebook-text" />

      {notes.state === "loading" ? (
        <div className="mt-2 flex-1">
          <WidgetLoading rows={4} />
        </div>
      ) : notes.state === "error" ? (
        <WidgetError onRetry={notes.retry} />
      ) : notes.state === "empty" ? (
        <Empty>{t("RecentNotes", "EmptyWindow")}</Empty>
      ) : (
        <div className="scroll-thin mt-1.5 min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {notes.rows.map((row) => (
            <ItemRow
              key={row.noteId}
              glyph={<AppIcon name="file-text" size={14} strokeWidth={1.6} className="text-ink-icon" />}
              title={row.title}
              meta={row.meta}
              href={`#/notes/${row.noteId}`}
            />
          ))}
        </div>
      )}
    </Body>
  )
}
