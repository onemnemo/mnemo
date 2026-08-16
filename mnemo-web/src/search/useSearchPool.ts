import { useMemo } from "react"

import { useDecksQuery, useFoldersQuery } from "@/flashcards/api"
import { useT } from "@/i18n/useT"
import { navIcon } from "@/nav/icons"
import { useNavCategories } from "@/nav/store"
import { useNoteFoldersQuery, useNotesQuery } from "@/notes/api"
import type { Hit } from "./types"

/**
 * Everything the palette can find, built from the same data the modules render,
 * so a result can never describe something that is not there.
 *
 * The hook only runs while the palette is open, because the component that calls
 * it is only mounted then. That is deliberate: opening search is what should pay
 * for loading the note and deck lists, not starting the app.
 *
 * Cards and note bodies are absent on purpose. There is no card-search endpoint
 * and no full-text index anywhere yet, and a palette that quietly searches titles
 * while looking like it searches everything is worse than one that does not
 * pretend.
 */
export function useSearchPool(): Hit[] {
  const t = useT()
  const categories = useNavCategories()
  const notes = useNotesQuery()
  const noteFolders = useNoteFoldersQuery()
  const decks = useDecksQuery()
  const deckFolders = useFoldersQuery()

  return useMemo(() => {
    const hits: Hit[] = []

    for (const category of categories) {
      for (const item of category.items) {
        if (!item.visible) continue
        hits.push({
          id: `route:${item.route}`,
          kind: "route",
          title: t(item.namespace, item.labelKey),
          icon: navIcon(item),
          href: `#/${item.route}`,
        })
      }
    }

    // The context line is the folder, or nothing. Falling back to the module name
    // would repeat the group heading directly above the row, and worse, it is
    // scored: with every note contexted "Notes", searching for "note" returns the
    // entire corpus.
    const noteFolderName = new Map((noteFolders.data ?? []).map((folder) => [folder.id, folder.name]))
    for (const note of notes.data ?? []) {
      hits.push({
        id: `note:${note.id}`,
        kind: "note",
        title: note.title,
        context: (note.folderId && noteFolderName.get(note.folderId)) || undefined,
        icon: "notebook-text",
        href: `#/notes/${note.id}`,
      })
    }

    const deckFolderName = new Map((deckFolders.data ?? []).map((folder) => [folder.id, folder.name]))
    for (const deck of decks.data ?? []) {
      hits.push({
        id: `deck:${deck.id}`,
        kind: "deck",
        title: deck.name,
        context: (deck.folderId && deckFolderName.get(deck.folderId)) || undefined,
        icon: "square-stack",
        href: `#/flashcard-deck/${deck.id}`,
        tags: deck.tags,
        keywords: [deck.description ?? "", ...deck.tags].join(" "),
      })
    }

    return hits
  }, [categories, notes.data, noteFolders.data, decks.data, deckFolders.data, t])
}
