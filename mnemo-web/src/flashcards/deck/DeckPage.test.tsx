// @vitest-environment jsdom

/**
 * A context menu action on a single unselected row must not disturb an unrelated
 * multi-selection sitting elsewhere on the page. This drives that rule (the `run`
 * helper inside DeckPage) through the actions object the page hands its card table
 * and selection bar, against the real useDeckView store, mocking out only the
 * child components and the query hooks.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CardRowActions } from "./components/CardRow"
import { useDeckView } from "./store"
import { DeckPage } from "./DeckPage"

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

let capturedActions: CardRowActions | null = null
let capturedBar: SelectionBarProps | null = null

vi.mock("../api", () => ({
  useDecksQuery: () => ({ data: [] }),
}))

vi.mock("./api", () => ({
  useCardTagsQuery: () => ({ data: [] }),
  useCardsQuery: () => ({
    data: {
      items: [
        { card: { id: "c1", state: "review", isFlagged: false }, schedule: {} },
        { card: { id: "c2", state: "review", isFlagged: false }, schedule: {} },
      ],
      totalCount: 2,
      offset: 0,
      limit: 50,
    },
    isSuccess: true,
  }),
  useDeckQuery: () => ({ data: { totalCards: 2 }, error: undefined }),
  useDeleteCards: () => ({ mutateAsync: mocks.del }),
  useFlagCards: () => ({ mutateAsync: mocks.flag }),
  useMoveCards: () => ({ mutateAsync: mocks.move }),
  useSuspendCards: () => ({ mutateAsync: mocks.suspend }),
  useTagCards: () => ({ mutateAsync: mocks.tag }),
}))

vi.mock("./components/DeckHeader", () => ({ DeckHeader: () => null }))
vi.mock("./components/DeckToolbar", () => ({ DeckToolbar: () => null }))

vi.mock("./components/CardTable", () => ({
  CardTable: (props: { actions: CardRowActions }) => {
    capturedActions = props.actions
    return null
  },
}))

vi.mock("./components/SelectionBar", () => ({
  SelectionBar: (props: SelectionBarProps) => {
    capturedBar = props
    return null
  },
}))

vi.mock("@/app/router", () => ({ navigate: vi.fn() }))
vi.mock("@/i18n/useT", () => ({ useT: () => (_ns: string, key: string) => key }))
vi.mock("@/stores/dialog", () => ({ dialog: { confirm: vi.fn(async () => true) } }))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  capturedActions = null
  capturedBar = null
  useDeckView.setState({
    deckId: null,
    search: "",
    query: "",
    stateFilter: "all",
    tagFilter: null,
    typeFilter: null,
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
  act(() => root.render(<DeckPage deckId="d1" />))
}

/** Flushes both the mutation's own microtask and the state update `run` makes after it. */
async function settle(): Promise<void> {
  await act(async () => {})
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe("DeckPage selection", () => {
  it("leaves an unrelated selection untouched after a single row action", async () => {
    mount()
    await settle()
    act(() => useDeckView.setState({ selected: new Set(["c1"]) }))
    await settle()

    act(() => capturedActions!.onFlag("c2", true))
    await settle()

    expect(mocks.flag).toHaveBeenCalledWith({ cardIds: ["c2"], value: true })
    expect(useDeckView.getState().selected).toEqual(new Set(["c1"]))
  })

  it("clears the selection once a single row action lands on a selected card", async () => {
    mount()
    await settle()
    act(() => useDeckView.setState({ selected: new Set(["c1"]) }))
    await settle()

    act(() => capturedActions!.onSuspend("c1", true))
    await settle()

    expect(mocks.suspend).toHaveBeenCalledWith({ cardIds: ["c1"], value: true })
    expect(useDeckView.getState().selected).toEqual(new Set())
  })

  it("clears the selection after a batch action from the selection bar", async () => {
    mount()
    await settle()
    act(() => useDeckView.setState({ selected: new Set(["c1", "c2"]) }))
    await settle()

    act(() => capturedBar!.onSuspend(true))
    await settle()

    expect(mocks.suspend).toHaveBeenCalledWith({ cardIds: ["c1", "c2"], value: true })
    expect(useDeckView.getState().selected).toEqual(new Set())
  })
})
