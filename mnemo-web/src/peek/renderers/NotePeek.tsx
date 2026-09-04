import { useCallback, useEffect, useMemo, useRef } from "react"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/i18n/useT"
import { parseBlocks } from "@/notes/model/wire"
import { ReadOnlyEditor } from "@/notes/page/ReadOnlyEditor"
import { buildNoteReadState } from "@/notes/read/build-state"

import { installPeekLinkGuard } from "../read-only-links"
import { closePeekForItem } from "../store"
import { openFullFromPeek } from "../usePeekSubject"
import { usePeekNoteQuery } from "./note-query"
import { createPeekNoteServices } from "./note-services"

/**
 * Past this many top-level blocks the peek shows a notice instead of the document.
 *
 * The editor mounts a NodeView per block and streams anything past a couple of thousand
 * across animation frames. A note that large in a 400px column is a second complete DOM
 * of a document the reader can already open properly, and it is the same note either
 * way, so the panel offers the door rather than the wall.
 */
export const PEEK_MAX_BLOCKS = 2000

/**
 * A note in the peek: fetched, parsed, and mounted read only.
 *
 * The document is a snapshot taken when the panel opened, and refreshing it is a
 * remount driven from the outside. It has to be. Autosave patches the shared note cache
 * on every commit rather than invalidating it, so a peek that followed that cache would
 * tear down and rebuild an entire EditorView every few seconds while somebody typed in
 * the tab next to it, on a document that can be thousands of blocks. The reader wanted a
 * second look at the note, not a second writer of it.
 *
 * Nothing here creates an authority, a session, autosave or a shutdown participant:
 * "one writable authority per note" rests on there being one call site that makes one,
 * and this is deliberately not it.
 */
export function NotePeek({ noteId, refresh }: { noteId: string; refresh: number }) {
  const t = useT()
  const nt = (key: string) => t("Notes", key)
  const query = usePeekNoteQuery(noteId, refresh)
  const note = query.data

  // Attached as the element arrives rather than from an effect: the document is only
  // rendered once the note has loaded, so an effect at mount would find nothing to guard
  // and never look again.
  const guarded = useRef<(() => void) | null>(null)
  const attachGuard = useCallback((element: HTMLDivElement | null) => {
    guarded.current?.()
    guarded.current = element ? installPeekLinkGuard(element) : null
  }, [])
  useEffect(() => () => guarded.current?.(), [])

  // Only a 404 counts as gone: a read that failed for any other reason keeps its retry
  // rather than treating a dropped connection as a deletion.
  const gone = query.error?.status === 404
  useEffect(() => {
    if (gone) closePeekForItem("note", noteId)
  }, [gone, noteId])

  const assets = useMemo(() => createPeekNoteServices(), [])
  useEffect(() => () => assets.release(), [assets])

  const latest = useRef(note)
  latest.current = note

  // Keyed on identity alone, reading current bytes through a ref, so the autosave that
  // patches this cache entry every few seconds does not rebuild the document.
  const loaded = useMemo(() => {
    const current = latest.current
    if (!current) return null
    const blocks = parseBlocks(current.blocks ?? [])
    const legacyOnly = blocks.length === 0 && current.content.trim().length > 0
    return {
      count: blocks.length,
      legacyOnly,
      read: legacyOnly || blocks.length > PEEK_MAX_BLOCKS ? null : buildNoteReadState(blocks),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id])

  if (query.isPending) {
    return (
      <div className="peek-doc">
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-11/12" />
        <Skeleton className="mt-2 h-4 w-4/5" />
      </div>
    )
  }

  if (query.isError || !note || !loaded) {
    return (
      <EmptyState
        className="mt-10"
        icon="common/triangle-alert"
        title={nt("LoadFailedTitle")}
        description={nt("LoadFailedDescription")}
        action={
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            {nt("Retry")}
          </Button>
        }
      />
    )
  }

  if (loaded.count > PEEK_MAX_BLOCKS) {
    return (
      <EmptyState
        className="mt-10"
        icon="common/file-text"
        title={t("App", "PeekTooLongTitle")}
        description={t("App", "PeekTooLongDescription")}
        action={
          <Button size="sm" variant="outline" onClick={() => openFullFromPeek("notes", noteId)}>
            {t("App", "PeekOpenFull")}
          </Button>
        }
      />
    )
  }

  // Written before the block editor existed: plain content and no blocks, shown as the
  // text it is rather than as an empty document.
  if (loaded.legacyOnly) {
    return (
      <div className="peek-doc">
        <p className="text-body-medium whitespace-pre-wrap text-text-primary">{note.content}</p>
      </div>
    )
  }

  // The schema cannot represent this note. Held intact and named as such, the way the
  // editor holds it, rather than degraded into something that reads as empty.
  if (!loaded.read?.ok) {
    return (
      <EmptyState
        className="mt-10"
        icon="common/square-rounded-x"
        title={nt("QuarantineTitle")}
        description={nt("QuarantineDescription")}
      />
    )
  }

  return (
    <div className="peek-doc" ref={attachGuard}>
      <ReadOnlyEditor
        noteId={noteId}
        state={loaded.read.state}
        registry={loaded.read.registry}
        services={assets.services}
      />
    </div>
  )
}
