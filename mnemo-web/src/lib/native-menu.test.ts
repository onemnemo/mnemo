// @vitest-environment jsdom

/**
 * Which right clicks reach the webview's own menu.
 *
 * Nothing does, in a shipped window. Text entry used to be the exception, so the
 * cases that used to be let through are pinned here as suppressed.
 */

import { afterEach, describe, expect, it, vi } from "vitest"

import { installContextMenuGuard } from "./native-menu"

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  // Restore the environment stub so later tests use their own build mode.
  vi.unstubAllEnvs()
  document.body.innerHTML = ""
})

function rightClick(target: Element, init: MouseEventInit = {}): boolean {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

function mount(html: string): Element {
  document.body.innerHTML = html
  return document.body.firstElementChild!
}

describe("installContextMenuGuard", () => {
  it("swallows the menu on ordinary content", () => {
    dispose = installContextMenuGuard()
    expect(rightClick(mount("<div>deck</div>"))).toBe(true)
  })

  it("swallows it in inputs, textareas and editable prose as well", () => {
    dispose = installContextMenuGuard()
    expect(rightClick(mount("<input type='text'>"))).toBe(true)
    expect(rightClick(mount("<textarea></textarea>"))).toBe(true)

    // The click lands on the span inside the editor, not on the editable host.
    const editable = mount("<div contenteditable='true'><span>word</span></div>")
    expect(rightClick(editable.firstElementChild!)).toBe(true)
  })

  it("lets shift through while developing, so Inspect stays reachable", () => {
    vi.stubEnv("DEV", true)
    dispose = installContextMenuGuard()
    expect(rightClick(mount("<div>deck</div>"), { shiftKey: true })).toBe(false)
  })

  it("closes the way past in a shipped window", () => {
    vi.stubEnv("DEV", false)
    dispose = installContextMenuGuard()
    expect(rightClick(mount("<div>deck</div>"), { shiftKey: true })).toBe(true)
  })

  it("stops suppressing once disposed", () => {
    installContextMenuGuard()()
    expect(rightClick(mount("<div>deck</div>"))).toBe(false)
  })

  // The app's own right-click menus decline to open on an event that is already
  // prevented, so the guard has to run after them rather than before.
  it("lets a handler on the way up see the event unprevented", () => {
    dispose = installContextMenuGuard()
    const row = mount("<div>deck</div>")

    let seen: boolean | undefined
    row.addEventListener("contextmenu", (event) => {
      seen = event.defaultPrevented
    })

    expect(rightClick(row)).toBe(true)
    expect(seen).toBe(false)
  })
})
