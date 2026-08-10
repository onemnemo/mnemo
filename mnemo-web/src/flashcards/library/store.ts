import { create } from "zustand"

import type { SortMode } from "./tree"

// View state for the library table. Like the desktop app this is session-only, 
// nothing here is persisted, so a restart reopens the tree fully expanded.

/** Rows or cards. The list carries the folder tree; the grid is flat. */
export type LibraryLayout = "list" | "grid"

interface LibraryViewState {
  search: string
  sort: SortMode
  layout: LibraryLayout
  /** Folders the user collapsed; everything else is expanded, including new folders. */
  collapsed: Set<string>
  setSearch: (search: string) => void
  setSort: (sort: SortMode) => void
  setLayout: (layout: LibraryLayout) => void
  toggleFolder: (id: string) => void
  /** Collapses every folder when any is open, otherwise expands all of them. */
  toggleAll: (ids: readonly string[]) => void
}

export const useLibraryView = create<LibraryViewState>((set) => ({
  search: "",
  sort: "due",
  layout: "list",
  collapsed: new Set(),
  setSearch: (search) => set({ search }),
  setSort: (sort) => set({ sort }),
  setLayout: (layout) => set({ layout }),
  toggleFolder: (id) =>
    set((state) => {
      const collapsed = new Set(state.collapsed)
      if (!collapsed.delete(id)) collapsed.add(id)
      return { collapsed }
    }),
  toggleAll: (ids) =>
    set((state) => {
      const anyExpanded = ids.some((id) => !state.collapsed.has(id))
      return { collapsed: anyExpanded ? new Set(ids) : new Set() }
    }),
}))
