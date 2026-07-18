import { create } from "zustand"

import type { SortMode } from "./tree"

// View state for the library table. Like the desktop app this is session-only —
// nothing here is persisted, so a restart reopens the tree fully expanded.

interface LibraryViewState {
  search: string
  sort: SortMode
  /** Folders the user collapsed; everything else is expanded, including new folders. */
  collapsed: Set<string>
  setSearch: (search: string) => void
  setSort: (sort: SortMode) => void
  toggleFolder: (id: string) => void
  /** Collapses every folder when any is open, otherwise expands all of them. */
  toggleAll: (ids: readonly string[]) => void
}

export const useLibraryView = create<LibraryViewState>((set) => ({
  search: "",
  sort: "due",
  collapsed: new Set(),
  setSearch: (search) => set({ search }),
  setSort: (sort) => set({ sort }),
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
