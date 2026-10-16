// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { QueuedImport } from "./import-queue"
import { ImportPanel } from "./ImportPanel"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

let container: HTMLElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
})

function render(queue: QueuedImport[], dropCount: number | null) {
  act(() =>
    root.render(
      <ImportPanel
        queue={queue}
        describe={() => null}
        refused={[]}
        overflow={false}
        locked={false}
        dropCount={dropCount}
        onBrowse={vi.fn()}
        onRemove={vi.fn()}
      />,
    ),
  )
}

describe("ImportPanel while files hover", () => {
  it("covers the body with the drop target and says how many files are coming", () => {
    render([], 3)
    expect(container.textContent).toContain("TransferDropChecked")
    expect(container.querySelector(".border-accent")).not.toBeNull()

    render([], null)
    expect(container.textContent).not.toContain("TransferDropChecked")
  })

  it("counts a dragged folder as one item", () => {
    act(() =>
      root.render(
        <ImportPanel queue={[]} describe={() => null} refused={[]} overflow={false} locked={false} dropCount={1} folders onBrowse={vi.fn()} onRemove={vi.fn()} />,
      ),
    )
    expect(container.textContent).toContain("TransferDropToAddOne")
  })

  it("falls back to a plain prompt when the platform does not say how many", () => {
    render([], 0)
    expect(container.textContent).toContain("TransferDropToImport")
  })

  it("covers the queue too once files are listed", () => {
    render([{ key: "a", name: "a.md", sizeBytes: 1, status: "ready" }], 1)
    expect(container.querySelector(".border-accent")).not.toBeNull()
  })

  it("shows a skipped row calmly, with its reason", () => {
    render([{ key: "a", name: "a.mnemo", sizeBytes: 1, status: "rejected", notes: [{ text: "No notes inside" }] }], null)
    expect(container.textContent).toContain("No notes inside")
    expect(container.querySelector(".line-through")).toBeNull()
  })
})
