// @vitest-environment jsdom

/**
 * The collection-wide browser shares DeckPage's `run` rule: a context menu action on a
 * single unselected row must not disturb an unrelated multi-selection elsewhere on the
 * page. Same drive as deck/DeckPage.test.tsx, against BrowsePage's own wiring and the
 * real useBrowseView store.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { BrowseRowActions } from "./components/BrowseRow"
import { useBrowseView } from "./store"
import { BrowsePage } from "./BrowsePage"

const mocks = vi.hoisted(() => ({
  flag: vi.fn(async () => ({})),
  suspend: vi.fn(async () => ({})),
  move: vi.fn(async () => ({})),
  tag: vi.fn(async () => ({})),
  del: vi.fn(async () => ({})),
}))

interface SelectionBarProps {
  onMove: (targetDeckId: string) => void
  onTag: (tag: string) => void
  onSuspend: (value: boolean) => void
  onFlag: (value: boolean) => void
  onDelete: () => void
  onClear: () => void
}

let capturedActions: BrowseRowActions | null = null
let capturedBar: SelectionBarProps | null = null

vi.mock("../api", () => ({
  useDecksQuery: () => ({ data: [] }),
  useFoldersQuery: () => ({ data: [] }),
}))

vi.mock("../facts/api", () => ({
  useCardTypesQuery: () => ({ data: [] }),
}))

vi.mock("./api", () => ({
  useBrowseCardsQuery: () => ({
    data: {
      items: [
        { card: { id: "c1", deckId: "d1", state: "review", isFlagged: false }, schedule: {} },
        { card: { id: "c2", deckId: "d1", state: "review", isFlagged: false }, schedule: {} },
      ],
      totalCount: 2,
      offset: 0,
      limit: 50,
    },
    isSuccess: true,
  }),
  useBrowseTagsQuery: () => ({ data: [] }),
  useBrowseDeleteCards: () => ({ mutateAsync: mocks.del }),
  useBrowseFlagCards: () => ({ mutateAsync: mocks.flag }),
  useBrowseMoveCards: () => ({ mutateAsync: mocks.move }),
  useBrowseSuspendCards: () => ({ mutateAsync: mocks.suspend }),
  useBrowseTagCards: () => ({ mutateAsync: mocks.tag }),
}))

vi.mock("./components/BrowseToolbar", () => ({ BrowseToolbar: () => null }))

vi.mock("./components/BrowseTable", () => ({
  BrowseTable: (props: { actions: BrowseRowActions }) => {
    capturedActions = props.actions
    return null
  },
}))

vi.mock("../deck/components/SelectionBar", () => ({
  SelectionBar: (props: SelectionBarProps) => {
    capturedBar = props
    return null
  },
}))

vi.mock("@/app/router", () => ({ navigate: vi.fn() }))
vi.mock("@/i18n/useT", () => ({ useT: () => (_ns: string, key: string) => key }))
// Deleting raises the undo toast, which reaches for the query cache this page is mounted without.
vi.mock("@/trash/undo", () => ({ useUndoDelete: () => vi.fn() }))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  capturedActions = null
  capturedBar = null
  useBrowseView.setState({
    search: "",
    query: "",
    stateFilter: "all",
    tagFilter: null,
    deckFilter: null,
    cardTypeFilter: null,
    lapsesFilter: "any",
    sortDescending: false,
    offset: 0,
    selected: new Set(),
  })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function mount(): void {
  act(() => root.render(<BrowsePage />))
}

/** Flushes both the mutation's own microtask and the state update `run` makes after it. */
async function settle(): Promise<void> {
  await act(async () => {})
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe("BrowsePage selection", () => {
  it("leaves an unrelated selection untouched after a single row action", async () => {
    mount()
    await settle()
    act(() => useBrowseView.setState({ selected: new Set(["c1"]) }))
    await settle()

    act(() => capturedActions!.onFlag("c2", true))
    await settle()

    expect(mocks.flag).toHaveBeenCalledWith({ cardIds: ["c2"], value: true })
    expect(useBrowseView.getState().selected).toEqual(new Set(["c1"]))
  })

  it("clears the selection once a single row action lands on a selected card", async () => {
    mount()
    await settle()
    act(() => useBrowseView.setState({ selected: new Set(["c1"]) }))
    await settle()

    act(() => capturedActions!.onSuspend("c1", true))
    await settle()

    expect(mocks.suspend).toHaveBeenCalledWith({ cardIds: ["c1"], value: true })
    expect(useBrowseView.getState().selected).toEqual(new Set())
  })

  it("clears the selection after a batch action from the selection bar", async () => {
    mount()
    await settle()
    act(() => useBrowseView.setState({ selected: new Set(["c1", "c2"]) }))
    await settle()

    act(() => capturedBar!.onSuspend(true))
    await settle()

    expect(mocks.suspend).toHaveBeenCalledWith({ cardIds: ["c1", "c2"], value: true })
    expect(useBrowseView.getState().selected).toEqual(new Set())
  })
})
