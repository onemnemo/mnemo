import type { SortMode } from "../shelf"

/**
 * The layout badge a card shows.
 *
 * Three words for five algorithms, because the badge answers "what shape is this" and both tree
 * directions answer it the same way. An unknown algorithm reads as free rather than as its raw id.
 */
export const LAYOUT_LABEL_KEYS: Record<string, string> = {
  radial: "LayoutRadial",
  treeRight: "LayoutTree",
  treeDown: "LayoutTree",
}

export const SORT_LABEL_KEYS: Record<SortMode, string> = {
  recent: "SortRecent",
  name: "SortName",
  nodes: "SortNodes",
}
