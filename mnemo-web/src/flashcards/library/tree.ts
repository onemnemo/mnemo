import type { DeckSummaryDto, FolderDto } from "@/api/types"

// Pure derivation of the library table: nest the folders, sort and filter the
// decks, then flatten the result into the row list the tree renders. Keeping it
// free of React means the ordering and aggregate rules are testable on their own.

export type SortMode = "due" | "name" | "retention" | "cards"

export const SORT_MODES: readonly SortMode[] = ["due", "name", "retention", "cards"]

/** The retention bar's track width, in px; the fill is a fraction of it. */
export const RETENTION_TRACK_WIDTH = 34

/** At or above this percent the retention bar reads as healthy (green, not amber). */
export const RETENTION_HIGH_THRESHOLD = 70

/** Rough pacing used for the banner's "about N min" estimate. */
const CARDS_PER_MINUTE = 11

export interface FolderCounts {
  new: number
  learning: number
  due: number
  deckCount: number
}

export interface FolderRowModel {
  kind: "folder"
  id: string
  depth: number
  folder: FolderDto
  counts: FolderCounts
  expanded: boolean
}

export interface DeckRowModel {
  kind: "deck"
  id: string
  depth: number
  deck: DeckSummaryDto
  /** Total waiting today; zero renders the row as "up to date" instead of counts. */
  dueToday: number
}

export type LibraryRow = FolderRowModel | DeckRowModel

export interface LibraryTotals {
  new: number
  learning: number
  due: number
  /** Card-count-weighted mean retention over the visible decks. */
  retentionPercent: number
  deckCount: number
  cardCount: number
}

export interface LibraryModel {
  rows: LibraryRow[]
  totals: LibraryTotals
}

interface FolderNode {
  folder: FolderDto
  children: FolderNode[]
  counts: FolderCounts
  /** True when this folder or any descendant holds a deck matching the search. */
  matches: boolean
}

const collator = new Intl.Collator(undefined, { sensitivity: "base" })

function byName<T>(name: (item: T) => string) {
  return (a: T, b: T) => collator.compare(name(a), name(b))
}

export function sortDecks(decks: DeckSummaryDto[], mode: SortMode): DeckSummaryDto[] {
  const byDeckName = byName<DeckSummaryDto>((d) => d.name)
  const sorted = [...decks]
  switch (mode) {
    case "name":
      return sorted.sort(byDeckName)
    case "retention":
      return sorted.sort((a, b) => b.retentionPercent - a.retentionPercent || byDeckName(a, b))
    case "cards":
      return sorted.sort((a, b) => b.totalCards - a.totalCards || byDeckName(a, b))
    case "due":
    default:
      return sorted.sort((a, b) => b.dueCounts.total - a.dueCounts.total || byDeckName(a, b))
  }
}

/** Sibling order among folders: the stored order, with name breaking ties. */
export function compareFolders(a: FolderDto, b: FolderDto): number {
  return a.order - b.order || collator.compare(a.name, b.name)
}

