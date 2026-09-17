import { useEffect, useRef } from "react"

import { navigate } from "@/app/router"
import { useT } from "@/i18n/useT"
import { useNotesQuery } from "@/notes/api"

import { usePeekStore, type PeekItem } from "./store"

export interface PeekSubject {
  readonly title: string
  readonly subtitle?: string
  /** Absent for an item with no full surface of its own. */
  readonly openFull?: () => void
}

/**
 * The header's reading of the current item, and the rules for an item that stops
 * existing while it is being read.
 *
 * A note's title comes from the shared library list rather than from the item, so a
 * rename in the tree retitles the panel, and a note that leaves that list (deleted, or
 * moved to the trash) closes the peek: a panel holding a title for something that is
 * gone is worse than no panel. The other kinds carry their own title, because none of
 * them has a corpus-wide list the shell already keeps warm.
 */
/**
 * Promotes what the peek is showing to the canvas.
 *
 * Pinned means "keep this beside what I am doing", so the panel stays where it is and
 * only the canvas behind it changes.
 */
export function openFullFromPeek(key: string, ...params: readonly string[]): void {
  navigate(key, ...params)
  if (!usePeekStore.getState().pinned) usePeekStore.getState().closePeek()
}

export function usePeekSubject(item: PeekItem | null): PeekSubject {
  const t = useT()
  // Read, not owned: a peek opened outside the notes workspace must not fetch the whole
  // corpus for one title. Whatever the tree has kept warm is enough, a rename or a delete
  // still invalidates it, and only a cold cache asks once.
  const notes = useNotesQuery(item?.kind === "note", { staleTime: Infinity })

  const noteId = item?.kind === "note" ? item.id : null
  const entry = noteId === null ? undefined : notes.data?.find((note) => note.id === noteId)
  const missed = noteId !== null && notes.isSuccess && entry === undefined

  // A miss against the list the peek opened on is asked about once before it counts: a note
  // created since that list was fetched, by the assistant say, is new rather than gone, and
  // nothing else would ever refresh a list the cache calls fresh. A miss against a list
  // refreshed since the peek opened is the answer itself, which is what the trash's own
  // invalidation produces, so it closes at once and costs no second fetch. The ask is flagged
  // because a replayed effect would otherwise ask twice.
  const seen = useRef<{ id: string; at: number; asked: boolean } | null>(null)
  const { dataUpdatedAt, refetch } = notes
  useEffect(() => {
    if (noteId === null) return
    if (seen.current?.id !== noteId) seen.current = { id: noteId, at: dataUpdatedAt, asked: false }
    if (!missed) return
    if (dataUpdatedAt > seen.current.at) {
      usePeekStore.getState().closePeek()
      return
    }
    if (seen.current.asked) return
    seen.current.asked = true
    void refetch({ cancelRefetch: false })
  }, [missed, noteId, dataUpdatedAt, refetch])

  const promote =
    (key: string, ...params: readonly string[]) =>
    () =>
      openFullFromPeek(key, ...params)

  if (!item) return { title: "" }

  switch (item.kind) {
    case "note":
      return {
        title: entry?.title.trim() || t("Notes", "Untitled"),
        openFull: promote("notes", item.id),
      }
    case "card":
      return {
        title: t("Flashcards", "PeekCard"),
        subtitle: item.deckName,
        openFull: promote("flashcard-deck", item.deckId),
      }
    case "soma":
      // A proper noun, the way the assistant dock's own label is.
      return { title: "Soma", openFull: promote("soma") }
  }
}
