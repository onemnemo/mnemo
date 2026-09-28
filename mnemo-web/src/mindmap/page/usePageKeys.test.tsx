// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { usePageKeys } from "./usePageKeys"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let heard: ReturnType<typeof vi.fn<(event: KeyboardEvent) => void>>

function Listener() {
  usePageKeys(heard)
  return null
}

beforeEach(() => {
  heard = vi.fn<(event: KeyboardEvent) => void>()
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<Listener />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  window.getSelection()?.removeAllRanges()
})

const press = (target: EventTarget, init: KeyboardEventInit) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }))

describe("usePageKeys", () => {
  it("hands the map a key pressed while the page has the focus, and no other", () => {
    press(document.body, { key: "v" })
    press(host, { key: "v" })

    expect(heard).toHaveBeenCalledTimes(1)
  })

  it("leaves Tab to the page", () => {
    press(document.body, { key: "Tab" })

    expect(heard).not.toHaveBeenCalled()
  })

  it("stands down under an open dialog", () => {
    const dialog = document.createElement("div")
    dialog.setAttribute("role", "dialog")
    dialog.dataset.state = "open"
    document.body.append(dialog)
    try {
      press(document.body, { key: "Delete" })
    } finally {
      dialog.remove()
    }

    expect(heard).not.toHaveBeenCalled()
  })

  it("skips a key another handler has already answered", () => {
    const answer = (event: KeyboardEvent) => event.preventDefault()
    document.body.addEventListener("keydown", answer)
    try {
      press(document.body, { key: "Escape" })
    } finally {
      document.body.removeEventListener("keydown", answer)
    }

    expect(heard).not.toHaveBeenCalled()
  })

  it("leaves a copy to selected page text, but not a plain key", () => {
    host.textContent = "some text"
    const range = document.createRange()
    range.selectNodeContents(host)
    window.getSelection()?.addRange(range)

    press(document.body, { key: "c", ctrlKey: true })
    expect(heard).not.toHaveBeenCalled()
    press(document.body, { key: "v" })
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it("stops listening once the map is gone", () => {
    act(() => root.unmount())
    root = createRoot(host)

    press(document.body, { key: "v" })

    expect(heard).not.toHaveBeenCalled()
  })
})
