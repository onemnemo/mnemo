// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"

import { actionForKey, DEFAULT_CHORDS, handleKey, type EditorAction } from "./keys"
import { keyEvent } from "./test-kit"

describe("actionForKey", () => {
  const cases: [string, KeyboardEventInit, EditorAction][] = [
    ["v", {}, "tool-select"],
    ["h", {}, "tool-pan"],
    ["r", {}, "tool-rect"],
    ["e", {}, "tool-ellipse"],
    ["p", {}, "tool-polygon"],
    ["Enter", {}, "finish-polygon"],
    ["Escape", {}, "cancel"],
    ["[", { code: "BracketLeft" }, "previous-mask"],
    ["]", { code: "BracketRight" }, "next-mask"],
    ["ArrowLeft", {}, "nudge-left"],
    ["ArrowUp", { shiftKey: true }, "nudge-up-big"],
    ["ArrowUp", { altKey: true, shiftKey: true }, "move-earlier"],
    ["ArrowDown", { altKey: true, shiftKey: true }, "move-later"],
    ["F2", {}, "rename"],
    ["g", { ctrlKey: true }, "group"],
    ["g", { ctrlKey: true, shiftKey: true }, "ungroup"],
    ["d", { ctrlKey: true }, "duplicate"],
    ["a", { ctrlKey: true }, "select-all"],
    ["Delete", {}, "delete"],
    ["Backspace", {}, "delete"],
    ["z", { ctrlKey: true }, "undo"],
    ["y", { ctrlKey: true }, "redo"],
    ["z", { ctrlKey: true, shiftKey: true }, "redo"],
    ["=", { ctrlKey: true, code: "Equal" }, "zoom-in"],
    ["-", { ctrlKey: true, code: "Minus" }, "zoom-out"],
    ["0", { ctrlKey: true }, "zoom-fit"],
    ["m", {}, "toggle-masks"],
  ]

  it.each(cases)("%s %j", (key, init, action) => {
    expect(actionForKey(keyEvent(key, init))).toBe(action)
  })

  it("ignores unbound keys and keys with extra modifiers", () => {
    expect(actionForKey(keyEvent("q"))).toBeNull()
    expect(actionForKey(keyEvent("v", { ctrlKey: true }))).toBeNull()
  })

  it("binds every action", () => {
    for (const [action, chords] of Object.entries(DEFAULT_CHORDS)) {
      expect(chords.length, action).toBeGreaterThan(0)
    }
  })
})

describe("handleKey", () => {
  it("runs the action and prevents the default when it was used", () => {
    const perform = vi.fn(() => true)
    const event = keyEvent("v")
    expect(handleKey(event, perform)).toBe(true)
    expect(perform).toHaveBeenCalledWith("tool-select")
    expect(event.defaultPrevented).toBe(true)
  })

  it("leaves a key alone when the action had nothing to do", () => {
    const event = keyEvent("Enter")
    expect(handleKey(event, () => false)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
  })

  it("leaves keys typed into a field to the field", () => {
    const field = document.createElement("input")
    document.body.append(field)
    const perform = vi.fn(() => true)
    const event = keyEvent("v")
    field.dispatchEvent(event)
    expect(handleKey(event, perform)).toBe(false)
    expect(perform).not.toHaveBeenCalled()
    field.remove()
  })

  it("repeats a nudge but not a tool key", () => {
    const perform = vi.fn(() => true)
    expect(handleKey(keyEvent("ArrowLeft", { repeat: true }), perform)).toBe(true)
    expect(handleKey(keyEvent("v", { repeat: true }), perform)).toBe(false)
  })
})
