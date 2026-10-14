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

function render(queue: QueuedImport[], dropping: boolean) {
  act(() =>
    root.render(
      <ImportPanel
        queue={queue}
        extensions={[".md"]}
        describe={() => null}
        refused={[]}
        overflow={false}
        locked={false}
        dropping={dropping}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    ),
  )
}

describe("ImportPanel while files hover", () => {
  it("turns the empty dropzone into the drop target", () => {
    render([], true)
    expect(container.textContent).toContain("TransferDropToImport")
    expect(container.querySelector(".border-accent")).not.toBeNull()

    render([], false)
    expect(container.textContent).not.toContain("TransferDropToImport")
  })

  it("outlines the file list once files are listed", () => {
    render([{ key: "a", name: "a.md", sizeBytes: 1, status: "ready" }], true)
    expect(container.querySelector(".outline-accent")).not.toBeNull()
  })
})
