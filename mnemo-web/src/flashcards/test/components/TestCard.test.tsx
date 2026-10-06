// @vitest-environment jsdom

/**
 * Checks multiline prompt and answer wrappers using a local CSS fixture.
 */

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { CardDto } from "@/api/types"

import { loadImages } from "../../occlusion/image-test-helpers"
import { boxHeight } from "../../occlusion/layout"
import { TestCard } from "./TestCard"

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

vi.mock("@/settings/store", () => ({
  useSettingValue: (_key: string, fallback: string) => fallback,
}))

vi.mock("../../editor/assets", () => ({
  useCardAssetUrl: () => "blob:plant-cell",
  useCardAsset: () => ({ url: "blob:plant-cell", failed: false }),
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

const occlusionCard: CardDto = {
  ...multilineCard,
  id: "card-3",
  type: "occlusion",
  front: "Label the parts",
  back: "Rough ER",
  occlusion: {
    mode: "hideAll",
    askedIds: ["b"],
    back: "Plant cells have a wall.",
    imageAssetId: "asset-1",
    masks: ["a", "b"].map((id, order) => ({
      id,
      shape: "rect" as const,
      x: 0.1,
      y: 0.2 * (order + 1),
      w: 0.2,
      h: 0.1,
      points: null,
      label: null,
      group: null,
      order,
    })),
  },
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
      <StrictMode>
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
        />
      </StrictMode>,
    ),
  )
  loadImages(host)
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

  it("draws an occlusion card with the review stage, the asked mask marked", () => {
    render(false, occlusionCard)

    expect(host.querySelector('[data-testid="occlusion-stage"]')).not.toBeNull()
    expect(host.querySelector('[data-mask="b"]')?.getAttribute("data-state")).toBe("asked")
    expect(host.querySelector('[data-mask="a"]')?.getAttribute("data-state")).toBe("covered")
    expect(host.querySelector("[aria-hidden='true'].invisible")?.textContent).toContain("Rough ER")
  })

  it("rings the answer and gives the label and the back text once revealed", () => {
    render(true, occlusionCard)

    expect(host.querySelector('[data-mask="b"]')?.getAttribute("data-state")).toBe("answer")
    expect(host.textContent).toContain("Rough ER")
    expect(host.textContent).toContain("Plant cells have a wall.")
  })
})

describe("TestCard occlusion box in a column", () => {
  const COLUMN = 560
  let chromeBase = 300
  let observers: (() => void)[] = []

  beforeEach(() => {
    observers = []
    chromeBase = 300
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observers.push(callback)
        }
        observe() {}
        disconnect() {}
      },
    )
    const stageHeight = (element: HTMLElement) =>
      parseFloat(element.querySelector<HTMLElement>('[data-testid="occlusion-stage"]')?.style.height ?? "0")
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute("data-card-column") ? COLUMN : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        if (this.hasAttribute("data-card-surface")) return chromeBase + stageHeight(this)
        if (this.parentElement?.classList.contains("basis-full")) return stageHeight(this)
        return 0
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(HTMLElement.prototype, "clientHeight")
    Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight")
  })

  function renderInColumn(revealed: boolean): void {
    host.setAttribute("data-card-column", "")
    render(revealed, occlusionCard)
    act(() => observers.forEach((fire) => fire()))
  }

  const stageHeight = () => parseFloat(host.querySelector<HTMLElement>('[data-testid="occlusion-stage"]')!.style.height)

  it("sizes the image box to what the column leaves after the rest of the card", () => {
    renderInColumn(false)

    expect(stageHeight()).toBe(boxHeight({ column: COLUMN, chrome: 300, compact: false }))
    expect(host.querySelector<HTMLElement>("[data-card-surface]")!.offsetHeight).toBeLessThanOrEqual(COLUMN)
  })

  it("keeps the box where it was when the card gets shorter on reveal", () => {
    renderInColumn(false)
    const before = stageHeight()

    chromeBase = 240
    render(true, occlusionCard)
    act(() => observers.forEach((fire) => fire()))

    expect(stageHeight()).toBe(before)
  })
})
