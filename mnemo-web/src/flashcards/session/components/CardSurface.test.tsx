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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

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

vi.mock("../../editor/assets", () => ({
  useCardAssetUrl: () => "blob:study-image",
}))

// jsdom does not load built CSS. This fixture checks use of the utility class, not the production
// stylesheet.
beforeAll(() => {
  document.head.insertAdjacentHTML("beforeend", "<style>.whitespace-pre-wrap { white-space: pre-wrap; }</style>")
})

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

const multilineCard: CardDto = {
  id: "card-2",
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
  id: "card-3",
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

const illustratedCard: CardDto = {
  ...card,
  id: "card-4",
  attachments: [
    {
      id: "attachment-1",
      side: "front",
      displayName: "Cell diagram",
      sizeBytes: 1234,
      caption: null,
      assetId: "asset-1",
    },
  ],
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

function render(revealed: boolean, cardToRender: CardDto = card, onReveal: () => void = () => {}): void {
  act(() =>
    root.render(
      <CardSurface
        card={cardToRender}
        revealed={revealed}
        canUndo={false}
        onReveal={onReveal}
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

  it("keeps single line breaks in the prompt and the answer instead of collapsing them into one run-on line", () => {
    render(true, multilineCard)

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
    expect(text()).not.toContain("**")
    expect(text()).not.toContain("- ")
  })

  it("shows a revealed cloze deletion in bold", () => {
    render(true, { ...card, back: "The capital of Japan is {{c1::Tokyo}}" })

    expect(host.querySelector("strong")?.textContent).toBe("Tokyo")
  })

  it("does not reveal the answer when the enlarged front image is clicked", () => {
    const onReveal = vi.fn()
    render(false, illustratedCard, onReveal)

    const thumbnail = host.querySelector<HTMLImageElement>('img[alt="Cell diagram"]')
    expect(thumbnail, "the front image is not on screen").not.toBeNull()
    act(() => thumbnail!.click())
    expect(onReveal).not.toHaveBeenCalled()

    const zoom = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(zoom, "the enlarged image did not open").not.toBeNull()
    const enlargedImage = zoom!.querySelector<HTMLImageElement>("[data-study-image-zoom]")
    expect(enlargedImage, "the enlarged image is missing from its dialog").not.toBeNull()
    act(() => enlargedImage!.click())

    expect(onReveal).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("does not reveal the answer when the image zoom backdrop is clicked", () => {
    const onReveal = vi.fn()
    render(false, illustratedCard, onReveal)

    const thumbnail = host.querySelector<HTMLImageElement>('img[alt="Cell diagram"]')
    expect(thumbnail, "the front image is not on screen").not.toBeNull()
    act(() => thumbnail!.click())

    const dismissalSurface = document.querySelector<HTMLElement>("[data-study-image-zoom-surface]")
    expect(dismissalSurface, "the image zoom backdrop is missing").not.toBeNull()
    act(() => dismissalSurface!.click())

    expect(onReveal).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("uses one viewport-bound frame for enlarged images", () => {
    render(false, illustratedCard)

    const thumbnail = host.querySelector<HTMLImageElement>('img[alt="Cell diagram"]')
    expect(thumbnail, "the front image is not on screen").not.toBeNull()
    act(() => thumbnail!.click())

    const enlargedImage = document.querySelector<HTMLImageElement>("[data-study-image-zoom]")
    expect(enlargedImage, "the enlarged image did not open").not.toBeNull()
    // A ceiling only: the picture fits the frame but is never inflated past its own pixels.
    expect(enlargedImage!.classList).toContain("max-h-[min(900px,75vh)]")
    expect(enlargedImage!.classList).toContain("max-w-[min(1200px,75vw)]")
    expect(enlargedImage!.classList).toContain("object-contain")
    expect([...enlargedImage!.classList].some((name) => /^[hw]-\[/.test(name))).toBe(false)
  })
})
