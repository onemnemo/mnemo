// @vitest-environment jsdom

/**
 * Mounts the real card surface over a cloze card shaped exactly as generation stores one: a front
 * already masked, and a back already holding the sentence filled in.
 *
 * The pure tests in `study.test.ts` cover which side the answer is read from. What is worth pinning
 * here is that the screen shows it, because the shipped bug was not in the rule but in the half that
 * rendered the masked prompt twice and never the answer.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CardDto } from "@/api/types"

import { CardSurface } from "./CardSurface"

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

vi.mock("@/settings/store", () => ({
  useSettingValue: (_key: string, fallback: string) => fallback,
}))

vi.mock("@/components/icon/AppIcon", () => ({
  AppIcon: ({ name }: { name: string }) => <span data-icon={name} />,
}))

const card: CardDto = {
  id: "card-1",
  deckId: "deck-1",
  type: "cloze",
  front: "The capital of Japan is […]",
  back: "The capital of Japan is Tokyo",
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

function render(revealed: boolean): void {
  act(() =>
    root.render(
      <CardSurface
        card={card}
        revealed={revealed}
        canUndo={false}
        onReveal={() => {}}
        onEdit={() => {}}
        onFlag={() => {}}
        onUndo={() => {}}
      />,
    ),
  )
}

function text(): string {
  return host.textContent ?? ""
}

describe("CardSurface", () => {
  it("shows the masked sentence and no answer before the reveal", () => {
    render(false)

    expect(text()).toContain("The capital of Japan is […]")
    expect(text()).not.toContain("Tokyo")
  })

  it("shows the answer once revealed, rather than the masked sentence a second time", () => {
    render(true)

    expect(text()).toContain("The capital of Japan is Tokyo")
  })

  it("does not repeat the placeholder on the answer side", () => {
    render(true)

    // The prompt keeps its own placeholder, so one is expected and two is the bug.
    expect(text().split("[…]").length - 1).toBe(1)
  })
})
