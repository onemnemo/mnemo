import { create } from "zustand"

import type { LibraryView, SortMode } from "./shelf"

/**
 * Where the user is standing in the library and how they asked to see it.
 *
 * Session-only, like the desktop's: a restart reopens the gallery at the root. The folder lives here
 * rather than in the URL because a folder is a filing detail, not a place worth deep-linking to, and
 * putting it in the hash would leave a stale id in the address bar after the folder was deleted.
 */
interface LibraryViewState {
  folderId: string | null
  search: string
  sort: SortMode
  view: LibraryView
  openFolder: (folderId: string | null) => void
  setSearch: (search: string) => void
  setSort: (sort: SortMode) => void
  setView: (view: LibraryView) => void
}

export const useLibraryView = create<LibraryViewState>((set) => ({
  folderId: null,
  search: "",
  sort: "recent",
  view: "grid",
  // Walking into a folder drops the search with it. Carrying a query across the move shows a folder
  // that looks half empty for a reason nothing on screen explains.
  openFolder: (folderId) => set({ folderId, search: "" }),
  setSearch: (search) => set({ search }),
  setSort: (sort) => set({ sort }),
  setView: (view) => set({ view }),
}))
