// @vitest-environment jsdom

/**
 * The ProseMirror keymap that actually dispatches editor chords is built with no
 * overrides threaded in, so a "recorded" rebind for one of those actions would show
 * as bound and never fire. The row has to make that plain instead of offering a
 * control it cannot honour.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { useKeybindStore } from "@/keybinds/store"
import type { Keybind } from "@/keybinds/types"

import { KeyboardPage } from "./KeyboardPage"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RECORD_ATTR = "data-keybind-record"

function keybind(overrides: Partial<Keybind>): Keybind {
  return {
    actionId: "test.action",
    namespace: "core",
    scope: "Global",
    module: null,
    enabled: true,
    allowedDuringTextCapture: false,
    toggleOnRepeat: false,
    labelKey: null,
    descriptionKey: null,
    categoryKey: null,
    bindings: [{ kind: "Chord", chord: "Primary+K" }],
    isOverridden: false,
    ...overrides,
  }
}

let container: HTMLElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  useKeybindStore.getState().setKeybinds([])
})

describe("KeyboardPage", () => {
  it("disables rebinding for editor-scope actions but not global ones", () => {
    useKeybindStore.getState().setKeybinds([
      keybind({ actionId: "editor.bold", module: "editor" }),
      keybind({ actionId: "global.search", module: "core" }),
    ])

    act(() => {
      root.render(<KeyboardPage />)
    })

    // The editor-scope row's shortcut control does not carry the recorder marker
    // and is disabled; the global row's does and is not.
    const editorRecordButton = findRecordButton(container, "editor.bold")
    const globalRecordButton = findRecordButton(container, "global.search")

    expect(editorRecordButton?.hasAttribute(RECORD_ATTR)).toBe(false)
    expect(editorRecordButton?.disabled).toBe(true)

    expect(globalRecordButton?.hasAttribute(RECORD_ATTR)).toBe(true)
    expect(globalRecordButton?.disabled).toBe(false)
  })
})

/** The row's shortcut-recorder button, found by walking up from its label text. */
function findRecordButton(root: HTMLElement, actionId: string): HTMLButtonElement | null {
  const label = [...root.querySelectorAll("p")].find((p) => p.textContent === actionId)
  const row = label?.closest("div.group\\/kb")
  return row?.querySelector("button") ?? null
}
