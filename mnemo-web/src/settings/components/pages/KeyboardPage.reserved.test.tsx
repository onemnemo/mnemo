// @vitest-environment jsdom

/**
 * A chord the window guard swallows (F5, Ctrl+R, the print chord) must never be stored
 * as a binding: it would read as set on this page and never fire. The recorder has to
 * decline it, say so, and stay armed for another press; a row already holding one has
 * to say so too.
 */

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useKeybindStore } from "@/keybinds/store"
import type { Keybind } from "@/keybinds/types"

import { KeyboardPage } from "./KeyboardPage"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const api = vi.hoisted(() => ({
  putKeybindOverride: vi.fn(async () => {}),
  fetchKeybinds: vi.fn(async () => [] as Keybind[]),
}))

vi.mock("@/keybinds/api", () => ({
  putKeybindOverride: api.putKeybindOverride,
  fetchKeybinds: api.fetchKeybinds,
  deleteKeybindOverride: vi.fn(async () => {}),
  resetKeybindOverrides: vi.fn(async () => {}),
}))

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string, params?: Record<string, string | number>) =>
    params ? `${key}(${Object.values(params).join(",")})` : key,
}))

// The rule under test is spelled for the platform the test runs on; Win32 keeps
// "Primary" meaning Ctrl so the pressed chord and the message read the same everywhere.
vi.mock("@/keybinds/chord", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/keybinds/chord")>()
  return { ...original, isMac: false }
})

function keybind(overrides: Partial<Keybind>): Keybind {
  return {
    actionId: "test.action",
    namespace: "core",
    scope: "Global",
    module: "core",
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
  vi.clearAllMocks()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  useKeybindStore.getState().setKeybinds([])
})

function mount(): void {
  act(() => {
    root.render(
      <StrictMode>
        <KeyboardPage />
      </StrictMode>,
    )
  })
}

function recordButton(actionId: string): HTMLButtonElement {
  const label = [...container.querySelectorAll("p")].find((p) => p.textContent === actionId)
  const button = label?.closest("div.group\\/kb")?.querySelector("button")
  expect(button, `no recorder on the ${actionId} row`).toBeTruthy()
  return button as HTMLButtonElement
}

function press(init: KeyboardEventInit): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }))
  })
}

describe("KeyboardPage and the reserved chords", () => {
  it("declines a reserved chord, says which, and keeps listening", async () => {
    useKeybindStore.getState().setKeybinds([keybind({ actionId: "global.search" })])
    mount()

    act(() => recordButton("global.search").click())
    press({ code: "KeyR", key: "r", ctrlKey: true })

    expect(api.putKeybindOverride).not.toHaveBeenCalled()
    expect(recordButton("global.search").textContent).toBe("KeyboardReservedFormat(Ctrl R)")

    press({ code: "KeyJ", key: "j", ctrlKey: true })
    await act(async () => {})

    expect(api.putKeybindOverride).toHaveBeenCalledWith("global.search", [{ kind: "Chord", chord: "Primary+J" }])
  })

  it.each([
    ["F5", { code: "F5", key: "F5" }],
    ["Shift+F5", { code: "F5", key: "F5", shiftKey: true }],
    ["Primary+Shift+R", { code: "KeyR", key: "r", ctrlKey: true, shiftKey: true }],
    ["Primary+P", { code: "KeyP", key: "p", ctrlKey: true }],
    // A layout where r or p sit on another physical key: the guard swallows the press by the
    // character it typed, so the recorder must refuse it by that reading too.
    ["Ctrl+R typed from the S key", { code: "KeyS", key: "r", ctrlKey: true }],
    ["Ctrl+P typed from the L key", { code: "KeyL", key: "p", ctrlKey: true }],
  ])("stores nothing for %s", (_chord, init) => {
    useKeybindStore.getState().setKeybinds([keybind({ actionId: "global.search" })])
    mount()

    act(() => recordButton("global.search").click())
    press(init)

    expect(api.putKeybindOverride).not.toHaveBeenCalled()
  })

  it("warns on a row whose stored chord the window keeps for itself", () => {
    useKeybindStore
      .getState()
      .setKeybinds([keybind({ actionId: "global.search", bindings: [{ kind: "Chord", chord: "Primary+R" }], isOverridden: true })])
    mount()

    const row = recordButton("global.search").closest("div.group\\/kb")
    expect(row?.textContent).toContain("KeyboardReservedBoundFormat(Ctrl R)")
  })

  it("says nothing on a row bound to an ordinary chord", () => {
    useKeybindStore.getState().setKeybinds([keybind({ actionId: "global.search" })])
    mount()

    const row = recordButton("global.search").closest("div.group\\/kb")
    expect(row?.textContent).not.toContain("KeyboardReservedBoundFormat")
  })
})
