import { useMemo } from "react"

import { navigate } from "@/app/router"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n/useT"

import { useNoteQuery } from "../api"
import { parseBlocks } from "../model/wire"
import { buildNoteReadState } from "../read/build-state"
import { ReadOnlyEditor } from "./ReadOnlyEditor"

const CONTAINER = "mx-auto flex w-full max-w-[760px] flex-col gap-4 px-10 pt-[26px] pb-16"

/**
 * One note, read-only. The four states M7 has to keep distinguishable — loading,
 * failed, invalid (quarantine) and empty — each get their own surface, and a
 * rendered note gets the editor. A note written before the block editor existed
 * (null blocks, plain `content`) is shown through a legacy fallback rather than
 * as "empty", so no real note reads as blank.
 */
export function NoteView({ noteId }: { noteId?: string }) {
  const t = useT()
  const nt = (key: string, params?: Record<string, string | number>) => t("Notes", key, params)
  const query = useNoteQuery(noteId)
  const note = query.data

  // Parse and build once per loaded note. React Query hands back a stable object
  // until a refetch, so these memos rebuild only when the note's bytes change —
  // which matters for a 10k-block document that must not re-map on every render.
  const blocks = useMemo(() => (note ? parseBlocks(note.blocks ?? []) : []), [note])
  const built = useMemo(() => (blocks.length > 0 ? buildNoteReadState(blocks) : null), [blocks])

  if (!noteId) {
    return (
      <div className={CONTAINER}>
        <EmptyState icon="common/file-text" title={nt("NoNoteSelectedTitle")} />
      </div>
    )
  }

  const back = (
    <button
      onClick={() => navigate("notes")}
      className="flex items-center gap-1.5 self-start text-body-small text-text-tertiary hover:text-text-secondary"
    >
      <AppIcon name="common/arrow-up" size={14} className="-rotate-90" />
      {nt("BackToNotes")}
    </button>
  )

  if (query.isPending) {
    return (
      <div className={CONTAINER}>
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-full" />
      </div>
    )
  }

  if (query.isError || !note) {
    return (
      <div className={CONTAINER}>
        {back}
        <EmptyState
          className="mt-12"
          icon="common/triangle-alert"
          title={nt("LoadFailedTitle")}
          description={nt("LoadFailedDescription")}
          action={
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              {nt("Retry")}
            </Button>
          }
        />
      </div>
    )
  }

  const title = note.title.trim() || nt("Untitled")

  // Empty: no blocks. A legacy note keeps its plain content, so show that rather
  // than claiming the note is blank.
  if (blocks.length === 0) {
    const legacy = note.content.trim()
    return (
      <div className={CONTAINER}>
        {back}
        <NoteHeader title={title} />
        {legacy ? (
          <p className="whitespace-pre-wrap text-body-medium text-text-primary">{note.content}</p>
        ) : (
          <EmptyState className="mt-8" icon="common/file-text" title={nt("EmptyNoteTitle")} description={nt("EmptyNoteDescription")} />
        )}
      </div>
    )
  }

  // Invalid: the schema cannot represent this note. It is not degraded into an
  // empty editable document — its bytes are held intact and it can be exported
  // and repaired.
  if (built && !built.ok) {
    return (
      <div className={CONTAINER}>
        {back}
        <NoteHeader title={title} />
        <EmptyState
          className="mt-8"
          icon="common/square-rounded-x"
          title={nt("QuarantineTitle")}
          description={nt("QuarantineDescription")}
        />
      </div>
    )
  }

  return (
    <div className={CONTAINER}>
      {back}
      <NoteHeader title={title} />
      {built?.ok ? <ReadOnlyEditor noteId={note.id} state={built.state} registry={built.registry} /> : null}
    </div>
  )
}

function NoteHeader({ title }: { title: string }) {
  return <h1 className="text-heading-2 font-semibold text-text-primary">{title}</h1>
}
