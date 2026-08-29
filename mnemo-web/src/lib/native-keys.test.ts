// @vitest-environment jsdom

/**
 * Checks that browser defaults are blocked without stopping app shortcut listeners.
 */

import { afterEach, describe, expect, it } from "vitest"

import { installNativeKeyGuard } from "./native-keys"

let dispose: (() => void) | undefined
const nativePlatform = navigator.platform

function setPlatform(platform: string): void {
  Object.defineProperty(navigator, "platform", { value: platform, configurable: true })
}

afterEach(() => {
  dispose?.()
  dispose = undefined
  setPlatform(nativePlatform)
  document.body.innerHTML = ""
})

function press(init: KeyboardEventInit, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

function prevented(init: KeyboardEventInit): boolean {
  return press(init).defaultPrevented
}

describe("installNativeKeyGuard", () => {
  it("swallows every way the engine spells reload", () => {
    dispose = installNativeKeyGuard()

    expect(prevented({ code: "F5", key: "F5" })).toBe(true)
    expect(prevented({ code: "F5", key: "F5", ctrlKey: true })).toBe(true)
    expect(prevented({ code: "F5", key: "F5", shiftKey: true })).toBe(true)
    expect(prevented({ code: "KeyR", key: "r", ctrlKey: true })).toBe(true)
    expect(prevented({ code: "KeyR", key: "r", ctrlKey: true, shiftKey: true })).toBe(true)
    expect(prevented({ code: "KeyR", key: "r", metaKey: true })).toBe(true)
  })

  it("swallows the print key with the modifier that platform prints on", () => {
    setPlatform("Win32")
    dispose = installNativeKeyGuard()

    expect(prevented({ code: "KeyP", key: "p", ctrlKey: true })).toBe(true)
    expect(prevented({ code: "KeyP", key: "p", metaKey: true })).toBe(false)
  })

  // Ctrl+P is a text-navigation shortcut on macOS; printing uses Cmd+P.
  it("leaves the caret keys alone on apple platforms", () => {
    setPlatform("MacIntel")
    dispose = installNativeKeyGuard()

    expect(prevented({ code: "KeyP", key: "p", metaKey: true })).toBe(true)
    expect(prevented({ code: "KeyP", key: "p", ctrlKey: true })).toBe(false)
  })

  it("leaves the app's own keys alone", () => {
    setPlatform("Win32")
    dispose = installNativeKeyGuard()

    expect(prevented({ code: "KeyR", key: "r" })).toBe(false)
    expect(prevented({ code: "KeyP", key: "p" })).toBe(false)
    expect(prevented({ code: "KeyS", key: "s", ctrlKey: true })).toBe(false)
    expect(prevented({ code: "KeyF", key: "f", ctrlKey: true })).toBe(false)
    expect(prevented({ code: "KeyK", key: "k", ctrlKey: true })).toBe(false)
    expect(prevented({ code: "KeyR", key: "r", ctrlKey: true, altKey: true })).toBe(false)
    expect(prevented({ code: "KeyP", key: "p", ctrlKey: true, shiftKey: true })).toBe(false)
  })

  it("keeps swallowing a held key", () => {
    dispose = installNativeKeyGuard()
    expect(prevented({ code: "F5", key: "F5", repeat: true })).toBe(true)
  })

  // Preventing browser print must still let the notes shortcut focus search.
  it("lets a listener further along still see the press", () => {
    setPlatform("Win32")
    dispose = installNativeKeyGuard()

    document.body.innerHTML = "<div>note</div>"
    const target = document.body.firstElementChild!

    let seen: KeyboardEvent | undefined
    const downstream = (event: Event) => {
      seen = event as KeyboardEvent
    }
    window.addEventListener("keydown", downstream)

    try {
      const event = press({ code: "KeyP", key: "p", ctrlKey: true }, target)
      expect(event.defaultPrevented).toBe(true)
      expect(seen).toBe(event)
    } finally {
      window.removeEventListener("keydown", downstream)
    }
  })

  it("stops swallowing once disposed", () => {
    installNativeKeyGuard()()
    expect(prevented({ code: "F5", key: "F5" })).toBe(false)
  })
})
