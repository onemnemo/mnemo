// @vitest-environment jsdom

/**
 * The block editor renders links and page references as real anchors and relies on the
 * browser refusing to follow a link inside a `contenteditable`. A read-only mount is
 * `contenteditable="false"`, so that protection is gone and this guard is what replaces
 * it. The window is chromeless: a followed external link replaces the whole application
 * with a web page and leaves no way back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { usePeekStore } from "./store"
import { installPeekLinkGuard, peekLinkAction } from "./read-only-links"

const mocks = vi.hoisted(() => ({ openExternally: vi.fn() }))
vi.mock("@/lib/external", () => ({ openExternally: mocks.openExternally }))

let root: HTMLElement
let stop: () => void

const initial = usePeekStore.getState()

/** The anchor the link mark renders, and the one the page reference view renders. */
function anchor(href: string, className = ""): HTMLAnchorElement {
  const element = document.createElement("a")
  element.setAttribute("href", href)
  element.className = className
  element.textContent = "go there"
  root.append(element)
  return element
}

function click(element: HTMLElement): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true })
  element.dispatchEvent(event)
  return event
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  usePeekStore.setState({ ...initial, item: null, nonce: 0 })
  root = document.createElement("div")
  document.body.append(root)
  stop = installPeekLinkGuard(root)
})

afterEach(() => {
  stop()
  document.body.innerHTML = ""
})

describe("what a link inside a read-only note means", () => {
  it("reads an in-app note route as a note", () => {
    expect(peekLinkAction("#/notes/n1")).toEqual({ kind: "note", id: "n1" })
    expect(peekLinkAction("#notes/n1")).toEqual({ kind: "note", id: "n1" })
  })

  it("reads http and https as external", () => {
    expect(peekLinkAction("https://example.com/x")).toEqual({
      kind: "external",
      url: "https://example.com/x",
    })
    expect(peekLinkAction("http://example.com")).toEqual({ kind: "external", url: "http://example.com" })
  })

  it("reads everything else as nothing to do", () => {
    // An in-app route the panel has no reader for: doing it would throw away the canvas
    // the reader is comparing against.
    expect(peekLinkAction("#/settings")).toEqual({ kind: "none" })
    expect(peekLinkAction("mailto:someone@example.com")).toEqual({ kind: "none" })
    expect(peekLinkAction("")).toEqual({ kind: "none" })
  })
})

describe("activation inside the panel", () => {
  it("never lets an external link navigate, and hands it to the host instead", () => {
    const event = click(anchor("https://example.com/evil"))

    expect(event.defaultPrevented).toBe(true)
    expect(mocks.openExternally).toHaveBeenCalledWith("https://example.com/evil")
    expect(usePeekStore.getState().item).toBeNull()
  })

  it("opens a note link in the peek rather than in the window", () => {
    const event = click(anchor("#/notes/n7"))

    expect(event.defaultPrevented).toBe(true)
    expect(usePeekStore.getState().item).toEqual({ kind: "note", id: "n7" })
    expect(mocks.openExternally).not.toHaveBeenCalled()
  })

  // The page reference view routes the canvas from its own click handler. The guard runs
  // in the capture phase so that handler never sees the press.
  it("opens a page reference in the peek and stops the row's own handler", () => {
    const row = anchor("#/notes/n9", "notes-page-row")
    const routed = vi.fn()
    row.addEventListener("click", routed)

    const event = click(row)

    expect(event.defaultPrevented).toBe(true)
    expect(routed).not.toHaveBeenCalled()
    expect(usePeekStore.getState().item).toEqual({ kind: "note", id: "n9" })
  })

  it("acts on a press landing on a span inside the anchor", () => {
    const link = anchor("#/notes/n3")
    const span = document.createElement("span")
    link.append(span)

    click(span)
    expect(usePeekStore.getState().item).toEqual({ kind: "note", id: "n3" })
  })

  it("answers Enter and Space the same way it answers a click", () => {
    const link = anchor("#/notes/n4")
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    link.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(usePeekStore.getState().item).toEqual({ kind: "note", id: "n4" })
  })

  it("leaves a press that is not on a link alone", () => {
    const plain = document.createElement("p")
    root.append(plain)

    const event = click(plain)
    expect(event.defaultPrevented).toBe(false)
    expect(mocks.openExternally).not.toHaveBeenCalled()
  })

  it("stops answering once it is removed", () => {
    stop()
    const event = click(anchor("https://example.com/x"))

    expect(event.defaultPrevented).toBe(false)
    expect(mocks.openExternally).not.toHaveBeenCalled()
  })
})
