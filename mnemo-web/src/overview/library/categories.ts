import type { WidgetCategory } from "../widgets/manifest"

/** "all" is not a category a widget can declare; it is the rail's own first row. */
export type LibraryFilter = WidgetCategory | "all"

export interface LibraryCategory {
  id: LibraryFilter
  /** Resolved against the WidgetLibrary namespace. */
  labelKey: string
}

/**
 * The rail, in order.
 *
 * Community sits last and is empty on purpose: it is where widgets other people have written will
 * appear once the extension store opens, and a rail that only grows a row on that day gives the
 * reader no idea it is coming.
 */
export const LIBRARY_CATEGORIES: readonly LibraryCategory[] = [
  { id: "all", labelKey: "CategoryAll" },
  { id: "study", labelKey: "CategoryStudy" },
  { id: "cards", labelKey: "CategoryCards" },
  { id: "notes", labelKey: "CategoryNotes" },
  { id: "soma", labelKey: "CategorySoma" },
  { id: "community", labelKey: "CategoryCommunity" },
]
