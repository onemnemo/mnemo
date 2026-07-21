import { navigate } from "@/app/router"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n/useT"

import { useNotesQuery } from "../api"
import type { NoteSummaryDto } from "@/api/types"

const CONTAINER = "mx-auto flex w-full max-w-[760px] flex-col gap-4 px-10 pt-[26px] pb-8"

/**
 * The notes list. A flat list ordered as the server returns it (newest-modified
 * first); folders and a tree are a later concern. Clicking a note routes to its
 * read-only view. Loading, failed and empty are each their own surface.
 */
export function NotesPage() {
  const t = useT()
  const nt = (key: string, params?: Record<string, string | number>) => t("Notes", key, params)
  const notes = useNotesQuery()

  return (
    <div className={CONTAINER}>
      <header className="space-y-[3px]">
        <h1 className="text-heading-4 font-semibold text-text-primary">{nt("Title")}</h1>
        {notes.isSuccess ? (
          <p className="text-body-extra-small text-text-tertiary">
            {nt("NoteCountFormat", { 0: notes.data.length })}
          </p>
        ) : null}
      </header>

      {notes.isPending ? (
        <div className="flex flex-col gap-1">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : null}

      {notes.isError ? (
        <EmptyState
          className="mt-12"
          icon="common/triangle-alert"
          title={nt("ListErrorTitle")}
          description={nt("ListErrorDescription")}
          action={
            <Button size="sm" variant="outline" onClick={() => void notes.refetch()}>
              {nt("Retry")}
            </Button>
          }
        />
      ) : null}

      {notes.isSuccess && notes.data.length === 0 ? (
        <EmptyState
          className="mt-12"
          icon="common/file-text"
          title={nt("ListEmptyTitle")}
          description={nt("ListEmptyDescription")}
        />
      ) : null}

      {notes.isSuccess && notes.data.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {notes.data.map((note) => (
            <NoteRow key={note.id} note={note} untitled={nt("Untitled")} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function NoteRow({ note, untitled }: { note: NoteSummaryDto; untitled: string }) {
  return (
    <li>
      <button
        onClick={() => navigate("notes", note.id)}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-surface-subtle"
      >
        <AppIcon name="common/file-text" size={16} className="shrink-0 text-text-faded" />
        <span className="min-w-0 flex-1 truncate text-body-small text-text-primary">
          {note.title.trim() || untitled}
        </span>
        <time className="shrink-0 text-body-extra-small text-text-tertiary">
          {formatModified(note.modifiedAt)}
        </time>
      </button>
    </li>
  )
}

function formatModified(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}
