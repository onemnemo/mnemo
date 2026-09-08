// @vitest-environment jsdom

/**
 * Checks multiline prompt and answer wrappers using a local CSS fixture.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { CardDto } from "@/api/types"

import { TestCard } from "./TestCard"

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

vi.mock("@/settings/store", () => ({
  useSettingValue: (_key: string, fallback: string) => fallback,
}))

vi.mock("@/components/icon/AppIcon", () => ({
  AppIcon: ({ name }: { name: string }) => <span data-icon={name} />,
}))

// jsdom does not load built CSS. This fixture checks use of the utility class, not the production
// stylesheet.
beforeAll(() => {
  document.head.insertAdjacentHTML("beforeend", "<style>.whitespace-pre-wrap { white-space: pre-wrap; }</style>")
})

const multilineCard: CardDto = {
  id: "card-1",
  deckId: "deck-1",
  type: "classic",
  front: "Top left\nTop right\nBottom left\nBottom right",
  back: "Right atrium\nRight ventricle\nLeft atrium\nLeft ventricle",
  tags: [],
  state: "active",
  isFlagged: false,
  attachments: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
}

const formattedCard: CardDto = {
  ...multilineCard,
  id: "card-2",
  front: "What is **ATP** for?",
  back: "- energy currency\n- made in the mitochondria",
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

function render(revealed: boolean, cardToRender: CardDto = multilineCard): void {
  act(() =>
    root.render(
      <TestCard
        card={cardToRender}
        answer=""
        revealed={revealed}
        canUndo={false}
        onAnswerChange={() => {}}
        onReveal={() => {}}
        onEdit={() => {}}
        onFlag={() => {}}
        onUndo={() => {}}
      />,
    ),
  )
}

describe("TestCard", () => {
  it("keeps the prompt's line breaks before the answer is revealed", () => {
    render(false)

    const prose = host.querySelectorAll<HTMLElement>(".chat-prose")
    expect(prose).toHaveLength(1)
    expect(getComputedStyle(prose[0]).whiteSpace).toBe("pre-wrap")
  })

  it("keeps single line breaks in the prompt and the correct answer instead of collapsing them into one run-on line", () => {
    render(true)

    const prose = host.querySelectorAll<HTMLElement>(".chat-prose")
    expect(prose).toHaveLength(2)
    for (const el of prose) {
      expect(getComputedStyle(el).whiteSpace).toBe("pre-wrap")
    }
  })

  it("renders the format bar's markers on both sides instead of showing them", () => {
    render(true, formattedCard)

    expect(host.querySelector("strong")?.textContent).toBe("ATP")
    expect(host.querySelectorAll("li")).toHaveLength(2)
    expect(host.textContent).not.toContain("**")
    expect(host.textContent).not.toContain("- ")
  })
})
