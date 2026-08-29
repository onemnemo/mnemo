// @vitest-environment jsdom

/**
 * Which right clicks reach the webview's own menu.
 *
 * The line that matters is text entry: suppressing the menu there would take the
 * spelling suggestions with it.
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

  it("leaves it alone in inputs, textareas and editable content", () => {
    dispose = installContextMenuGuard()
    expect(rightClick(mount("<input type='text'>"))).toBe(false)
    expect(rightClick(mount("<textarea></textarea>"))).toBe(false)

    const editable = mount("<div contenteditable='true'><span>word</span></div>")
    expect(rightClick(editable.firstElementChild!)).toBe(false)
  })

  it("still swallows it on non-text inputs", () => {
    dispose = installContextMenuGuard()
    expect(rightClick(mount("<input type='checkbox'>"))).toBe(true)
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
