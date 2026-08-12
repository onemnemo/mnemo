/**
 * What a map's note and deck references point at.
 *
 * A reference node stores an id and nothing else, so what it reads as has to come from somewhere
 * else in the app. The desktop looks each one up by id in the background and patches the titles in
 * afterwards, with a generation guard so a slow answer cannot land on a map that has since changed.
 * The port does not need any of that: both libraries are already list endpoints the client caches,
 * so one fetch of each answers every reference at once and the projector gets its titles up front.
 *
 * That is the difference that matters. Resolving after layout means laying out around blank boxes
 * and then reflowing when the titles arrive; resolving before it means the box is built around the
 * title the first time.
 *
 * Nothing is fetched for a map with no references, which is almost all of them.
 */

import { useMemo } from "react"

import { useDecksQuery } from "@/flashcards/api"
import { useT } from "@/i18n/useT"
import { useNotesQuery } from "@/notes/api"

import type { MindmapDocument } from "../model/document"
import { refKey, type RefInfo } from "./content"

/**
 * The resolution map the projector reads, or an empty one for a map with nothing to resolve.
 *
 * A key is absent until its library has arrived, which the projector draws as a mark with no title.
 * A key present with `missing` set is the library having arrived without it, which is the reference
 * pointing at something deleted.
 */
export function useMindmapRefs(document: MindmapDocument | undefined): ReadonlyMap<string, RefInfo> {
  const t = useT()

  // Which kinds this map actually contains, so an ordinary map fetches neither library. Recomputed
  // on every document change rather than memoized on one, since converting the only note node back
  // to text has to be able to turn the fetch off again.
  let wantsNotes = false
  let wantsDecks = false
  for (const element of document?.elements ?? []) {
    if (element.content.$type === "note") {
      wantsNotes = true
    } else if (element.content.$type === "flashcard") {
      wantsDecks = true
    }
  }

  const notes = useNotesQuery(wantsNotes)
  const decks = useDecksQuery(wantsDecks)

  const noteRows = notes.data
  const deckRows = decks.data

  return useMemo(() => {
    const map = new Map<string, RefInfo>()
    if (!document) {
      return map
    }

    const byNote = new Map(noteRows?.map((note) => [note.id, note]))
    const byDeck = new Map(deckRows?.map((deck) => [deck.id, deck]))

    for (const element of document.elements ?? []) {
      const key = refKey(element.content)
      if (!key || map.has(key)) {
        continue
      }

      if (element.content.$type === "note") {
        if (!noteRows) {
          continue
        }
        const note = byNote.get((element.content as { noteId: string }).noteId)
        // An untitled note is resolved, not missing. Drawing it blank would make the two look the
        // same, and only one of them is something to go and fix.
        map.set(
          key,
          note
            ? { label: note.title.trim() || t("Mindmap", "RefUntitled") }
            : { label: t("Mindmap", "RefMissing"), missing: true },
        )
        continue
      }

      if (!deckRows) {
        continue
      }
      const deck = byDeck.get((element.content as { deckId: string }).deckId)
      map.set(
        key,
        deck
          ? {
              label: deck.name,
              // Only when there is something to study. A chip reading "0 due" is a chip that is on
              // every deck node forever and says nothing.
              badge:
                deck.dueCounts.total > 0
                  ? t("Mindmap", "DueBadge", { 0: deck.dueCounts.total })
                  : undefined,
            }
          : { label: t("Mindmap", "RefMissing"), missing: true },
      )
    }

    return map
  }, [document, noteRows, deckRows, t])
}
