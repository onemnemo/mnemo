// @vitest-environment jsdom

/**
 * A renderer nobody can reach is dead code. One entry point per renderer, each on a menu
 * or a header that already existed, checked to build the item its renderer expects.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CardViewDto, DeckSummaryDto } from "@/api/types"
import { SomaDock } from "@/components/shell/dock/SomaDock"
import { BrowseRow, type BrowseRowActions } from "@/flashcards/browse/components/BrowseRow"
import { useSettingsStore } from "@/settings/store"
import { useSomaStore } from "@/stores/soma"

import { usePeekStore } from "./store"

vi.mock("@/i18n/useT", () => ({ useT: () => (_ns: string, key: string) => key }))
vi.mock("@/app/router", () => ({ navigate: vi.fn() }))
// The dock loads its conversation lazily, which has nothing to do with the entry under test.
vi.mock("@/chat/components/SomaDockBody", () => ({ SomaDockBody: () => null }))
vi.mock("@/chat/store", () => ({
  useChatStore: (select: (state: { newChat: unknown }) => unknown) => select({ newChat: () => {} }),
}))
vi.mock("@/keybinds/store", () => ({ useShortcutLabel: () => "" }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CARD_VIEW = {
  card: {
    id: "c1",
    deckId: "d1",
    front: "front",
    back: "back",
    tags: [],
    attachments: [],
    state: "review",
    isFlagged: false,
  },
  schedule: { lapses: 0, due: "2026-01-01T00:00:00Z" },
} as unknown as CardViewDto

let container: HTMLElement
let root: Root

const initial = usePeekStore.getState()

function mount(node: ReactNode): void {
  act(() => root.render(node))
}

function chooseItem(label: string): void {
  const item = [...document.querySelectorAll("[role='menuitem']")].find(
    (element) => element.textContent === label,
  )
  expect(item, `no menu item labelled ${label}`).not.toBeUndefined()
  act(() => (item as HTMLElement).click())
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  usePeekStore.setState({ ...initial, item: null, nonce: 0 })
  useSomaStore.setState({ dockOpen: true })
  useSettingsStore.setState({ values: { "App.DeveloperMode": true, "AI.EnableAssistant": true } })

  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("a card from the browse table", () => {
  it("opens with the row's own view and deck name, so the renderer needs no fetch", () => {
    const actions = {
      onPeek: () => {},
      onEdit: () => {},
      onFlag: () => {},
      onSuspend: () => {},
      onMove: () => {},
      onDelete: () => {},
    } satisfies BrowseRowActions

    mount(
      <BrowseRow
        view={CARD_VIEW}
        deckName="Anatomy"
        selected={false}
        onToggleSelect={() => {}}
        moveTargets={[] as DeckSummaryDto[]}
        actions={actions}
        now={Date.parse("2026-01-01T00:00:00Z")}
      />,
    )

    const row = container.querySelector<HTMLElement>("[role='row']")
    act(() => {
      row!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
    })
    chooseItem("PeekOpenInSidePeek")

    expect(usePeekStore.getState().item).toEqual({
      kind: "card",
      id: "c1",
      deckId: "d1",
      deckName: "Anatomy",
      view: CARD_VIEW,
    })
  })
})

describe("the assistant from its dock", () => {
  it("moves the conversation into the peek and closes the dock behind it", () => {
    mount(<SomaDock />)

    const button = [...container.querySelectorAll("button")].find(
      (element) => element.getAttribute("aria-label") === "PeekOpenInSidePeek",
    )
    expect(button).not.toBeUndefined()
    act(() => button!.click())

    expect(usePeekStore.getState().item).toEqual({ kind: "soma" })
    expect(useSomaStore.getState().dockOpen).toBe(false)
  })
})
