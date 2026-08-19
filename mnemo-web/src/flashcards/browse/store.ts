import { create } from "zustand"

import type { CardStateFilter } from "@/api/types"

import type { LapsesFilter } from "../deck/filters"

// View state for the collection-wide browser. Session-only, like the deck table's, and
// deliberately the same shape where the dimension is the same: state, tags, lapses, sort,
// paging and selection all mean exactly what they mean on one deck's table. Two dimensions
// are new because there is no single deck to imply them: deckFilter narrows to one deck
// without leaving the page, and cardTypeFilter is the real, user-defined card type rather
// than the deck table's classic/cloze split - the fact model has no other place a card's
// authored type shows up.

interface BrowseViewState {
  search: string
  query: string
  stateFilter: CardStateFilter
  tagFilter: string | null
  deckFilter: string | null
  cardTypeFilter: string | null
  lapsesFilter: LapsesFilter
  sortDescending: boolean
  offset: number
  /** Ids selected on the current page. Selection never spans pages. */
  selected: Set<string>

  setSearch: (search: string) => void
  commitSearch: () => void
  setStateFilter: (state: CardStateFilter) => void
  setTagFilter: (tag: string) => void
  setDeckFilter: (deckId: string) => void
  setCardTypeFilter: (typeId: string) => void
  setLapsesFilter: (lapses: LapsesFilter) => void
  clearTagFilter: () => void
  clearDeckFilter: () => void
  clearCardTypeFilter: () => void
  /** Drops every filter and the search box in one go, for the strip's Clear. */
  clearFilters: () => void
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
  deckFilter: null,
  cardTypeFilter: null,
  lapsesFilter: "any" as LapsesFilter,
  sortDescending: false,
  offset: 0,
  selected: new Set<string>(),
}

// Anything that changes which rows are on screen also drops the selection, since
// the ids it holds are about to stop being visible.
const RESET_PAGE = { offset: 0, selected: new Set<string>() }

export const useBrowseView = create<BrowseViewState>((set) => ({
  ...EMPTY,

  setSearch: (search) => set({ search }),
  commitSearch: () => set((state) => (state.query === state.search ? {} : { query: state.search, ...RESET_PAGE })),

  setStateFilter: (stateFilter) => set({ stateFilter, ...RESET_PAGE }),
  setTagFilter: (tagFilter) => set({ tagFilter, ...RESET_PAGE }),
  setDeckFilter: (deckFilter) => set({ deckFilter, ...RESET_PAGE }),
  setCardTypeFilter: (cardTypeFilter) => set({ cardTypeFilter, ...RESET_PAGE }),
  setLapsesFilter: (lapsesFilter) => set({ lapsesFilter, ...RESET_PAGE }),
  clearTagFilter: () => set({ tagFilter: null, ...RESET_PAGE }),
  clearDeckFilter: () => set({ deckFilter: null, ...RESET_PAGE }),
  clearCardTypeFilter: () => set({ cardTypeFilter: null, ...RESET_PAGE }),
  clearFilters: () => set({ ...EMPTY }),

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
