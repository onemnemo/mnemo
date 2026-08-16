import type { DeckSummaryDto, FolderDto } from "@/api/types"

import type { LibraryWrites } from "../../api"
import { compareFolders } from "../tree"
import { effectiveParent, type DropTarget } from "./model"

// Turning a committed drop into the writes it implies. Pure, so what a drag costs in requests
// is decided somewhere it can be read rather than in the middle of a pointer handler.

const NO_WRITES: LibraryWrites = { folders: [] }

/**
 * A deck is appended after whatever the destination folder already holds. Deck order is not
 * what the tree sorts by, so this only has to be a value no sibling is already using.
 */
export function planDeckMove(
  deckId: string,
  folderId: string | null,
  decks: readonly DeckSummaryDto[],
): LibraryWrites {
  const siblings = decks.filter((deck) => deck.folderId === folderId && deck.id !== deckId)
  const sortOrder = Math.max(-1, ...siblings.map((deck) => deck.sortOrder)) + 1
  return { folders: [], deck: { id: deckId, folderId, sortOrder } }
}

/**
 * A folder move rebuilds the destination's children in their final order and writes back only
 * the rows that actually shifted: nesting at the end costs one request, dropping one in at the
 * top costs one per row it pushed along.
 */
export function planFolderMove(
  sourceId: string,
  target: DropTarget,
  folders: readonly FolderDto[],
): LibraryWrites {
  const source = folders.find((folder) => folder.id === sourceId)
  if (!source) return NO_WRITES

  const parentId = target.parentId
  const known = new Set(folders.map((folder) => folder.id))
  // Grouped the way the tree draws them, so the renumbered list is the list on screen: a folder
  // orphaned by a deleted parent renders at the root and has to be renumbered along with it.
  const siblings = folders
    .filter((folder) => effectiveParent(folder.parentId, known) === parentId && folder.id !== sourceId)
    .sort(compareFolders)

  let index = siblings.length
  if (target.mode === "above" || target.mode === "below") {
    const at = siblings.findIndex((folder) => folder.id === target.folderId)
    if (at < 0) return NO_WRITES
    index = target.mode === "below" ? at + 1 : at
  }
  siblings.splice(index, 0, source)

  // Only the destination is renumbered. The folder the source left keeps its gap, which costs
  // nothing: siblings sort by order with name breaking ties, so a hole never shows.
  //
  // Grouped on the effective parent above but skipped on the stored one here, deliberately: an
  // orphan already sits where this write would put it, so comparing effective parents would
  // skip it and leave it pointing at a folder that no longer exists.
  return {
    folders: siblings.flatMap((folder, order) =>
      folder.parentId === parentId && folder.order === order
        ? []
        : [{ id: folder.id, name: folder.name, parentId, order }],
    ),
  }
}
