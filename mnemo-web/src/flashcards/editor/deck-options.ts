import type { DeckSummaryDto, FolderDto } from "@/api/types"

export interface DeckOption {
  id: string
  /** "Folder / Deck", or just the deck name at the library root. */
  pathLabel: string
}

/**
 * The deck picker's options: root decks first, then grouped by folder name, then by deck name.
 * Only the immediate folder is named even when it is nested, matching the desktop - the label
 * is there to disambiguate same-named decks, not to draw the tree.
 */
export function deckOptions(decks: DeckSummaryDto[], folders: FolderDto[]): DeckOption[] {
  const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]))

  return decks
    .map((deck) => {
      const folder = deck.folderId ? folderNames.get(deck.folderId) : undefined
      return {
        id: deck.id,
        pathLabel: folder ? `${folder} / ${deck.name}` : deck.name,
        folder: folder ?? "",
        name: deck.name,
        atRoot: deck.folderId === null,
      }
    })
    .sort(
      (a, b) =>
        Number(b.atRoot) - Number(a.atRoot) ||
        a.folder.localeCompare(b.folder, undefined, { sensitivity: "accent" }) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "accent" }),
    )
    .map(({ id, pathLabel }) => ({ id, pathLabel }))
}
