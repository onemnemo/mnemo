// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CardType, CardViewDto } from "@/api/types"

import { CardRow } from "./CardRow"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

vi.mock("@/components/icon/AppIcon", () => ({
  AppIcon: ({ name, title }: { name: string; title?: string }) => <span data-icon={name} data-title={title} />,
}))

function view(type: CardType, front: string, back: string): CardViewDto {
  return {
    card: {
      id: "c1",
      deckId: "d1",
      type,
      front,
      back,
      tags: [],
      state: "active",
      isFlagged: false,
      attachments: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    schedule: {
      dueDate: "2026-02-01T00:00:00Z",
      stability: null,
      difficulty: null,
      reps: 0,
      lapses: 0,
      fsrsState: "new",
      learningStepIndex: 0,
      lastReviewedAt: null,
    },
  }
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

function render(item: CardViewDto): void {
  const noop = () => {}
  act(() =>
    root.render(
      <CardRow
        view={item}
        selected={false}
        onToggleSelect={noop}
        moveTargets={[]}
        actions={{ onEdit: noop, onFlag: noop, onSuspend: noop, onMove: noop, onReschedule: noop, onDelete: noop }}
        now={Date.UTC(2026, 0, 15)}
      />,
    ),
  )
}

const icons = () => [...host.querySelectorAll<HTMLElement>("[data-icon]")].map((el) => el.dataset.icon)

describe("a deck row", () => {
  it("marks an occlusion card with a named image glyph where cloze shows braces", () => {
    render(view("occlusion", "Label the parts of a cell", "Rough ER"))

    expect(icons()).toContain("image")
    expect(icons()).not.toContain("braces")
    expect(host.querySelector('[data-icon="image"]')?.getAttribute("data-title")).toBe("CardTypeOcclusion")
  })

  it("shows the mask label in the back cell, or No label in its place", () => {
    render(view("occlusion", "Label the parts of a cell", "Rough ER"))
    expect(host.textContent).toContain("Rough ER")

    render(view("occlusion", "Label the parts of a cell", ""))
    expect(host.textContent).toContain("OcclusionNoLabel")
  })

  it("keeps braces for cloze and no marker for a plain card", () => {
    render(view("cloze", "A {{c1::b}}", "A b"))
    expect(icons()).toContain("braces")

    render(view("classic", "Q", "A"))
    expect(icons()).not.toContain("braces")
    expect(icons()).not.toContain("image")
    expect(host.textContent).not.toContain("OcclusionNoLabel")
  })
})
