import { beforeEach, describe, expect, it } from "vitest"

import { useBrowseView } from "./store"

const initial = useBrowseView.getState()

beforeEach(() => {
  useBrowseView.setState(initial, true)
})

describe("useBrowseView", () => {
  it("commits the search box into the query and resets to page one", () => {
    useBrowseView.getState().setOffset(50)
    useBrowseView.getState().toggleCard("c1")
    useBrowseView.getState().setSearch("photosynthesis")

    useBrowseView.getState().commitSearch()

    const state = useBrowseView.getState()
    expect(state.query).toBe("photosynthesis")
    expect(state.offset).toBe(0)
    expect(state.selected.size).toBe(0)
  })

  it("does nothing on commit when the query already matches the box", () => {
    useBrowseView.getState().setSearch("cats")
    useBrowseView.getState().commitSearch()
    useBrowseView.getState().setOffset(50)

    useBrowseView.getState().commitSearch()

    // A second commit with nothing new typed must not clobber a page the reader
    // already turned to.
    expect(useBrowseView.getState().offset).toBe(50)
  })

  it.each([
    ["setStateFilter", () => useBrowseView.getState().setStateFilter("due")],
    ["setTagFilter", () => useBrowseView.getState().setTagFilter("biology")],
    ["setDeckFilter", () => useBrowseView.getState().setDeckFilter("deck-1")],
    ["setCardTypeFilter", () => useBrowseView.getState().setCardTypeFilter("type-1")],
    ["setLapsesFilter", () => useBrowseView.getState().setLapsesFilter("never")],
    ["clearTagFilter", () => useBrowseView.getState().clearTagFilter()],
    ["clearDeckFilter", () => useBrowseView.getState().clearDeckFilter()],
    ["clearCardTypeFilter", () => useBrowseView.getState().clearCardTypeFilter()],
    ["toggleDueSort", () => useBrowseView.getState().toggleDueSort()],
  ])("%s drops the current page and selection", (_name, act) => {
    useBrowseView.getState().setOffset(50)
    useBrowseView.getState().toggleCard("c1")

    act()

    const state = useBrowseView.getState()
    expect(state.offset).toBe(0)
    expect(state.selected.size).toBe(0)
  })

  it("clearFilters returns every dimension, including the search box, to its default", () => {
    useBrowseView.getState().setSearch("cats")
    useBrowseView.getState().commitSearch()
    useBrowseView.getState().setStateFilter("flagged")
    useBrowseView.getState().setTagFilter("biology")
    useBrowseView.getState().setDeckFilter("deck-1")
    useBrowseView.getState().setCardTypeFilter("type-1")
    useBrowseView.getState().setLapsesFilter("three-or-more")
    useBrowseView.getState().toggleCard("c1")

    useBrowseView.getState().clearFilters()

    const state = useBrowseView.getState()
    expect(state.search).toBe("")
    expect(state.query).toBe("")
    expect(state.stateFilter).toBe("all")
    expect(state.tagFilter).toBeNull()
    expect(state.deckFilter).toBeNull()
    expect(state.cardTypeFilter).toBeNull()
    expect(state.lapsesFilter).toBe("any")
    expect(state.offset).toBe(0)
    expect(state.selected.size).toBe(0)
  })

  it("toggleCard adds an unselected id and removes a selected one", () => {
    useBrowseView.getState().toggleCard("c1")
    expect(useBrowseView.getState().selected.has("c1")).toBe(true)

    useBrowseView.getState().toggleCard("c1")
    expect(useBrowseView.getState().selected.has("c1")).toBe(false)
  })

  it("setPageSelection selects or clears the given ids wholesale", () => {
    useBrowseView.getState().setPageSelection(["a", "b", "c"], true)
    expect([...useBrowseView.getState().selected]).toEqual(["a", "b", "c"])

    useBrowseView.getState().setPageSelection(["a", "b", "c"], false)
    expect(useBrowseView.getState().selected.size).toBe(0)
  })

  it("setOffset always clears the selection, since it never spans pages", () => {
    useBrowseView.getState().toggleCard("c1")
    useBrowseView.getState().setOffset(50)
    expect(useBrowseView.getState().selected.size).toBe(0)
  })
})
