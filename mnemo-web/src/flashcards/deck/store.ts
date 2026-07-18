import { create } from "zustand"

import type { CardStateFilter } from "@/api/types"

// View state for one deck's card table. Session-only, like the library's.
//
// The state and tag filters are single values rather than lists: the desktop
// stores one of each, so picking a second state replaces the first instead of
// narrowing, and the chip strip holds at most two chips.

interface DeckViewState {
  /** Which deck this state belongs to, so a navigation can reset it. */
  deckId: string | null
  /** What the search box shows; `query` is the debounced value the request uses. */
  search: string
  query: string
  stateFilter: CardStateFilter
  tagFilter: string | null
  sortDescending: boolean
  offset: number
  /** Ids selected on the current page. Selection never spans pages. */
  selected: Set<string>

  openDeck: (deckId: string) => void
  setSearch: (search: string) => void
  commitSearch: () => void
  setStateFilter: (state: CardStateFilter) => void
  setTagFilter: (tag: string) => void
  clearStateFilter: () => void
  clearTagFilter: () => void
  toggleDueSort: () => void
  setOffset: (offset: number) => void
  toggleCard: (id: string) => void
  setPageSelection: (ids: readonly string[], selected: boolean) => void
  clearSelection: () => void
}

const EMPTY = {
  search: "",
  query: "",
  stateFilter: "all" as CardStateFilter,
  tagFilter: null,
  sortDescending: false,
  offset: 0,
  selected: new Set<string>(),
}

// Anything that changes which rows are on screen also drops the selection, since
// the ids it holds are about to stop being visible.
const RESET_PAGE = { offset: 0, selected: new Set<string>() }

export const useDeckView = create<DeckViewState>((set) => ({
  deckId: null,
  ...EMPTY,

  openDeck: (deckId) => set((state) => (state.deckId === deckId ? {} : { deckId, ...EMPTY })),

  setSearch: (search) => set({ search }),
  commitSearch: () => set((state) => (state.query === state.search ? {} : { query: state.search, ...RESET_PAGE })),

  setStateFilter: (stateFilter) => set({ stateFilter, ...RESET_PAGE }),
  setTagFilter: (tagFilter) => set({ tagFilter, ...RESET_PAGE }),
  clearStateFilter: () => set({ stateFilter: "all", ...RESET_PAGE }),
  clearTagFilter: () => set({ tagFilter: null, ...RESET_PAGE }),

  toggleDueSort: () => set((state) => ({ sortDescending: !state.sortDescending, ...RESET_PAGE })),
  setOffset: (offset) => set({ offset, selected: new Set() }),

  toggleCard: (id) =>
    set((state) => {
      const selected = new Set(state.selected)
      if (!selected.delete(id)) selected.add(id)
      return { selected }
    }),

  setPageSelection: (ids, selected) => set({ selected: selected ? new Set(ids) : new Set() }),
  clearSelection: () => set({ selected: new Set() }),
}))
