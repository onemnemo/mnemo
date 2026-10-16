// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TransferShell } from "./TransferShell"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

vi.mock("@/keybinds/chord", () => ({ isMac: false }))

let container: HTMLElement
let root: Root
const onConfirm = vi.fn()
const onDirection = vi.fn()

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  onConfirm.mockClear()
  onDirection.mockClear()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render({ both = true, confirmEnabled = true }: { both?: boolean; confirmEnabled?: boolean } = {}) {
  act(() =>
    root.render(
      <TransferShell
        direction="import"
        both={both}
        onDirection={onDirection}
        busy={false}
        confirmLabel="Import"
        confirmEnabled={confirmEnabled}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      >
        body
      </TransferShell>,
    ),
  )
}

function pressCtrlEnter() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }))
  })
}

describe("TransferShell", () => {
  it("confirms on Ctrl+Enter only while confirming is allowed", () => {
    render()
    pressCtrlEnter()
    expect(onConfirm).toHaveBeenCalledTimes(1)

    render({ confirmEnabled: false })
    pressCtrlEnter()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it("shows tabs when the dialog offers both directions and a title otherwise", () => {
    render()
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(2)

    render({ both: false })
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0)
    expect(document.querySelector("h2")?.textContent).toBe("TransferImportTab")
  })

  it("links the selected tab to the panel and moves between tabs with the arrow keys", () => {
    render()
    const [importTab, exportTab] = [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
    const panel = document.querySelector('[role="tabpanel"]')!

    expect(importTab.getAttribute("aria-controls")).toBe(panel.id)
    expect(panel.getAttribute("aria-labelledby")).toBe(importTab.id)
    expect(importTab.tabIndex).toBe(0)
    expect(exportTab.tabIndex).toBe(-1)

    act(() => {
      importTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }))
    })
    expect(onDirection).toHaveBeenCalledWith("export")
    expect(document.activeElement).toBe(exportTab)
  })
})