/** Nests the flat folder list, ordering siblings by their stored order then name. */
function buildFolderNodes(folders: FolderDto[]): FolderNode[] {
  const known = new Set(folders.map((f) => f.id))
  const nodes = new Map<string, FolderNode>(
    folders.map((f) => [
      f.id,
      { folder: f, children: [], counts: { new: 0, learning: 0, due: 0, deckCount: 0 }, matches: false },
    ]),
  )

  const roots: FolderNode[] = []
  for (const folder of folders) {
    const node = nodes.get(folder.id)
    if (!node) continue
    // A parent that no longer exists would strand the whole subtree, so treat it as root.
    const parent = folder.parentId && known.has(folder.parentId) ? nodes.get(folder.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const sortTree = (list: FolderNode[]) => {
    list.sort((a, b) => compareFolders(a.folder, b.folder))
    for (const node of list) sortTree(node.children)
  }
  sortTree(roots)
  return roots
}

/**
 * Sums each folder's descendant decks. Deliberately ignores the search filter:
 * a folder reports everything it holds even while a search hides most of it.
 */
function applyCounts(nodes: FolderNode[], decksByFolder: Map<string, DeckSummaryDto[]>): void {
  for (const node of nodes) {
    applyCounts(node.children, decksByFolder)

    const own = decksByFolder.get(node.folder.id) ?? []
    const counts: FolderCounts = {
      new: own.reduce((sum, d) => sum + d.dueCounts.new, 0),
      learning: own.reduce((sum, d) => sum + d.dueCounts.learning, 0),
      due: own.reduce((sum, d) => sum + d.dueCounts.due, 0),
      deckCount: own.length,
    }
    for (const child of node.children) {
      counts.new += child.counts.new
      counts.learning += child.counts.learning
      counts.due += child.counts.due
      counts.deckCount += child.counts.deckCount
    }
    node.counts = counts
  }
}

function applyMatches(nodes: FolderNode[], visibleByFolder: Map<string, DeckSummaryDto[]>): void {
  for (const node of nodes) {
    applyMatches(node.children, visibleByFolder)
    node.matches =
      (visibleByFolder.get(node.folder.id)?.length ?? 0) > 0 || node.children.some((child) => child.matches)
  }
}

export interface BuildLibraryOptions {
  folders: FolderDto[]
  decks: DeckSummaryDto[]
  search: string
  sort: SortMode
  /** Folder ids the user has collapsed; folders default to expanded. */
  collapsed: ReadonlySet<string>
}

/**
 * The decks a search leaves in scope, collapsed folders included. Separate from the row list
 * because a collapsed folder hides its decks from the table without taking them out of scope -
 * anything acting on "what the library is showing", like an export, has to ask this rather than
 * count rows, or twirling a folder shut would quietly change what it operates on.
 */
export function decksInScope(decks: DeckSummaryDto[], search: string): DeckSummaryDto[] {
  const term = search.trim().toLowerCase()
  return term.length === 0 ? decks : decks.filter((d) => d.name.toLowerCase().includes(term))
}

export function buildLibrary({ folders, decks, search, sort, collapsed }: BuildLibraryOptions): LibraryModel {
  const term = search.trim().toLowerCase()
  const searching = term.length > 0
  const visible = decksInScope(decks, search)

  const known = new Set(folders.map((f) => f.id))
  // A deck whose folder was deleted out from under it belongs at the root, not nowhere.
  const folderOf = (deck: DeckSummaryDto) => (deck.folderId && known.has(deck.folderId) ? deck.folderId : null)

  const groupBy = (list: DeckSummaryDto[]) => {
    const map = new Map<string, DeckSummaryDto[]>()
    const roots: DeckSummaryDto[] = []
    for (const deck of list) {
      const id = folderOf(deck)
      if (id === null) roots.push(deck)
      else {
        const bucket = map.get(id)
        if (bucket) bucket.push(deck)
        else map.set(id, [deck])
      }
    }
    return { map, roots }
  }

  const all = groupBy(decks)
  const shown = groupBy(visible)

  const nodes = buildFolderNodes(folders)
  applyCounts(nodes, all.map)
  applyMatches(nodes, shown.map)

  const rows: LibraryRow[] = []
  const pushDeck = (deck: DeckSummaryDto, depth: number) =>
    rows.push({ kind: "deck", id: deck.id, depth, deck, dueToday: deck.dueCounts.total })

  // Pre-order, and subfolders come before the parent's own decks, matching the
  // desktop tree regardless of sort mode.
  const pushFolders = (list: FolderNode[], depth: number) => {
    for (const node of list) {
      if (searching && !node.matches) continue

      const isExpanded = searching || !collapsed.has(node.folder.id)
      rows.push({ kind: "folder", id: node.folder.id, depth, folder: node.folder, counts: node.counts, expanded: isExpanded })
      if (!isExpanded) continue

      pushFolders(node.children, depth + 1)
      for (const deck of sortDecks(shown.map.get(node.folder.id) ?? [], sort)) pushDeck(deck, depth + 1)
    }
  }

  pushFolders(nodes, 0)
  for (const deck of sortDecks(shown.roots, sort)) pushDeck(deck, 0)

  return { rows, totals: totalsOf(visible) }
}

function totalsOf(decks: DeckSummaryDto[]): LibraryTotals {
  let weightedRetention = 0
  let weight = 0
  for (const deck of decks) {
    // Empty decks still count once, so a fresh deck cannot swing the mean to zero.
    const cards = Math.max(1, deck.totalCards)
    weightedRetention += deck.retentionPercent * cards
    weight += cards
  }

  return {
    new: decks.reduce((sum, d) => sum + d.dueCounts.new, 0),
    learning: decks.reduce((sum, d) => sum + d.dueCounts.learning, 0),
    due: decks.reduce((sum, d) => sum + d.dueCounts.due, 0),
    retentionPercent: weight === 0 ? 0 : Math.round(weightedRetention / weight),
    deckCount: decks.length,
    cardCount: decks.reduce((sum, d) => sum + d.totalCards, 0),
  }
}

/** Width of the retention bar's filled portion, in px. */
export function retentionFillWidth(percent: number): number {
  return (RETENTION_TRACK_WIDTH * Math.min(100, Math.max(0, percent))) / 100
}

/** The banner's "about N min" figure; always at least a minute when anything is due. */
export function estimatedMinutes(cards: number): number {
  return Math.max(1, Math.round(cards / CARDS_PER_MINUTE))
}
