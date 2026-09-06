// @vitest-environment jsdom

/**
 * The quick look has to read a card the way the review screen does, because it is where a card
 * is checked before it is studied: a marker still showing here would send someone off editing
 * text that is already correct.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CardDto } from "@/api/types"

import { CardPeekBody } from "./CardPeekBody"

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

vi.mock("../../editor/assets", () => ({
  useCardAssetUrl: () => null,
}))

vi.mock("@/components/icon/AppIcon", () => ({
  AppIcon: ({ name }: { name: string }) => <span data-icon={name} />,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const card: CardDto = {
  id: "card-1",
  deckId: "deck-1",
  type: "classic",
  front: "What is **ATP** for?",
  back: "- energy currency\n- made in the mitochondria",
  tags: [],
  state: "active",
  isFlagged: false,
  attachments: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe("CardPeekBody", () => {
  it("renders the format bar's markers rather than showing them", () => {
    act(() => root.render(<CardPeekBody card={card} />))

    expect(host.querySelector("strong")?.textContent).toBe("ATP")
    expect(host.querySelectorAll("li")).toHaveLength(2)
    expect(host.textContent).not.toContain("**")
    expect(host.textContent).not.toContain("- ")
  })
})
