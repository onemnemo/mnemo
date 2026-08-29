// @vitest-environment jsdom

/**
 * Checks that navigation drops are blocked while plain-text insertion remains available.
 */

import { afterEach, describe, expect, it } from "vitest"

import { installNativeDropGuard } from "./native-drop"

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.innerHTML = ""
})

function mount(html: string): Element {
  document.body.innerHTML = html
  return document.body.firstElementChild!
}

function drag(kind: "dragover" | "drop", target: EventTarget, types: string[] | null): Event {
  const event = new Event(kind, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", { value: types === null ? null : { types } })
  target.dispatchEvent(event)
  return event
}

function refuses(types: string[] | null): boolean {
  const target = mount("<div>shelf</div>")
  const over = drag("dragover", target, types).defaultPrevented
  const dropped = drag("drop", target, types).defaultPrevented
  expect(over).toBe(dropped)
  return dropped
}

describe("installNativeDropGuard", () => {
  it("refuses a dropped file anywhere in the window", () => {
    dispose = installNativeDropGuard()
    expect(refuses(["Files"])).toBe(true)
  })

  // Link drags include a URI, so blocking navigation also blocks inserting that URI into a field.
  it("refuses a dropped link", () => {
    dispose = installNativeDropGuard()
    expect(refuses(["text/uri-list", "text/plain"])).toBe(true)
  })

  it("refuses a drag that names nothing it carries", () => {
    dispose = installNativeDropGuard()
    expect(refuses([])).toBe(true)
    expect(refuses(null)).toBe(true)
  })

  it("leaves a text drag to the field it lands in", () => {
    dispose = installNativeDropGuard()
    expect(refuses(["text/plain"])).toBe(false)
  })

  it("lets a handled drop keep working", () => {
    dispose = installNativeDropGuard()
    const target = mount("<div>panel</div>")

    let handled = 0
    target.addEventListener("drop", (event) => {
      handled += 1
      event.preventDefault()
    })

    expect(drag("drop", target, ["Files"]).defaultPrevented).toBe(true)
    expect(handled).toBe(1)
  })

  it("stops refusing once disposed", () => {
    installNativeDropGuard()()
    expect(refuses(["Files"])).toBe(false)
  })
})
